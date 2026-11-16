use hyper_error::{HyperError, HyperResult};
use hyper_sqlite::DBConnection;
use hyper_user_pub::entities::WorkspaceType;
use lib_infra::async_trait::async_trait;
use std::path::PathBuf;
use uuid::Uuid;

#[async_trait]
pub trait AIUserService: Send + Sync + 'static {
  fn user_id(&self) -> Result<i64, HyperError>;
  async fn is_local_model(&self) -> HyperResult<bool>;
  fn workspace_id(&self) -> Result<Uuid, HyperError>;

  fn workspace_type(&self) -> HyperResult<WorkspaceType>;

  fn sqlite_connection(&self, uid: i64) -> Result<DBConnection, HyperError>;
  fn application_root_dir(&self) -> Result<PathBuf, HyperError>;
}
