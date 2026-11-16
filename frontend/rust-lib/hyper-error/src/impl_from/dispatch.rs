use std::convert::TryInto;

use bytes::Bytes;

use lib_dispatch::prelude::{AFPluginEventResponse, ResponseBuilder};

use crate::HyperError;

impl lib_dispatch::Error for HyperError {
  fn as_response(&self) -> AFPluginEventResponse {
    let bytes: Bytes = self.clone().try_into().unwrap();
    ResponseBuilder::Err().data(bytes).build()
  }
}
