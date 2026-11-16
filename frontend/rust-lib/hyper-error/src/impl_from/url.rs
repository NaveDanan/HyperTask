use crate::{ErrorCode, HyperError};

impl std::convert::From<url::ParseError> for HyperError {
  fn from(error: url::ParseError) -> Self {
    HyperError::new(ErrorCode::InvalidURL, "").with_context(error)
  }
}
