use collab::error::CollabError;
use protobuf::ProtobufError;
use std::convert::TryInto;
use std::fmt::{Debug, Display};
use thiserror::Error;
use tokio::task::JoinError;
use validator::{ValidationError, ValidationErrors};

use hyper_derive::ProtoBuf;

use crate::code::ErrorCode;

pub type HyperResult<T> = anyhow::Result<T, HyperError>;

#[derive(Debug, Default, Clone, ProtoBuf, Error)]
#[error("code:{code}, message:{msg}")]
pub struct HyperError {
  #[pb(index = 1)]
  pub code: ErrorCode,

  #[pb(index = 2)]
  pub msg: String,

  #[pb(index = 3)]
  pub payload: Vec<u8>,
}

macro_rules! static_hyper_error {
  ($name:ident, $code:expr) => {
    #[allow(non_snake_case, missing_docs)]
    pub fn $name() -> HyperError {
      $code.into()
    }
  };
}

impl HyperError {
  pub fn new<T: ToString>(code: ErrorCode, msg: T) -> Self {
    Self {
      code,
      msg: msg.to_string(),
      payload: vec![],
    }
  }
  pub fn with_context<T: Display>(mut self, error: T) -> Self {
    self.msg = format!("{}", error);
    self
  }

  pub fn with_payload<T: TryInto<Vec<u8>, Error = ProtobufError>>(mut self, payload: T) -> Self {
    self.payload = payload.try_into().unwrap_or_default();
    self
  }

  pub fn is_record_not_found(&self) -> bool {
    self.code == ErrorCode::RecordNotFound
  }

  pub fn is_already_exists(&self) -> bool {
    self.code == ErrorCode::RecordAlreadyExists
  }

  pub fn is_unauthorized(&self) -> bool {
    self.code == ErrorCode::UserUnauthorized || self.code == ErrorCode::RecordNotFound
  }

  pub fn is_invalid_data(&self) -> bool {
    self.code == ErrorCode::InvalidParams
  }

  pub fn is_local_version_not_support(&self) -> bool {
    self.code == ErrorCode::LocalVersionNotSupport
  }

  pub fn is_file_limit_exceeded(&self) -> bool {
    self.code == ErrorCode::FileStorageLimitExceeded
  }

  pub fn is_single_file_limit_exceeded(&self) -> bool {
    self.code == ErrorCode::SingleUploadLimitExceeded
  }

  pub fn should_retry_upload(&self) -> bool {
    !matches!(
      self.code,
      ErrorCode::FileStorageLimitExceeded | ErrorCode::SingleUploadLimitExceeded
    )
  }

  pub fn is_ai_response_limit_exceeded(&self) -> bool {
    self.code == ErrorCode::AIResponseLimitExceeded
  }

  pub fn is_ai_image_response_limit_exceeded(&self) -> bool {
    self.code == ErrorCode::AIImageResponseLimitExceeded
  }

  pub fn is_local_ai_not_ready(&self) -> bool {
    self.code == ErrorCode::LocalAINotReady
  }

  pub fn is_local_ai_disabled(&self) -> bool {
    self.code == ErrorCode::LocalAIDisabled
  }

  pub fn is_ai_max_required(&self) -> bool {
    self.code == ErrorCode::AIMaxRequired
  }

  static_hyper_error!(internal, ErrorCode::Internal);
  static_hyper_error!(record_not_found, ErrorCode::RecordNotFound);
  static_hyper_error!(workspace_initialize, ErrorCode::WorkspaceInitializeError);
  static_hyper_error!(view_name, ErrorCode::ViewNameInvalid);
  static_hyper_error!(view_thumbnail, ErrorCode::ViewThumbnailInvalid);
  static_hyper_error!(invalid_view_id, ErrorCode::ViewIdIsInvalid);
  static_hyper_error!(view_data, ErrorCode::ViewDataInvalid);
  static_hyper_error!(unauthorized, ErrorCode::UserUnauthorized);
  static_hyper_error!(email_empty, ErrorCode::EmailIsEmpty);
  static_hyper_error!(email_format, ErrorCode::EmailFormatInvalid);
  static_hyper_error!(email_exist, ErrorCode::EmailAlreadyExists);
  static_hyper_error!(password_empty, ErrorCode::PasswordIsEmpty);
  static_hyper_error!(passworkd_too_long, ErrorCode::PasswordTooLong);
  static_hyper_error!(
    password_forbid_char,
    ErrorCode::PasswordContainsForbidCharacters
  );
  static_hyper_error!(password_format, ErrorCode::PasswordFormatInvalid);
  static_hyper_error!(password_not_match, ErrorCode::PasswordNotMatch);
  static_hyper_error!(name_too_long, ErrorCode::UserNameTooLong);
  static_hyper_error!(
    name_forbid_char,
    ErrorCode::UserNameContainForbiddenCharacters
  );
  static_hyper_error!(name_empty, ErrorCode::UserNameIsEmpty);
  static_hyper_error!(user_id, ErrorCode::UserIdInvalid);
  static_hyper_error!(text_too_long, ErrorCode::TextTooLong);
  static_hyper_error!(invalid_data, ErrorCode::InvalidParams);
  static_hyper_error!(out_of_bounds, ErrorCode::OutOfBounds);
  static_hyper_error!(serde, ErrorCode::Serde);
  static_hyper_error!(field_record_not_found, ErrorCode::FieldRecordNotFound);
  static_hyper_error!(payload_none, ErrorCode::UnexpectedEmpty);
  static_hyper_error!(http, ErrorCode::NetworkError);
  static_hyper_error!(
    unexpect_calendar_field_type,
    ErrorCode::UnexpectedCalendarFieldType
  );
  static_hyper_error!(collab_not_sync, ErrorCode::CollabDataNotSync);
  static_hyper_error!(server_error, ErrorCode::InternalServerError);
  static_hyper_error!(not_support, ErrorCode::NotSupportYet);
  static_hyper_error!(local_version_not_support, ErrorCode::LocalVersionNotSupport);
  static_hyper_error!(
    folder_index_manager_unavailable,
    ErrorCode::FolderIndexManagerUnavailable
  );
  static_hyper_error!(workspace_data_not_match, ErrorCode::WorkspaceDataNotMatch);
  static_hyper_error!(local_ai, ErrorCode::LocalAIError);
  static_hyper_error!(local_ai_unavailable, ErrorCode::LocalAIUnavailable);
  static_hyper_error!(response_timeout, ErrorCode::ResponseTimeout);
  static_hyper_error!(file_storage_limit, ErrorCode::FileStorageLimitExceeded);

  static_hyper_error!(view_is_locked, ErrorCode::ViewIsLocked);
  static_hyper_error!(local_ai_not_ready, ErrorCode::LocalAINotReady);
  static_hyper_error!(local_ai_disabled, ErrorCode::LocalAIDisabled);
  static_hyper_error!(user_not_login, ErrorCode::UserNotLogin);
  static_hyper_error!(ref_drop, ErrorCode::WeakRefDrop);
}

impl std::convert::From<ErrorCode> for HyperError {
  fn from(code: ErrorCode) -> Self {
    let msg = format!("{}", code);
    HyperError {
      code,
      msg,
      payload: vec![],
    }
  }
}

pub fn internal_error<T>(e: T) -> HyperError
where
  T: std::fmt::Debug,
{
  HyperError::internal().with_context(format!("{:?}", e))
}

impl std::convert::From<std::io::Error> for HyperError {
  fn from(error: std::io::Error) -> Self {
    HyperError::internal().with_context(error)
  }
}

impl std::convert::From<protobuf::ProtobufError> for HyperError {
  fn from(e: protobuf::ProtobufError) -> Self {
    HyperError::internal().with_context(e)
  }
}

impl From<ValidationError> for HyperError {
  fn from(value: ValidationError) -> Self {
    HyperError::new(ErrorCode::InvalidParams, value)
  }
}

impl From<ValidationErrors> for HyperError {
  fn from(value: ValidationErrors) -> Self {
    HyperError::new(ErrorCode::InvalidParams, value)
  }
}

impl From<anyhow::Error> for HyperError {
  fn from(e: anyhow::Error) -> Self {
    e.downcast::<HyperError>()
      .unwrap_or_else(|err| HyperError::new(ErrorCode::Internal, err))
  }
}

impl From<fancy_regex::Error> for HyperError {
  fn from(e: fancy_regex::Error) -> Self {
    HyperError::internal().with_context(e)
  }
}

impl From<JoinError> for HyperError {
  fn from(e: JoinError) -> Self {
    HyperError::internal().with_context(e)
  }
}

impl From<tokio::sync::oneshot::error::RecvError> for HyperError {
  fn from(e: tokio::sync::oneshot::error::RecvError) -> Self {
    HyperError::internal().with_context(e)
  }
}

impl From<String> for HyperError {
  fn from(e: String) -> Self {
    HyperError::internal().with_context(e)
  }
}

impl From<collab::error::CollabError> for HyperError {
  fn from(value: CollabError) -> Self {
    match value {
      CollabError::SerdeJson(err) => HyperError::serde().with_context(err),
      CollabError::UnexpectedEmpty(err) => HyperError::payload_none().with_context(err),
      CollabError::AcquiredWriteTxnFail => HyperError::internal(),
      CollabError::AcquiredReadTxnFail => HyperError::internal(),
      CollabError::YrsTransactionError(err) => HyperError::internal().with_context(err),
      CollabError::YrsEncodeStateError(err) => HyperError::internal().with_context(err),
      CollabError::UndoManagerNotEnabled => {
        HyperError::not_support().with_context("UndoManager is not enabled")
      },
      CollabError::DecodeUpdate(err) => HyperError::internal().with_context(err),
      CollabError::NoRequiredData(err) => HyperError::internal().with_context(err),
      CollabError::Awareness(err) => HyperError::internal().with_context(err),
      CollabError::UpdateFailed(err) => HyperError::internal().with_context(err),
      CollabError::Internal(err) => HyperError::internal().with_context(err),
    }
  }
}

impl From<uuid::Error> for HyperError {
  fn from(value: uuid::Error) -> Self {
    HyperError::internal().with_context(value)
  }
}

impl From<ollama_rs::error::OllamaError> for HyperError {
  fn from(value: ollama_rs::error::OllamaError) -> Self {
    HyperError::local_ai().with_context(value)
  }
}
