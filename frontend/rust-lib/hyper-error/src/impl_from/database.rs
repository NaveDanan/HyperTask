use crate::HyperError;
use hyper_sqlite::Error;

impl std::convert::From<hyper_sqlite::Error> for HyperError {
  fn from(error: hyper_sqlite::Error) -> Self {
    match error {
      Error::NotFound => HyperError::record_not_found(),
      _ => HyperError::internal().with_context(error),
    }
  }
}

impl std::convert::From<::r2d2::Error> for HyperError {
  fn from(error: r2d2::Error) -> Self {
    HyperError::internal().with_context(error)
  }
}
