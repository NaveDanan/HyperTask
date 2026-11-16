use bytes::Bytes;

use collab_database::fields::url_type_option::URLCellData;

use hyper_error::{HyperResult, internal_error};

use crate::entities::URLCellDataPB;
use crate::services::cell::CellProtobufBlobParser;

impl From<URLCellData> for URLCellDataPB {
  fn from(data: URLCellData) -> Self {
    Self { content: data.data }
  }
}

impl From<URLCellDataPB> for URLCellData {
  fn from(data: URLCellDataPB) -> Self {
    Self { data: data.content }
  }
}

pub struct URLCellDataParser();
impl CellProtobufBlobParser for URLCellDataParser {
  type Object = URLCellDataPB;

  fn parser(bytes: &Bytes) -> HyperResult<Self::Object> {
    URLCellDataPB::try_from(bytes.as_ref()).map_err(internal_error)
  }
}
