use reqwest::Error;

use crate::HyperError;

impl std::convert::From<reqwest::Error> for HyperError {
  fn from(error: Error) -> Self {
    HyperError::http().with_context(error)
  }
}
