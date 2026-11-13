//! Initialize actual newly created collabs; never replay a captured snapshot to the server.
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use collab::lock::RwLock;
use collab_database::database::Database;
use collab_database::rows::RowId;
use collab_entity::CollabType;
use collab_integrate::collab_builder::{AppFlowyCollabBuilder, CollabBuilderConfig};
use collab_integrate::{CollabKVAction, CollabKVDB};
use collab_plugins::local_storage::kv::{KVStore, KVTransactionDB};
use flowy_error::{FlowyError, FlowyResult, internal_error};
use uuid::Uuid;

use crate::DatabaseUser;
use crate::hyper_duplicate::HyperDatabaseDuplicateScope;

pub(crate) fn interrupted() -> FlowyError {
  FlowyError::invalid_data().with_context("Dataset creation did not complete. Existing data was kept. Reopen the workspace and inspect it before trying again.")
}

/// Long-lived services keep a weak physical identity, so closing a workspace can release its DB.
#[derive(Clone)]
pub(crate) struct HyperDatabaseCreationOwner {
  pub uid: i64,
  pub workspace: Uuid,
  pub db: Weak<CollabKVDB>,
  user: Arc<dyn DatabaseUser>,
  epoch: Arc<AtomicU64>,
  expected_epoch: u64,
  changes: Option<tokio::sync::watch::Sender<u64>>,
}

impl HyperDatabaseCreationOwner {
  pub fn capture(
    user: Arc<dyn DatabaseUser>,
    epoch: Arc<AtomicU64>,
    expected_epoch: u64,
  ) -> FlowyResult<Self> {
    let uid = user.user_id()?;
    let workspace = user.workspace_id()?;
    let db = user.collab_db(uid)?;
    let owner = Self {
      uid,
      workspace,
      db,
      user,
      epoch,
      expected_epoch,
      changes: None,
    };
    owner.check()?;
    Ok(owner)
  }

  pub fn with_changes(mut self, changes: tokio::sync::watch::Sender<u64>) -> Self {
    self.changes = Some(changes);
    self
  }

  pub async fn run_if_current<T>(
    &self,
    operation: impl std::future::Future<Output = FlowyResult<T>>,
  ) -> FlowyResult<T> {
    self.check()?;
    let result = if let Some(changes) = &self.changes {
      let mut changes = changes.subscribe();
      self.check()?;
      tokio::select! { biased;
        _ = changes.changed() => return Err(interrupted()),
        value = operation => value,
      }
    } else {
      operation.await
    };
    self.check()?;
    result
  }

  pub fn check(&self) -> FlowyResult<()> {
    if self.epoch.load(Ordering::SeqCst) != self.expected_epoch {
      return Err(interrupted());
    }
    let original = self.db.upgrade().ok_or_else(interrupted)?;
    if self.user.user_id()? != self.uid
      || self.user.workspace_id()? != self.workspace
      || !self
        .user
        .collab_db(self.uid)?
        .upgrade()
        .is_some_and(|active| Arc::ptr_eq(&active, &original))
    {
      return Err(interrupted());
    }
    // The active identity must also remain usable. A logical close is rejected
    // by the current-user lookup above even if another Arc retains the old DB;
    // this nonmutating transaction propagates a physical storage read failure.
    original
      .read_txn()
      .get(b"\0HyperTask:dataset-owner-health")
      .map_err(internal_error)?;
    Ok(())
  }
}

pub(crate) fn validate_new_ids(database_id: &str, ids: &[RowId]) -> FlowyResult<()> {
  Uuid::parse_str(database_id).map_err(internal_error)?;
  let mut seen = HashSet::new();
  for id in ids {
    Uuid::parse_str(id.as_str()).map_err(internal_error)?;
    if !seen.insert(id.as_str()) {
      return Err(interrupted());
    }
  }
  Ok(())
}

/// The workspace write guard remains held by the caller until this function succeeds.
pub(crate) async fn finalize_created_database(
  scope: &HyperDatabaseDuplicateScope,
  gate: &std::sync::Mutex<()>,
  builder: &AppFlowyCollabBuilder,
  database: &Arc<RwLock<Database>>,
  database_id: &str,
  expected_rows: &[RowId],
) -> FlowyResult<()> {
  scope.check()?;
  let actual = {
    let data = database.read().await;
    scope.check()?;
    if data.get_database_id() != database_id || data.origin().client_user_id() != Some(scope.uid) {
      return Err(interrupted());
    }
    data
      .get_all_row_orders()
      .await
      .into_iter()
      .map(|order| order.id)
      .collect::<Vec<_>>()
  };
  scope.check()?;
  if actual != expected_rows {
    return Err(interrupted());
  }

  // Constructed rows precede editor subscriptions. They need their own sync plugins,
  // rather than waiting for a user edit or a view-row-order event that already happened.
  for id in expected_rows {
    let row = database
      .read()
      .await
      .get_or_init_database_row(id)
      .await
      .ok_or_else(interrupted)?;
    scope.check()?;
    {
      let value = row.read().await;
      scope.check()?;
      let data = value.get_row().ok_or_else(interrupted)?;
      if data.id != *id || data.database_id != database_id {
        return Err(interrupted());
      }
    }
    let _guard = gate.lock().map_err(|_| interrupted())?;
    scope.check()?;
    let object = builder.collab_object(
      &scope.workspace_id,
      scope.uid,
      &Uuid::parse_str(id.as_str()).map_err(internal_error)?,
      CollabType::DatabaseRow,
    )?;
    builder
      .finalize(object, CollabBuilderConfig::default(), row)
      .map_err(internal_error)?;
    scope.check()?;
  }
  let _guard = gate.lock().map_err(|_| interrupted())?;
  scope.check()?;
  let object = builder.collab_object(
    &scope.workspace_id,
    scope.uid,
    &Uuid::parse_str(database_id).map_err(internal_error)?,
    CollabType::Database,
  )?;
  builder
    .finalize(object, CollabBuilderConfig::default(), database.clone())
    .map_err(internal_error)?;
  scope.check()
}

/// Copied views may have different row orders; initialize the exact committed union.
pub(crate) async fn finalize_committed_database(
  scope: &HyperDatabaseDuplicateScope,
  gate: &std::sync::Mutex<()>,
  builder: &AppFlowyCollabBuilder,
  database: &Arc<RwLock<Database>>,
  database_id: &str,
  expected: &std::collections::HashSet<String>,
) -> FlowyResult<()> {
  scope.check()?;
  let actual = {
    let data = database.read().await;
    scope.check()?;
    if data.get_database_id() != database_id || data.origin().client_user_id() != Some(scope.uid) {
      return Err(interrupted());
    }
    crate::hyper_duplicate::database_row_ids(&data)?
  };
  if actual
    .iter()
    .cloned()
    .collect::<std::collections::HashSet<_>>()
    != *expected
  {
    return Err(interrupted());
  }
  for id in actual {
    scope.check()?;
    if !scope
      .db
      .read_txn()
      .is_exist(scope.uid, &scope.workspace_id.to_string(), &id)
    {
      return Err(interrupted());
    }
    let row = database
      .read()
      .await
      .get_or_init_database_row(&id.clone().into())
      .await
      .ok_or_else(interrupted)?;
    {
      let data = row.read().await;
      scope.check()?;
      let data = data.get_row().ok_or_else(interrupted)?;
      if data.id.as_str() != id || data.database_id != database_id {
        return Err(interrupted());
      }
    }
    let _publication = gate.lock().map_err(|_| interrupted())?;
    scope.check()?;
    let object = builder.collab_object(
      &scope.workspace_id,
      scope.uid,
      &Uuid::parse_str(&id).map_err(internal_error)?,
      CollabType::DatabaseRow,
    )?;
    builder
      .finalize(object, CollabBuilderConfig::default(), row)
      .map_err(internal_error)?;
    scope.check()?;
  }
  let _publication = gate.lock().map_err(|_| interrupted())?;
  scope.check()?;
  let object = builder.collab_object(
    &scope.workspace_id,
    scope.uid,
    &Uuid::parse_str(database_id).map_err(internal_error)?,
    CollabType::Database,
  )?;
  builder
    .finalize(object, CollabBuilderConfig::default(), database.clone())
    .map_err(internal_error)?;
  scope.check()
}
