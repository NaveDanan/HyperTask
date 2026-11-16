use crate::HyperError;

impl std::convert::From<serde_json::Error> for HyperError {
  fn from(error: serde_json::Error) -> Self {
    HyperError::serde().with_context(error)
  }
}
