//! Native stream transport for search results, AI responses and upload progress.
use lib_infra::hyper_stream::{register_stream_sender, HyperStreamValue};

use crate::protocol::{encode, KIND_PORT_MESSAGE};
use crate::OUTBOX;

fn encode_value(value: HyperStreamValue) -> Vec<u8> {
  let (tag, kind, bytes) = match value {
    HyperStreamValue::Text(text) => (4, None, text.into_bytes()),
    HyperStreamValue::Bytes(bytes) => (5, Some(2), bytes),
  };
  let mut result = Vec::with_capacity(bytes.len() + 6);
  result.push(tag);
  if let Some(kind) = kind {
    result.push(kind);
  }
  result.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
  result.extend_from_slice(&bytes);
  result
}

fn send_stream(port: i64, value: HyperStreamValue) -> bool {
  if !crate::SDK_READY.load(std::sync::atomic::Ordering::Acquire) {
    return false;
  }
  let value = encode_value(value);
  OUTBOX.get().is_some_and(|outbox| {
    outbox
      .send(encode(KIND_PORT_MESSAGE, &[&port.to_le_bytes(), &value]))
      .is_ok()
  })
}

pub fn install() {
  register_stream_sender(send_stream).expect("stream sender must be installed once");
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn encodes_text_and_bytes_for_the_renderer() {
    assert_eq!(
      encode_value(HyperStreamValue::Text("hi".into())),
      vec![4, 2, 0, 0, 0, b'h', b'i']
    );
    assert_eq!(
      encode_value(HyperStreamValue::Bytes(vec![0, 255])),
      vec![5, 2, 2, 0, 0, 0, 0, 255]
    );
  }
}
