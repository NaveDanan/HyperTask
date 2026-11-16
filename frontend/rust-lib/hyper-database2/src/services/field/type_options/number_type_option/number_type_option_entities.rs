use crate::services::cell::{CellBytesCustomParser, CellProtobufBlobParser};
use bytes::Bytes;
use collab_database::fields::number_type_option::{NumberCellFormat, NumberFormat};
use hyper_error::HyperResult;

pub struct NumberCellDataParser();
impl CellProtobufBlobParser for NumberCellDataParser {
  type Object = NumberCellFormat;
  fn parser(bytes: &Bytes) -> HyperResult<Self::Object> {
    match String::from_utf8(bytes.to_vec()) {
      Ok(s) => NumberCellFormat::from_format_str(&s, &NumberFormat::Num).map_err(Into::into),
      Err(_) => Ok(NumberCellFormat::default()),
    }
  }
}

pub struct NumberCellCustomDataParser(pub NumberFormat);
impl CellBytesCustomParser for NumberCellCustomDataParser {
  type Object = NumberCellFormat;
  fn parse(&self, bytes: &Bytes) -> HyperResult<Self::Object> {
    match String::from_utf8(bytes.to_vec()) {
      Ok(s) => NumberCellFormat::from_format_str(&s, &self.0).map_err(Into::into),
      Err(_) => Ok(NumberCellFormat::default()),
    }
  }
}
