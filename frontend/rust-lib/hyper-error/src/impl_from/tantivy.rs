use tantivy::{directory::error::OpenDirectoryError, query::QueryParserError, TantivyError};

use crate::{ErrorCode, HyperError};

impl std::convert::From<TantivyError> for HyperError {
  fn from(error: TantivyError) -> Self {
    HyperError::new(ErrorCode::IndexWriterFailedCommit, error)
  }
}

impl std::convert::From<OpenDirectoryError> for HyperError {
  fn from(error: OpenDirectoryError) -> Self {
    HyperError::new(ErrorCode::FailedToOpenIndexDir, error)
  }
}

impl std::convert::From<QueryParserError> for HyperError {
  fn from(error: QueryParserError) -> Self {
    HyperError::new(ErrorCode::FailedToParseQuery, error)
  }
}
