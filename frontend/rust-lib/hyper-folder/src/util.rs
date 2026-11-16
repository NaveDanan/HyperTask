use crate::entities::UserFolderPB;
use hyper_error::{ErrorCode, HyperError};
use uuid::Uuid;

pub(crate) fn folder_not_init_error() -> HyperError {
  HyperError::internal().with_context("Folder not initialized")
}

pub(crate) fn workspace_data_not_sync_error(uid: i64, workspace_id: &Uuid) -> HyperError {
  HyperError::from(ErrorCode::WorkspaceDataNotSync).with_payload(UserFolderPB {
    uid,
    workspace_id: workspace_id.to_string(),
  })
}
