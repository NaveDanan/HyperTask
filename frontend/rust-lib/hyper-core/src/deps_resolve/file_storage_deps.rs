use hyper_error::HyperError;
use hyper_sqlite::DBConnection;
use hyper_storage::manager::{StorageManager, StorageUserService};
use hyper_storage_pub::cloud::StorageCloudService;
use hyper_user::services::authenticate_user::AuthenticateUser;
use std::sync::{Arc, Weak};
use uuid::Uuid;

pub struct FileStorageResolver;

impl FileStorageResolver {
  pub fn resolve(
    authenticate_user: Weak<AuthenticateUser>,
    cloud_service: Arc<dyn StorageCloudService>,
    root: &str,
  ) -> Arc<StorageManager> {
    let user_service = FileStorageServiceImpl {
      user: authenticate_user,
      root_dir: root.to_owned(),
    };
    Arc::new(StorageManager::new(cloud_service, Arc::new(user_service)))
  }
}

struct FileStorageServiceImpl {
  user: Weak<AuthenticateUser>,
  root_dir: String,
}
impl FileStorageServiceImpl {
  fn upgrade_user(&self) -> Result<Arc<AuthenticateUser>, HyperError> {
    let user = self
      .user
      .upgrade()
      .ok_or(HyperError::internal().with_context("Unexpected error: UserSession is None"))?;
    Ok(user)
  }
}

impl StorageUserService for FileStorageServiceImpl {
  fn user_id(&self) -> Result<i64, HyperError> {
    self.upgrade_user()?.user_id()
  }

  fn workspace_id(&self) -> Result<Uuid, HyperError> {
    self.upgrade_user()?.workspace_id()
  }

  fn sqlite_connection(&self, uid: i64) -> Result<DBConnection, HyperError> {
    self.upgrade_user()?.get_sqlite_connection(uid)
  }

  fn get_application_root_dir(&self) -> &str {
    &self.root_dir
  }
}
