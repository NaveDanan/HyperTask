//! AppFlowy core process for the Electron shell.
//!
//! This binary serves Electron requests over the framed loopback connection described
//! in [`protocol`]. Events run on the core `AFPluginDispatcher`.

use std::future::Future;
use std::io::{BufReader, Write};
use std::net::{Ipv4Addr, TcpStream};
use std::pin::Pin;
use std::sync::mpsc as std_mpsc;
use std::sync::{Arc, OnceLock};
use std::task::{Context, Poll};

use bytes::Bytes;
use futures::ready;
use semver::Version;
use tokio::sync::mpsc;
use tokio::task::LocalSet;
use tracing::{debug, error, info, trace, warn};

use flowy_core::config::AppFlowyCoreConfig;
use flowy_core::*;
use flowy_notification::entities::SubscribeObject;
use flowy_notification::{
  register_notification_sender, unregister_all_notification_sender, NotificationSender,
};
use flowy_server_pub::AuthenticatorType;
use lib_dispatch::prelude::*;
use lib_dispatch::runtime::AFPluginRuntime;

use crate::config::{save_appflowy_cloud_config, AppFlowyConfiguration};
use crate::protocol::*;

mod config;
mod ports;
mod protocol;

static OUTBOX: OnceLock<std_mpsc::Sender<Vec<u8>>> = OnceLock::new();

pub(crate) fn send_frame(frame: Vec<u8>) {
  if let Some(outbox) = OUTBOX.get() {
    let _ = outbox.send(frame);
  }
}

fn send_response(id: u64, status: u8, payload: &[u8]) {
  send_frame(encode(KIND_RESPONSE, &[&id.to_le_bytes(), &[status], payload]));
}

fn main() {
  let port: u16 = std::env::var("APPFLOWY_CORE_PORT")
    .ok()
    .and_then(|port| port.parse().ok())
    .expect("APPFLOWY_CORE_PORT must name the Electron loopback port");
  let token = std::env::var("APPFLOWY_CORE_TOKEN").expect("APPFLOWY_CORE_TOKEN must be set");
  // The token is only for the handshake; keep it out of the core's environment.
  std::env::remove_var("APPFLOWY_CORE_TOKEN");

  let stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
    .expect("Failed to connect to the Electron main process");
  let _ = stream.set_nodelay(true);
  let mut writer = stream.try_clone().expect("Failed to clone the core stream");

  let (outbox, frames) = std_mpsc::channel::<Vec<u8>>();
  let _ = OUTBOX.set(outbox);
  std::thread::spawn(move || {
    for frame in frames {
      if writer.write_all(&frame).is_err() {
        break;
      }
    }
  });
  send_frame(encode(KIND_HELLO, &[token.as_bytes()]));

  ports::install();
  unregister_all_notification_sender();
  register_notification_sender(ElectronNotificationSender);

  let mut host = CoreHost::default();
  let mut reader = BufReader::new(stream);
  loop {
    match read_frame(&mut reader) {
      Ok(Some((kind, body))) => {
        if !host.handle(kind, body) {
          break;
        }
      },
      Ok(None) => break,
      Err(err) => {
        error!("[Electron]: core connection failed: {}", err);
        break;
      },
    }
  }

  host.close();
}

pub struct Task {
  dispatcher: Arc<AFPluginDispatcher>,
  request: AFPluginRequest,
  id: u64,
}

unsafe impl Send for Task {}

#[derive(Default)]
struct CoreHost {
  core: Option<AppFlowyCore>,
  sender: Option<mpsc::UnboundedSender<Task>>,
}

impl CoreHost {
  /// Returns false when the process should exit.
  fn handle(&mut self, kind: u8, body: Vec<u8>) -> bool {
    match kind {
      KIND_INIT => {
        let code = self.init(&String::from_utf8_lossy(&body));
        send_frame(encode(KIND_INIT_DONE, &[&code.to_le_bytes()]));
      },
      KIND_REQUEST => match parse_request(&body) {
        Some(request) => self.dispatch(request),
        None => error!("[Electron]: malformed request frame"),
      },
      KIND_LOG => {
        if let Some((level, message)) = body.split_first() {
          rust_log(*level, &String::from_utf8_lossy(message));
        }
      },
      KIND_SHUTDOWN => return false,
      other => warn!("[Electron]: unknown frame kind {}", other),
    }
    true
  }

  fn init(&mut self, json: &str) -> i64 {
    let configuration = match serde_json::from_str::<AppFlowyConfiguration>(json) {
      Ok(configuration) => configuration,
      Err(err) => {
        error!("[Electron]: invalid init configuration: {}", err);
        return -1;
      },
    };
    configuration.write_env();

    if configuration.authenticator_type == AuthenticatorType::AppFlowyCloud {
      let _ = save_appflowy_cloud_config(&configuration.root, &configuration.appflowy_cloud_config);
    }

    let mut app_version =
      Version::parse(&configuration.app_version).unwrap_or_else(|_| Version::new(0, 5, 8));

    let min_version = Version::new(0, 5, 8);
    if app_version < min_version {
      app_version = min_version;
    }

    let config = AppFlowyCoreConfig::new(
      app_version,
      configuration.custom_app_path,
      configuration.origin_app_path,
      configuration.device_id,
      configuration.platform,
      DEFAULT_NAME.to_string(),
    );

    if let Some(core) = &self.core {
      core.close_db();
    }

    let (sender, task_rx) = mpsc::unbounded_channel::<Task>();
    let runtime = Arc::new(AFPluginRuntime::new().unwrap());
    let cloned_runtime = runtime.clone();
    std::thread::spawn(move || {
      let local_set = LocalSet::new();
      cloned_runtime.block_on(local_set.run_until(Runner { rx: task_rx }));
    });

    // Replacing the sender ends the previous runner thread.
    self.sender = Some(sender);
    let cloned_runtime = runtime.clone();
    self.core =
      Some(runtime.block_on(async move { AppFlowyCore::new(config, cloned_runtime, None).await }));
    0
  }

  fn dispatch(&self, request: Request<'_>) {
    let (Some(core), Some(sender)) = (self.core.as_ref(), self.sender.as_ref()) else {
      // Answer requests received before initialization instead of leaving callers waiting.
      error!("[Electron]: event {} sent before init", request.event);
      send_response(request.id, STATUS_INTERNAL, b"AppFlowy core is not initialized");
      return;
    };

    #[cfg(feature = "verbose_log")]
    trace!("[Electron]: {} Async Event: {}", request.id, request.event);

    let task = Task {
      dispatcher: core.event_dispatcher.clone(),
      request: AFPluginRequest::new(request.event.to_string()).payload(request.payload.to_vec()),
      id: request.id,
    };
    if let Err(err) = sender.send(task) {
      error!("Failed to send task: {}", err);
      send_response(request.id, STATUS_INTERNAL, b"AppFlowy core runner stopped");
    }
  }

  fn close(&mut self) {
    if let Some(core) = self.core.take() {
      core.close_db();
    }
    self.sender = None;
  }
}

/// A persistent future that processes [Task]s.
struct Runner {
  rx: mpsc::UnboundedReceiver<Task>,
}

impl Future for Runner {
  type Output = ();

  fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    loop {
      match ready!(self.rx.poll_recv(cx)) {
        None => return Poll::Ready(()),
        Some(task) => {
          let Task {
            dispatcher,
            request,
            id,
          } = task;

          tokio::task::spawn_local(async move {
            AFPluginDispatcher::boxed_async_send_with_callback(
              dispatcher.as_ref(),
              request,
              move |resp: AFPluginEventResponse| {
                Box::pin(async move {
                  let status = match resp.status_code {
                    StatusCode::Ok => STATUS_OK,
                    StatusCode::Err => STATUS_ERR,
                  };
                  match resp.payload {
                    Payload::Bytes(bytes) => send_response(id, status, &bytes),
                    Payload::None => send_response(id, status, &[]),
                  }
                })
              },
            )
            .await;
          });
        },
      }
    }
  }
}

struct ElectronNotificationSender;

impl NotificationSender for ElectronNotificationSender {
  fn send_subject(&self, subject: SubscribeObject) -> Result<(), String> {
    let bytes: Bytes = subject.try_into().map_err(|err| format!("{:?}", err))?;
    send_frame(encode(KIND_NOTIFICATION, &[&bytes]));
    Ok(())
  }
}

fn rust_log(level: u8, message: &str) {
  match level {
    0 => info!("[Electron]: {}", message),
    1 => debug!("[Electron]: {}", message),
    2 => trace!("[Electron]: {}", message),
    3 => warn!("[Electron]: {}", message),
    4 => error!("[Electron]: {}", message),
    _ => warn!("[Electron]: unsupported log level {}", level),
  }
}
