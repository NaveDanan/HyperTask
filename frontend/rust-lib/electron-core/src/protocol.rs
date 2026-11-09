//! Wire protocol between the Electron main process and this core process.
//!
//! Both directions use one loopback TCP connection. Every frame is
//! `[u32 LE body length][u8 kind][kind-specific bytes]`. Integers are little endian.
//!
//! Electron -> core:
//! - `INIT`:     UTF-8 JSON, the same document dart-ffi's `init_sdk` receives
//! - `REQUEST`:  `[u64 id][u32 event name length][event name][protobuf payload]`
//! - `LOG`:      `[u8 level][UTF-8 message]`, the same levels as dart-ffi's `rust_log`
//! - `SHUTDOWN`: empty, closes the database and exits
//!
//! Core -> Electron:
//! - `HELLO`:        the token from `APPFLOWY_CORE_TOKEN`, sent first
//! - `INIT_DONE`:    `[i64 code]`, 0 on success
//! - `RESPONSE`:     `[u64 id][u8 status][payload]`, status 0 = ok, 1 = error, 2 = internal
//! - `NOTIFICATION`: a `SubscribeObject` protobuf message
//! - `PORT_MESSAGE`: `[i64 port][value]`, a message posted to a stream port (see `ports`)

use std::io::{self, Read};

pub const KIND_INIT: u8 = 1;
pub const KIND_REQUEST: u8 = 2;
pub const KIND_LOG: u8 = 3;
pub const KIND_SHUTDOWN: u8 = 4;

pub const KIND_HELLO: u8 = 0x80;
pub const KIND_INIT_DONE: u8 = 0x81;
pub const KIND_RESPONSE: u8 = 0x82;
pub const KIND_NOTIFICATION: u8 = 0x83;
pub const KIND_PORT_MESSAGE: u8 = 0x84;

pub const STATUS_OK: u8 = 0;
pub const STATUS_ERR: u8 = 1;
pub const STATUS_INTERNAL: u8 = 2;

const MAX_FRAME_LEN: usize = 1 << 30;

pub fn encode(kind: u8, parts: &[&[u8]]) -> Vec<u8> {
  let body_len = 1 + parts.iter().map(|p| p.len()).sum::<usize>();
  let mut frame = Vec::with_capacity(4 + body_len);
  frame.extend_from_slice(&(body_len as u32).to_le_bytes());
  frame.push(kind);
  for part in parts {
    frame.extend_from_slice(part);
  }
  frame
}

/// Returns `Ok(None)` when the connection closed cleanly between frames.
pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<(u8, Vec<u8>)>> {
  let mut len_bytes = [0u8; 4];
  match reader.read_exact(&mut len_bytes) {
    Ok(()) => {},
    Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
    Err(e) => return Err(e),
  }
  let len = u32::from_le_bytes(len_bytes) as usize;
  if len == 0 || len > MAX_FRAME_LEN {
    return Err(io::Error::new(
      io::ErrorKind::InvalidData,
      format!("invalid frame length {len}"),
    ));
  }
  let mut body = vec![0u8; len];
  reader.read_exact(&mut body)?;
  let kind = body.remove(0);
  Ok(Some((kind, body)))
}

pub struct Request<'a> {
  pub id: u64,
  pub event: &'a str,
  pub payload: &'a [u8],
}

pub fn parse_request(body: &[u8]) -> Option<Request<'_>> {
  let id = u64::from_le_bytes(body.get(0..8)?.try_into().ok()?);
  let name_len = u32::from_le_bytes(body.get(8..12)?.try_into().ok()?) as usize;
  let event = std::str::from_utf8(body.get(12..12 + name_len)?).ok()?;
  let payload = body.get(12 + name_len..)?;
  Some(Request { id, event, payload })
}
