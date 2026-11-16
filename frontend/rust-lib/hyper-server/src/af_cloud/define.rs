use collab_plugins::CollabKVDB;
use hyper_ai_pub::user_service::AIUserService;
use hyper_error::{HyperError, HyperResult};
use hyper_sqlite::DBConnection;
use hyper_user_pub::entities::WorkspaceType;
use lib_infra::async_trait::async_trait;
use std::path::PathBuf;
use std::sync::{Arc, Weak};
use uuid::Uuid;

pub const USER_SIGN_IN_URL: &str = "sign_in_url";
pub const USER_UUID: &str = "uuid";
pub const USER_EMAIL: &str = "email";
pub const USER_DEVICE_ID: &str = "device_id";

/// Represents a user that is currently using the server.
#[async_trait]
pub trait LoggedUser: Send + Sync {
  /// different user might return different workspace id.
  fn workspace_id(&self) -> HyperResult<Uuid>;
  fn workspace_type(&self) -> HyperResult<WorkspaceType>;

  fn user_id(&self) -> HyperResult<i64>;
  async fn is_local_mode(&self) -> HyperResult<bool>;

  fn get_sqlite_db(&self, uid: i64) -> Result<DBConnection, HyperError>;

  fn get_collab_db(&self, uid: i64) -> Result<Weak<CollabKVDB>, HyperError>;

  fn application_root_dir(&self) -> Result<PathBuf, HyperError>;
}

//
pub struct AIUserServiceImpl(pub Weak<dyn LoggedUser>);

impl AIUserServiceImpl {
  fn logged_user(&self) -> HyperResult<Arc<dyn LoggedUser>> {
    self
      .0
      .upgrade()
      .ok_or_else(|| HyperError::internal().with_context("User is not logged in"))
  }
}

#[async_trait]
impl AIUserService for AIUserServiceImpl {
  fn user_id(&self) -> Result<i64, HyperError> {
    self.logged_user()?.user_id()
  }

  async fn is_local_model(&self) -> HyperResult<bool> {
    self.logged_user()?.is_local_mode().await
  }

  fn workspace_id(&self) -> Result<Uuid, HyperError> {
    self.logged_user()?.workspace_id()
  }

  fn workspace_type(&self) -> HyperResult<WorkspaceType> {
    self.logged_user()?.workspace_type()
  }

  fn sqlite_connection(&self, uid: i64) -> Result<DBConnection, HyperError> {
    self.logged_user()?.get_sqlite_db(uid)
  }

  fn application_root_dir(&self) -> Result<PathBuf, HyperError> {
    self.logged_user()?.application_root_dir()
  }
}
