use crate::{ErrorCode, HyperError};
#[cfg(feature = "impl_from_collab_persistence")]
use collab_plugins::local_storage::kv::PersistenceError;

#[cfg(feature = "impl_from_collab_persistence")]
impl From<PersistenceError> for HyperError {
  fn from(err: PersistenceError) -> Self {
    match err {
      PersistenceError::UnexpectedEmptyUpdates => HyperError::new(ErrorCode::RecordNotFound, err),
      #[cfg(not(target_arch = "wasm32"))]
      PersistenceError::RocksdbCorruption(_) => HyperError::new(ErrorCode::RocksdbCorruption, err),
      #[cfg(not(target_arch = "wasm32"))]
      PersistenceError::RocksdbIOError(_) => HyperError::new(ErrorCode::RocksdbIOError, err),
      _ => HyperError::new(ErrorCode::RocksdbInternal, err),
    }
  }
}
