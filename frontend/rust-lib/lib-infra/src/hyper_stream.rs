use anyhow::{anyhow, Result};
use futures::Sink;
pub use futures_util::sink::SinkExt;
use std::pin::Pin;
use std::sync::OnceLock;
use std::task::{Context, Poll};

/// The two payload types used by search, AI and upload progress streams.
#[derive(Debug, PartialEq, Eq)]
pub enum HyperStreamValue {
  Text(String),
  Bytes(Vec<u8>),
}

impl From<String> for HyperStreamValue {
  fn from(value: String) -> Self {
    Self::Text(value)
  }
}

impl From<Vec<u8>> for HyperStreamValue {
  fn from(value: Vec<u8>) -> Self {
    Self::Bytes(value)
  }
}

type StreamSender = fn(i64, HyperStreamValue) -> bool;
static STREAM_SENDER: OnceLock<StreamSender> = OnceLock::new();

/// Installs the transport before the core begins handling events.
pub fn register_stream_sender(sender: StreamSender) -> Result<()> {
  STREAM_SENDER
    .set(sender)
    .map_err(|_| anyhow!("stream sender already registered"))
}

#[derive(Clone, Debug)]
pub struct HyperStreamSink {
  port: i64,
}

impl HyperStreamSink {
  pub fn new(port: i64) -> Self {
    Self { port }
  }
}

impl<T: Into<HyperStreamValue>> Sink<T> for HyperStreamSink {
  type Error = anyhow::Error;

  fn poll_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<()>> {
    Poll::Ready(Ok(()))
  }

  fn start_send(self: Pin<&mut Self>, item: T) -> Result<()> {
    let sender = STREAM_SENDER
      .get()
      .ok_or_else(|| anyhow!("stream sender is not registered"))?;
    if sender(self.port, item.into()) {
      Ok(())
    } else {
      Err(anyhow!("failed to send stream message"))
    }
  }

  fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<()>> {
    Poll::Ready(Ok(()))
  }

  fn poll_close(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<()>> {
    Poll::Ready(Ok(()))
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Mutex;

  static MESSAGES: Mutex<Vec<(i64, HyperStreamValue)>> = Mutex::new(Vec::new());

  fn record(port: i64, value: HyperStreamValue) -> bool {
    if port < 0 {
      return false;
    }
    MESSAGES.lock().unwrap().push((port, value));
    true
  }

  #[test]
  fn routes_text_and_bytes_and_reports_transport_failure() {
    register_stream_sender(record).unwrap();
    futures::executor::block_on(async {
      let mut sink = HyperStreamSink::new(42);
      sink.send("answer".to_string()).await.unwrap();
      sink.send(vec![0u8, 255]).await.unwrap();
      assert!(HyperStreamSink::new(-1)
        .send("error".to_string())
        .await
        .is_err());
    });
    assert_eq!(
      *MESSAGES.lock().unwrap(),
      vec![
        (42, HyperStreamValue::Text("answer".to_string())),
        (42, HyperStreamValue::Bytes(vec![0, 255])),
      ]
    );
  }
}
