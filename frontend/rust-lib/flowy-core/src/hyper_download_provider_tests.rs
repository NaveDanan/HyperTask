//! Positive core-provider dispatch proof using fake credentials and loopback HTTP only.
use crate::config::AppFlowyCoreConfig;
use crate::server_layer::ServerProvider;
use base64::Engine;
use collab_plugins::CollabKVDB;
use flowy_error::FlowyResult;
use flowy_server::af_cloud::define::LoggedUser;
use flowy_server_pub::af_cloud_config::AFCloudConfiguration;
use flowy_sqlite::{kv::KVStorePreferences, DBConnection};
use flowy_storage_pub::cloud::StorageCloudService;
use flowy_user_pub::entities::{AuthType, WorkspaceType};
use lib_infra::async_trait::async_trait;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Weak;
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

const FAKE_ACCESS_TOKEN: &str = "hyper-core-provider-test-only-not-a-real-token";
const DEVICE: &str = "hyper-core-provider-fixture";
const PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=";

struct DummyLoggedUser {
  workspace: Uuid,
  root: PathBuf,
}
#[async_trait]
impl LoggedUser for DummyLoggedUser {
  fn workspace_id(&self) -> FlowyResult<Uuid> {
    Ok(self.workspace)
  }
  fn workspace_type(&self) -> FlowyResult<WorkspaceType> {
    Ok(WorkspaceType::Server)
  }
  fn user_id(&self) -> FlowyResult<i64> {
    Ok(7)
  }
  async fn is_local_mode(&self) -> FlowyResult<bool> {
    Ok(false)
  }
  fn get_sqlite_db(&self, _uid: i64) -> FlowyResult<DBConnection> {
    panic!("core provider preview must not open SQLite or read real settings")
  }
  fn get_collab_db(&self, _uid: i64) -> FlowyResult<Weak<CollabKVDB>> {
    panic!("core provider preview must not open a collab database")
  }
  fn application_root_dir(&self) -> FlowyResult<PathBuf> {
    Ok(self.root.clone())
  }
}

fn fake_future_token() -> String {
  // These non-JWT strings are test data. No persisted user session is loaded.
  serde_json::json!({
    "access_token": FAKE_ACCESS_TOKEN,
    "token_type": "bearer",
    "expires_in": 3_153_600_000_i64,
    "expires_at": 4_102_444_800_i64,
    "refresh_token": "hyper-core-test-refresh-token-never-sent",
    "user": {
      "id": "00000000-0000-4000-8000-000000000007",
      "aud": "authenticated", "role": "authenticated",
      "email": "fixture@example.invalid", "phone": "",
      "app_metadata": {}, "user_metadata": {},
      "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"
    }
  })
  .to_string()
}

fn serve_png(png: Vec<u8>) -> (String, thread::JoinHandle<String>) {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  listener.set_nonblocking(true).unwrap();
  let base = format!("http://{}", listener.local_addr().unwrap());
  let worker = thread::spawn(move || {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut stream = loop {
      match listener.accept() {
        Ok((stream, _)) => break stream,
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
          assert!(
            Instant::now() < deadline,
            "core provider never reached loopback storage"
          );
          thread::sleep(Duration::from_millis(5));
        },
        Err(error) => panic!("loopback accept: {}", error),
      }
    };
    stream
      .set_read_timeout(Some(Duration::from_secs(2)))
      .unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0; 1024];
    while !bytes.windows(4).any(|part| part == b"\r\n\r\n") {
      let read = stream.read(&mut buffer).unwrap();
      assert!(
        read != 0 && bytes.len() + read < 16 * 1024,
        "invalid core-provider request"
      );
      bytes.extend_from_slice(&buffer[..read]);
    }
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", png.len()).unwrap();
    stream.write_all(&png).unwrap();
    String::from_utf8(bytes).unwrap()
  });
  (base, worker)
}

#[test]
fn hyper_download_core_provider_delegates_to_native_authenticated_bounded_storage() {
  let started = Instant::now();
  let png = base64::engine::general_purpose::STANDARD
    .decode(PNG_BASE64)
    .unwrap();
  let (server, worker) = serve_png(png.clone());
  let workspace = Uuid::new_v4();
  let root = std::env::temp_dir().join(format!("hyper-core-provider-{}", workspace));
  let runtime = tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
    .unwrap();
  runtime.block_on(async {
    tokio::time::timeout(Duration::from_secs(2), async {
      // Build configuration directly: no environment mutation, settings or user database.
      let config = AppFlowyCoreConfig {
        app_version: semver::Version::new(0, 11, 4),
        name: "hyper-core-provider-test".into(),
        device_id: DEVICE.into(),
        platform: "linux".into(),
        storage_path: root.to_string_lossy().into_owned(),
        application_path: root.to_string_lossy().into_owned(),
        log_filter: "off".into(),
        cloud_config: Some(AFCloudConfiguration {
          base_url: format!("{}/prefix", server),
          ws_base_url: "ws://127.0.0.1:9/unused-websocket".into(),
          gotrue_url: format!("{}/unused-gotrue", server),
          ..Default::default()
        }),
      };
      let provider = ServerProvider::new(
        config,
        Weak::<KVStorePreferences>::new(),
        DummyLoggedUser {
          workspace,
          root: root.clone(),
        },
        None,
      );
      provider.set_auth_type(AuthType::AppFlowyCloud);
      let native_server = provider.get_server().unwrap();
      native_server.set_token(&fake_future_token()).unwrap();
      let url = format!(
        "{}/prefix/api/file_storage/{}/v1/blob/document/picture.png",
        server, workspace
      );
      let object = StorageCloudService::get_object_bounded(&provider, url, workspace, 1024)
        .await
        .unwrap();
      assert_eq!(object.raw.as_ref(), png.as_slice());
      assert_eq!(object.mime.to_string(), "image/png");
    })
    .await
    .expect("core bounded-storage proof must finish before WebSocket reconnect");
  });
  // Drop all token-state background work before the native reconnect delay of 5 seconds.
  runtime.shutdown_timeout(Duration::from_millis(250));
  assert!(started.elapsed() < Duration::from_secs(5));
  let request = worker.join().unwrap();
  let mut lines = request.split("\r\n");
  assert_eq!(
    lines.next().unwrap(),
    format!(
      "GET /prefix/api/file_storage/{}/v1/blob/document/picture.png HTTP/1.1",
      workspace
    )
  );
  let headers: BTreeMap<_, _> = lines
    .take_while(|line| !line.is_empty())
    .map(|line| {
      let (name, value) = line.split_once(':').unwrap();
      (name.to_ascii_lowercase(), value.trim().to_string())
    })
    .collect();
  assert_eq!(
    headers.get("authorization").unwrap(),
    &format!("Bearer {}", FAKE_ACCESS_TOKEN)
  );
  assert_eq!(headers.get("device-id").unwrap(), DEVICE);
  assert_eq!(headers.get("client-version").unwrap(), "0.11.4");
  assert!(!request.contains("hyper-core-test-refresh-token-never-sent"));
  assert!(!request.contains("unused-gotrue"));
  assert!(
    !root.exists(),
    "the provider proof must not create or open user data"
  );
}
