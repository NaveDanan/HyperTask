//! Stream ports. Several core features stream to a Dart `SendPort` with allo-isolate
//! (`Isolate::new(port).post(..)`): search results, AI chat answers and completions, and
//! file upload progress. dart-ffi gets those messages through Dart's `Dart_PostCObject`.
//! Here the post callback serializes each message into a `PORT_MESSAGE` frame instead, so
//! the renderer receives exactly what the Flutter app would.
//!
//! Value encoding (little endian):
//! `0` null, `1` bool `[u8]`, `2` int `[i64]`, `3` double `[f64]`,
//! `4` string `[u32 len][utf8]`, `5` typed data `[u8 element type][u32 byte len][bytes]`,
//! `6` array `[u32 count][values]`.

use std::ffi::CStr;

use allo_isolate::ffi::{DartCObject, DartCObjectType, DartPort, DartTypedDataType};

use crate::protocol::{encode, KIND_PORT_MESSAGE};
use crate::send_frame;

const TAG_NULL: u8 = 0;
const TAG_BOOL: u8 = 1;
const TAG_INT: u8 = 2;
const TAG_DOUBLE: u8 = 3;
const TAG_STRING: u8 = 4;
const TAG_TYPED_DATA: u8 = 5;
const TAG_ARRAY: u8 = 6;

fn element_size(ty: DartTypedDataType) -> usize {
  use DartTypedDataType::*;
  match ty {
    ByteData | Int8 | Uint8 | Uint8Clamped => 1,
    Int16 | Uint16 => 2,
    Int32 | Uint32 | Float32 => 4,
    Int64 | Uint64 | Float64 => 8,
    Float32x4 => 16,
    Invalid => 0,
  }
}

fn push_bytes(out: &mut Vec<u8>, ty: DartTypedDataType, length: isize, data: *const u8) {
  let byte_len = (length.max(0) as usize) * element_size(ty);
  out.push(TAG_TYPED_DATA);
  out.push(ty as u8);
  out.extend_from_slice(&(byte_len as u32).to_le_bytes());
  if byte_len > 0 && !data.is_null() {
    out.extend_from_slice(unsafe { std::slice::from_raw_parts(data, byte_len) });
  }
}

fn encode_value(object: &DartCObject, out: &mut Vec<u8>) {
  unsafe {
    match object.ty {
      DartCObjectType::DartBool => {
        out.push(TAG_BOOL);
        out.push(object.value.as_bool as u8);
      },
      DartCObjectType::DartInt32 => {
        out.push(TAG_INT);
        out.extend_from_slice(&(object.value.as_int32 as i64).to_le_bytes());
      },
      DartCObjectType::DartInt64 => {
        out.push(TAG_INT);
        out.extend_from_slice(&object.value.as_int64.to_le_bytes());
      },
      DartCObjectType::DartDouble => {
        out.push(TAG_DOUBLE);
        out.extend_from_slice(&object.value.as_double.to_le_bytes());
      },
      DartCObjectType::DartString => {
        let text = if object.value.as_string.is_null() {
          &[][..]
        } else {
          CStr::from_ptr(object.value.as_string).to_bytes()
        };
        out.push(TAG_STRING);
        out.extend_from_slice(&(text.len() as u32).to_le_bytes());
        out.extend_from_slice(text);
      },
      DartCObjectType::DartTypedData => {
        let data = object.value.as_typed_data;
        push_bytes(out, data.ty, data.length, data.values);
      },
      DartCObjectType::DartExternalTypedData => {
        let data = object.value.as_external_typed_data;
        push_bytes(out, data.ty, data.length, data.data);
      },
      DartCObjectType::DartArray => {
        let array = object.value.as_array;
        let length = array.length.max(0) as usize;
        out.push(TAG_ARRAY);
        out.extend_from_slice(&(length as u32).to_le_bytes());
        if length > 0 && !array.values.is_null() {
          for item in std::slice::from_raw_parts(array.values, length) {
            match item.as_ref() {
              Some(item) => encode_value(item, out),
              None => out.push(TAG_NULL),
            }
          }
        }
      },
      _ => out.push(TAG_NULL),
    }
  }
}

/// The `Dart_PostCObject` replacement. allo-isolate frees the message afterwards, except
/// external typed data, which Dart would own after a successful post; that is released here.
unsafe extern "C" fn post_cobject(port: DartPort, message: *mut DartCObject) -> bool {
  let Some(message) = message.as_mut() else {
    return false;
  };
  let mut value = Vec::new();
  encode_value(message, &mut value);
  allo_isolate::ffi::run_destructors(message);
  send_frame(encode(KIND_PORT_MESSAGE, &[&port.to_le_bytes(), &value]));
  true
}

pub fn install() {
  unsafe { allo_isolate::store_dart_post_cobject(post_cobject) };
}
