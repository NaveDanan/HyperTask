//! Native copies retain CRDT data and change only explicitly mapped identifiers.
use std::borrow::{Borrow, BorrowMut};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};

use crate::{DatabaseManager, DatabaseUser};
use async_trait::async_trait;
use collab::core::collab::TransactionMutExt;
use collab::core::{collab::DataSource, origin::CollabOrigin};
use collab::lock::RwLock;
use collab::preclude::updates::decoder::Decode;
use collab::preclude::*;
use collab_database::database::Database;
pub use collab_database::entity::EncodedCollabInfo;
use collab_database::rows::RowId;
use collab_database::rows::{RowMetaKey, meta_id_from_row_id};
use collab_database::workspace_database::WorkspaceDatabase;
use collab_database::workspace_database::WorkspaceDatabaseManager;
use collab_entity::define::{
  DATABASE, DATABASE_ID, DATABASE_INLINE_VIEW, DATABASE_METAS, DATABASE_ROW_DATA,
};
use collab_entity::{CollabType, EncodedCollab};
use collab_integrate::CollabKVAction;
use collab_integrate::CollabKVDB;
use collab_plugins::local_storage::kv::{KVStore, KVTransactionDB};
use flowy_error::{FlowyError, FlowyResult, internal_error};
use strum::IntoEnumIterator;
use uuid::Uuid;

#[derive(Clone)]
pub struct HyperDatabaseDuplicateScope {
  pub uid: i64,
  pub workspace_id: Uuid,
  pub db: Arc<CollabKVDB>,
  pub current: Arc<dyn Fn() -> bool + Send + Sync>,
  pub cloud: Option<Arc<dyn flowy_database_pub::cloud::DatabaseCloudService>>,
  pub(crate) context: Option<Arc<RwLock<WorkspaceDatabaseManager>>>,
  pub(crate) changes: Option<tokio::sync::watch::Sender<u64>>,
}

#[derive(Clone)]
pub(crate) struct HyperDuplicateContext {
  pub epoch: u64,
  pub uid: i64,
  pub workspace_id: Uuid,
  pub db: Weak<CollabKVDB>,
  pub context: Weak<RwLock<WorkspaceDatabaseManager>>,
}
impl HyperDatabaseDuplicateScope {
  pub fn check(&self) -> FlowyResult<()> {
    if (self.current)() {
      self
        .db
        .read_txn()
        .get(b"\0HyperTask:dataset-owner-health")
        .map_err(internal_error)?;
      Ok(())
    } else {
      Err(invalid(
        "The account or workspace changed while copying. Reopen the source.",
      ))
    }
  }

  pub(crate) async fn run_if_current<F: std::future::Future>(
    &self,
    operation: F,
  ) -> FlowyResult<F::Output> {
    self.check()?;
    if let Some(changes) = &self.changes {
      let mut changes = changes.subscribe();
      self.check()?;
      tokio::select! { biased;
        _ = changes.changed() => Err(invalid("The copy owner changed. Reopen the original workspace before retrying.")),
        result = operation => { self.check()?; Ok(result) },
      }
    } else {
      let result = operation.await;
      self.check()?;
      Ok(result)
    }
  }
}

pub struct HyperDuplicateDateCell {
  pub field_id: String,
  pub source_id: String,
  pub target_id: String,
}

pub struct HyperDuplicateRow {
  pub source_row_id: String,
  pub target_row_id: String,
  pub source_document_id: Uuid,
  pub target_document_id: Uuid,
  pub source_view_ids: Vec<String>,
  pub target_view_id: String,
  pub has_document: bool,
  pub date_cells: Vec<HyperDuplicateDateCell>,
}

pub struct HyperCopiedBody {
  pub document_id: Uuid,
  pub required: bool,
}

#[async_trait]
pub trait HyperDatabaseDuplicateHook: Send + Sync {
  async fn check_row_access(
    &self,
    scope: &HyperDatabaseDuplicateScope,
    _view: &str,
  ) -> FlowyResult<()> {
    scope.check()
  }
  /// Validate and add document/timer sidecars, then persist every collab atomically.
  async fn persist(
    &self,
    scope: HyperDatabaseDuplicateScope,
    rows: Vec<HyperDuplicateRow>,
    objects: Vec<EncodedCollabInfo>,
    replace: HashSet<String>,
  ) -> FlowyResult<()>;

  /// Start ordinary sync from current committed target state, never a saved copy snapshot.
  async fn initialize_committed(
    &self,
    scope: HyperDatabaseDuplicateScope,
    _documents: Vec<HyperCopiedBody>,
  ) -> FlowyResult<()> {
    scope.check()
  }
}

pub(crate) fn invalid(message: impl Into<String>) -> FlowyError {
  FlowyError::invalid_data().with_context(message.into())
}

pub fn hyper_duplicate_collab(source: &Collab, target: &str) -> FlowyResult<Collab> {
  let encoded = source.encode_collab_v1(|_| Ok::<_, FlowyError>(()))?;
  hyper_duplicate_encoded(&encoded, target)
}

pub fn hyper_duplicate_encoded(source: &EncodedCollab, target: &str) -> FlowyResult<Collab> {
  Collab::new_with_source(
    CollabOrigin::Empty,
    target,
    DataSource::DocStateV1(source.doc_state.to_vec()),
    vec![],
    false,
  )
  .map_err(internal_error)
}

pub(crate) fn map<T: ReadTxn>(container: &MapRef, txn: &T, key: &str) -> FlowyResult<MapRef> {
  container
    .get(txn, key)
    .and_then(|value| value.cast().ok())
    .ok_or_else(|| {
      invalid(format!(
        "The copied data has an unsupported or missing {key} map."
      ))
    })
}
pub(crate) fn string<T: ReadTxn>(container: &MapRef, txn: &T, key: &str) -> FlowyResult<String> {
  container
    .get(txn, key)
    .and_then(|value| value.cast().ok())
    .ok_or_else(|| {
      invalid(format!(
        "The copied data has an unsupported or missing {key}."
      ))
    })
}

pub(crate) fn database_row_ids(collab: &Collab) -> FlowyResult<Vec<String>> {
  let txn = collab.transact();
  let root = map(&collab.data, &txn, DATABASE)?;
  let views = map(&root, &txn, "views")?;
  let mut ids = HashSet::new();
  for (_, value) in views.iter(&txn) {
    let view: MapRef = value
      .cast()
      .map_err(|_| invalid("An unsupported database view cannot be copied."))?;
    let orders: ArrayRef = view
      .get(&txn, "row_orders")
      .and_then(|value| value.cast().ok())
      .ok_or_else(|| invalid("A database view has no row order."))?;
    let mut seen = HashSet::new();
    for order in orders.iter(&txn) {
      let YrsValue::Any(Any::Map(order)) = order else {
        return Err(invalid("An unsupported row order cannot be copied."));
      };
      let Some(Any::String(id)) = order.get("id") else {
        return Err(invalid("A database row order has no ID."));
      };
      Uuid::parse_str(id).map_err(|_| invalid("An unsupported row ID cannot be copied."))?;
      if !seen.insert(id.to_string()) {
        return Err(invalid("A database view contains repeated row IDs."));
      }
      ids.insert(id.to_string());
    }
  }
  let mut ids: Vec<_> = ids.into_iter().collect();
  ids.sort();
  Ok(ids)
}

pub(crate) fn remap_database(
  source: &Collab,
  target_database: &str,
  source_view: &str,
  target_view: &Uuid,
  rows: &HashMap<String, String>,
) -> FlowyResult<(Collab, HashMap<String, String>)> {
  let mut copied = hyper_duplicate_collab(source, target_database)?;
  let mut txn = copied.context.transact_mut();
  let root = map(&copied.data, &txn, DATABASE)?;
  let source_database = string(&root, &txn, DATABASE_ID)?;
  root.insert(&mut txn, DATABASE_ID, target_database);
  let metas = map(&root, &txn, DATABASE_METAS)?;
  let inline = string(&metas, &txn, DATABASE_INLINE_VIEW)?;
  let views = map(&root, &txn, "views")?;
  let originals: Vec<_> = views
    .iter(&txn)
    .map(|(id, value)| (id.to_string(), value.as_prelim(&txn)))
    .collect();
  let mut mapping = HashMap::new();
  for (id, _) in &originals {
    let target = if id == source_view {
      target_view.to_string()
    } else {
      Uuid::new_v5(
        target_view,
        format!("HyperTask:database-view-copy:v1:{id}").as_bytes(),
      )
      .to_string()
    };
    mapping.insert(id.clone(), target);
  }
  if !mapping.contains_key(source_view) || !mapping.contains_key(&inline) {
    return Err(invalid("The copied database view is missing."));
  }
  for (old_id, value) in originals {
    let view: MapRef = views
      .insert(&mut txn, mapping[&old_id].clone(), value)
      .cast()
      .map_err(|_| invalid("An unsupported view cannot be copied."))?;
    if string(&view, &txn, "id")? != old_id
      || string(&view, &txn, "database_id")? != source_database
    {
      return Err(invalid("The database has inconsistent view IDs."));
    }
    view.insert(&mut txn, "id", mapping[&old_id].clone());
    view.insert(&mut txn, "database_id", target_database);
    let orders: ArrayRef = view
      .get(&txn, "row_orders")
      .and_then(|value| value.cast().ok())
      .ok_or_else(|| invalid("A database view has no row order."))?;
    let values: Vec<_> = orders.iter(&txn).collect();
    for (index, value) in values.into_iter().enumerate() {
      let YrsValue::Any(Any::Map(order)) = value else {
        return Err(invalid("An unsupported row order cannot be copied."));
      };
      let Some(Any::String(old)) = order.get("id") else {
        return Err(invalid("A database row order has no ID."));
      };
      let mut next = (*order).clone();
      next.insert(
        "id".into(),
        Any::String(
          rows
            .get(old.as_ref())
            .ok_or_else(|| invalid("A database row was not captured."))?
            .clone()
            .into(),
        ),
      );
      orders.remove(&mut txn, index as u32);
      orders.insert(&mut txn, index as u32, Any::Map(Arc::new(next)));
    }
    views.remove(&mut txn, &old_id);
  }
  metas.insert(&mut txn, DATABASE_INLINE_VIEW, mapping[&inline].clone());
  drop(txn);
  Ok((copied, mapping))
}

pub(crate) fn remap_row(
  source: &Collab,
  source_row: &Uuid,
  target_row: &Uuid,
  source_database: &str,
  target_database: &str,
) -> FlowyResult<(Collab, bool, Vec<HyperDuplicateDateCell>)> {
  let mut copied = hyper_duplicate_collab(source, &target_row.to_string())?;
  let mut txn = copied.context.transact_mut();
  let data = map(&copied.data, &txn, DATABASE_ROW_DATA)?;
  if string(&data, &txn, "id")? != source_row.to_string()
    || string(&data, &txn, "database_id")? != source_database
  {
    return Err(invalid("The database has inconsistent row IDs."));
  }
  data.insert(&mut txn, "id", target_row.to_string());
  data.insert(&mut txn, "database_id", target_database);
  let meta = map(&copied.data, &txn, "meta")?;
  let has_document = match meta.get(
    &txn,
    &meta_id_from_row_id(source_row, RowMetaKey::IsDocumentEmpty),
  ) {
    None | Some(YrsValue::Any(Any::Bool(true))) => false,
    Some(YrsValue::Any(Any::Bool(false))) => true,
    _ => return Err(invalid("The row document metadata is unsupported.")),
  };
  for key in RowMetaKey::iter() {
    let old = meta_id_from_row_id(source_row, key.clone());
    if let Some(value) = meta.get(&txn, &old) {
      let value = value.as_prelim(&txn);
      meta.remove(&mut txn, &old);
      meta.insert(&mut txn, meta_id_from_row_id(target_row, key), value);
    }
  }
  let cells = map(&data, &txn, "cells")?;
  let mut reminders = Vec::new();
  let captured_cells: Vec<_> = cells
    .iter(&txn)
    .map(|(id, value)| (id.to_string(), value))
    .collect();
  for (field_id, value) in captured_cells {
    let cell: MapRef = value
      .cast()
      .map_err(|_| invalid("An unsupported database cell cannot be copied."))?;
    let Some(reminder) = cell.get(&txn, "reminder_id") else {
      continue;
    };
    let old: String = reminder
      .cast()
      .map_err(|_| invalid("An unsupported reminder ID cannot be copied."))?;
    if old.is_empty() {
      continue;
    }
    match cell.get(&txn, "field_type") {
      Some(YrsValue::Any(Any::BigInt(2))) | Some(YrsValue::Any(Any::Number(2.0))) => {},
      _ => {
        return Err(invalid(
          "A reminder in an unsupported cell cannot be copied.",
        ));
      },
    }
    let target = Uuid::new_v5(
      target_row,
      serde_json::to_string(&["HyperTask:database-date-reminder-copy:v1", &field_id, &old])
        .map_err(internal_error)?
        .as_bytes(),
    )
    .to_string();
    cell.insert(&mut txn, "reminder_id", target.clone());
    reminders.push(HyperDuplicateDateCell {
      field_id: field_id.to_string(),
      source_id: old,
      target_id: target,
    });
  }
  drop(txn);
  Ok((copied, has_document, reminders))
}

pub(crate) fn encoded(collab: &Collab, kind: CollabType) -> FlowyResult<EncodedCollabInfo> {
  let value = collab
    .encode_collab_v1(|value| kind.validate_require_data(value))
    .map_err(internal_error)?;
  Ok(EncodedCollabInfo {
    object_id: collab.object_id().to_string(),
    collab_type: kind,
    encoded_collab: value,
  })
}

pub(crate) fn user_scope(user: Arc<dyn DatabaseUser>) -> FlowyResult<HyperDatabaseDuplicateScope> {
  let uid = user.user_id()?;
  let workspace_id = user.workspace_id()?;
  let db = user
    .collab_db(uid)?
    .upgrade()
    .ok_or_else(FlowyError::ref_drop)?;
  let original = db.clone();
  let current = Arc::new(move || {
    user.user_id().ok() == Some(uid)
      && user.workspace_id().ok() == Some(workspace_id)
      && user
        .collab_db(uid)
        .ok()
        .and_then(|value| value.upgrade())
        .is_some_and(|active| Arc::ptr_eq(&active, &original))
  });
  Ok(HyperDatabaseDuplicateScope {
    uid,
    workspace_id,
    db,
    current,
    cloud: None,
    context: None,
    changes: None,
  })
}

async fn snapshot_collab(
  scope: &HyperDatabaseDuplicateScope,
  id: &str,
  kind: CollabType,
) -> FlowyResult<Collab> {
  scope.check()?;
  let local = {
    let read = scope.db.read_txn();
    if read.is_exist(scope.uid, &scope.workspace_id.to_string(), id) {
      let mut source = Collab::new(scope.uid, id, "duplicate-read", vec![], false);
      read
        .load_doc_with_txn(
          scope.uid,
          &scope.workspace_id.to_string(),
          id,
          &mut source.context.transact_mut(),
        )
        .map_err(internal_error)?;
      Some(source)
    } else {
      None
    }
  };
  let source = if let Some(source) = local {
    source
  } else {
    let cloud = scope.cloud.as_ref().ok_or_else(|| {
      invalid("A source row or database is unavailable. No empty copy was created.")
    })?;
    let value = cloud
      .get_database_encode_collab(
        &Uuid::parse_str(id).map_err(internal_error)?,
        kind,
        &scope.workspace_id,
      )
      .await?;
    scope.check()?;
    hyper_duplicate_encoded(
      &value
        .ok_or_else(|| invalid("A source row or database is missing. No rows were skipped."))?,
      id,
    )?
  };
  kind
    .validate_require_data(&source)
    .map_err(internal_error)?;
  scope.check()?;
  Ok(source)
}

async fn persist(
  scope: HyperDatabaseDuplicateScope,
  hook: Option<Arc<dyn HyperDatabaseDuplicateHook>>,
  rows: Vec<HyperDuplicateRow>,
  objects: Vec<EncodedCollabInfo>,
  replace: HashSet<String>,
) -> FlowyResult<()> {
  scope.check()?;
  if let Some(hook) = hook {
    return hook.persist(scope, rows, objects, replace).await;
  }
  if rows.iter().any(|row| {
    row.has_document
      || !row.date_cells.is_empty()
      || scope.db.read_txn().is_exist(
        scope.uid,
        &scope.workspace_id.to_string(),
        &row.source_document_id.to_string(),
      )
  }) {
    return Err(invalid(
      "Document and reminder copying is not available in this database context.",
    ));
  }
  // Standalone native database consumers without document/user managers can copy empty rows.
  let txn = scope.db.write_txn();
  let mut seen = HashSet::new();
  let workspace = scope.workspace_id.to_string();
  for object in &objects {
    if !seen.insert(object.object_id.as_str())
      || !replace.contains(&object.object_id)
        && txn.is_exist(scope.uid, &workspace, &object.object_id)
    {
      return Err(invalid(
        "A copy target already exists. It was kept without replacement.",
      ));
    }
    txn
      .flush_doc(
        scope.uid,
        &workspace,
        &object.object_id,
        object.encoded_collab.state_vector.to_vec(),
        object.encoded_collab.doc_state.to_vec(),
      )
      .map_err(internal_error)?;
  }
  scope.check()?;
  txn.commit_transaction().map_err(internal_error)
}

fn row_copy(
  source: &Collab,
  source_row: &Uuid,
  target_row: &Uuid,
  source_database: &str,
  target_database: &str,
  source_views: Vec<String>,
  target_view: &str,
) -> FlowyResult<(EncodedCollabInfo, HyperDuplicateRow)> {
  let (copied, has_document, date_cells) = remap_row(
    source,
    source_row,
    target_row,
    source_database,
    target_database,
  )?;
  let row = HyperDuplicateRow {
    source_row_id: source_row.to_string(),
    target_row_id: target_row.to_string(),
    source_document_id: Uuid::new_v5(source_row, RowMetaKey::DocumentId.as_str().as_bytes()),
    target_document_id: Uuid::new_v5(target_row, RowMetaKey::DocumentId.as_str().as_bytes()),
    source_view_ids: source_views,
    target_view_id: target_view.to_string(),
    has_document,
    date_cells,
  };
  Ok((encoded(&copied, CollabType::DatabaseRow)?, row))
}

fn apply_saved(collab: &mut Collab, value: &EncodedCollab) -> FlowyResult<()> {
  collab
    .transact_mut()
    .try_apply_update(Update::decode_v1(&value.doc_state).map_err(internal_error)?)
    .map_err(internal_error)
}

pub(crate) async fn duplicate_single_row(
  database: &Arc<RwLock<Database>>,
  scope: HyperDatabaseDuplicateScope,
  hook: Option<Arc<dyn HyperDatabaseDuplicateHook>>,
  view: &str,
  source_row: &RowId,
  operation_id: Option<&str>,
) -> FlowyResult<crate::entities::RowMetaPB> {
  scope.check()?;
  if let Some(hook) = &hook {
    hook.check_row_access(&scope, view).await?;
    scope.check()?;
  }
  let mut active = database.write().await;
  scope.check()?;
  let source_id = Uuid::parse_str(source_row).map_err(internal_error)?;
  let database_id = active.get_database_id();
  if active.get_view(view).is_none() {
    return Err(invalid("The database view is no longer available."));
  }
  let operation = operation_id
    .map(Uuid::parse_str)
    .transpose()
    .map_err(|_| invalid("The copy operation ID must be a UUID."))?;
  let target_id = operation
    .map(|operation| hyper_duplicate_row_target(&scope, &database_id, view, source_row, &operation))
    .unwrap_or_else(Uuid::new_v4);
  let marker = serde_json::json!({ "version":1, "operation_id":operation.unwrap_or_else(Uuid::new_v4).to_string(), "source_database_id":database_id, "source_view_id":view, "source_row_id":source_row.as_str(), "target_row_id":target_id.to_string() });
  let operation_key = Uuid::new_v5(
    &scope.workspace_id,
    serde_json::json!([
      "HyperTask:row-copy-record:v1",
      scope.uid,
      marker["operation_id"]
    ])
    .to_string()
    .as_bytes(),
  )
  .to_string();
  // Keep completion in the database, not only in the row that DeleteRows removes.
  let completed = {
    let txn = active.transact();
    let root = map(&active.data, &txn, DATABASE)?;
    match root.get(&txn, "hypertask:row-copy-operations:v1") {
      None => false,
      Some(value) => {
        let operations: MapRef = value
          .cast()
          .map_err(|_| invalid("The saved copy-operation metadata is unsupported. It was kept."))?;
        if let Some(stored) = operations.get(&txn, &operation_key) {
          if stored.to_json(&txn) != Any::from_json(&marker.to_string()).map_err(internal_error)? {
            return Err(invalid(
              "This operation ID belongs to a different copy. No data was changed.",
            ));
          }
          true
        } else {
          false
        }
      },
    }
  };
  let target_exists = scope.db.read_txn().is_exist(
    scope.uid,
    &scope.workspace_id.to_string(),
    &target_id.to_string(),
  );
  if operation.is_some() && (completed || target_exists) {
    if !completed {
      return Err(invalid(
        "The copy target has no completed operation binding. It was kept without replacement.",
      ));
    }
    if !target_exists || !active.contains_row(view, &target_id.to_string().into()) {
      return Err(invalid(
        "This copy completed earlier, but its row was removed. It was not recreated.",
      ));
    }
    let copied = snapshot_collab(&scope, &target_id.to_string(), CollabType::DatabaseRow).await?;
    let txn = copied.transact();
    let meta = map(&copied.data, &txn, "meta")?;
    let stored = meta
      .get(&txn, "hypertask:duplicate:v1")
      .map(|value| value.to_json(&txn))
      .ok_or_else(|| {
        invalid("The copy target has a conflicting operation binding. It was kept.")
      })?;
    if stored != Any::from_json(&marker.to_string()).map_err(internal_error)? {
      return Err(invalid(
        "The copy target belongs to another operation. It was kept.",
      ));
    }
    drop(txn);
    if !active.contains_row(view, &target_id.to_string().into()) {
      return Err(invalid(
        "This copy completed earlier, but its row was removed. It was not recreated.",
      ));
    }
    scope.check()?;
    let result = copied_row_metadata(&active, &target_id).await?;
    scope.check()?;
    return Ok(result);
  }
  if !active.contains_row(view, source_row) {
    return Err(invalid("The row is no longer in this database view."));
  }
  let cached = active.get_database_row(source_row).await;
  let cached = if let Some(cached) = &cached {
    Some(cached.read().await)
  } else {
    None
  };
  let source = if let Some(cached) = &cached {
    hyper_duplicate_collab(&cached.collab, source_row)?
  } else {
    snapshot_collab(&scope, source_row, CollabType::DatabaseRow).await?
  };
  scope.check()?;
  let source_views: Vec<_> = active
    .get_all_views()
    .into_iter()
    .filter(|view| view.row_orders.iter().any(|row| row.id == *source_row))
    .map(|view| view.id)
    .collect();
  let (mut row_object, row) = row_copy(
    &source,
    &source_id,
    &target_id,
    &database_id,
    &database_id,
    source_views,
    view,
  )?;
  let mut staged_row = hyper_duplicate_encoded(&row_object.encoded_collab, &target_id.to_string())?;
  {
    let mut txn = staged_row.context.transact_mut();
    let meta = map(&staged_row.data, &txn, "meta")?;
    meta.insert(
      &mut txn,
      "hypertask:duplicate:v1",
      Any::from_json(&marker.to_string()).map_err(internal_error)?,
    );
  }
  row_object = encoded(&staged_row, CollabType::DatabaseRow)?;
  let mut copied = hyper_duplicate_collab(&active, &database_id)?;
  {
    let mut txn = copied.context.transact_mut();
    let root = map(&copied.data, &txn, DATABASE)?;
    let operations = match root.get(&txn, "hypertask:row-copy-operations:v1") {
      Some(value) => value
        .cast::<MapRef>()
        .map_err(|_| invalid("The saved copy-operation metadata is unsupported. It was kept."))?,
      None => root.insert(
        &mut txn,
        "hypertask:row-copy-operations:v1",
        MapPrelim::default(),
      ),
    };
    operations.insert(
      &mut txn,
      operation_key,
      Any::from_json(&marker.to_string()).map_err(internal_error)?,
    );
    let views = map(&root, &txn, "views")?;
    let captured_views: Vec<_> = views.iter(&txn).map(|(_, value)| value).collect();
    for value in captured_views {
      let view: MapRef = value
        .cast()
        .map_err(|_| invalid("An unsupported view cannot be copied."))?;
      let orders: ArrayRef = view
        .get(&txn, "row_orders")
        .and_then(|value| value.cast().ok())
        .ok_or_else(|| invalid("A database view has no row order."))?;
      let mut found = None;
      for (index, value) in orders.iter(&txn).enumerate() {
        let YrsValue::Any(Any::Map(order)) = value else {
          return Err(invalid("An unsupported row order cannot be copied."));
        };
        if order.get("id") == Some(&Any::String(source_row.to_string().into())) {
          if found.is_some() {
            return Err(invalid("The source row order is repeated."));
          }
          found = Some((index, order));
        }
      }
      if let Some((index, order)) = found {
        let mut order = (*order).clone();
        order.insert("id".into(), Any::String(target_id.to_string().into()));
        orders.insert(&mut txn, index as u32 + 1, Any::Map(Arc::new(order)));
      }
    }
  }
  let copied = encoded(&copied, CollabType::Database)?;
  let saved = copied.encoded_collab.clone();
  persist(
    scope.clone(),
    hook,
    vec![row],
    vec![row_object, copied],
    HashSet::from([database_id]),
  )
  .await?;
  scope.check()?;
  apply_saved(&mut active, &saved)?;
  // Prime the native row cache from the already committed target before returning.
  if active
    .get_or_init_database_row(&target_id.to_string().into())
    .await
    .is_none()
  {
    return Err(invalid(
      "The copy was committed but its row could not be reopened. Do not duplicate again.",
    ));
  }
  scope.check()?;
  let result = copied_row_metadata(&active, &target_id).await?;
  scope.check()?;
  Ok(result)
}

fn hyper_duplicate_row_target(
  scope: &HyperDatabaseDuplicateScope,
  database: &str,
  view: &str,
  row: &RowId,
  operation: &Uuid,
) -> Uuid {
  Uuid::new_v5(
    &scope.workspace_id,
    serde_json::json!([
      "HyperTask:row-copy-operation:v1",
      scope.uid,
      database,
      view,
      row.as_str(),
      operation.to_string()
    ])
    .to_string()
    .as_bytes(),
  )
}

async fn copied_row_metadata(
  database: &Database,
  id: &Uuid,
) -> FlowyResult<crate::entities::RowMetaPB> {
  let row: RowId = id.to_string().into();
  database
    .get_or_init_database_row(&row)
    .await
    .ok_or_else(|| invalid("The committed copy could not be reopened. Do not duplicate again."))?;
  let meta = database.get_row_meta(&row).await.ok_or_else(|| {
    invalid("The committed copy metadata is unavailable. Do not duplicate again.")
  })?;
  Ok(crate::entities::RowMetaPB {
    id: id.to_string(),
    document_id: Some(Uuid::new_v5(id, RowMetaKey::DocumentId.as_str().as_bytes()).to_string()),
    icon: meta.icon_url,
    is_document_empty: Some(meta.is_document_empty),
    attachment_count: Some(meta.attachment_count),
    cover: meta.cover.map(Into::into),
  })
}

impl DatabaseManager {
  /// Validate unopened sources without entering the upstream database repair path.
  pub(crate) async fn hyper_validate_row_copy_source(
    &self,
    scope: &HyperDatabaseDuplicateScope,
    view: &str,
  ) -> FlowyResult<()> {
    scope.check()?;
    let context = scope
      .context
      .as_ref()
      .ok_or_else(|| invalid("The database copy context is not ready."))?;
    let id = context
      .read()
      .await
      .get_database_id_with_view_id(view)
      .ok_or_else(|| invalid("The source database view is missing."))?;
    scope.check()?;
    let opened = self.editors.lock().await.get(&id).cloned();
    let opened = match opened {
      Some(opened) => Some(opened),
      None => self.removing_editor.lock().await.get(&id).cloned(),
    };
    let opened = opened.filter(|editor| editor.hyper_duplicate_context_matches(scope));
    let source = if let Some(opened) = opened {
      let db = opened.database.read().await;
      scope.check()?;
      hyper_duplicate_collab(&db, &id)?
    } else {
      snapshot_collab(scope, &id, CollabType::Database).await?
    };
    let txn = source.transact();
    let root = map(&source.data, &txn, DATABASE)?;
    if string(&root, &txn, DATABASE_ID)? != id {
      return Err(invalid(
        "The source database has inconsistent IDs. It was kept without repair.",
      ));
    }
    map(&root, &txn, "fields")?;
    let metas = map(&root, &txn, DATABASE_METAS)?;
    let inline = string(&metas, &txn, DATABASE_INLINE_VIEW)?;
    let views = map(&root, &txn, "views")?;
    map(&views, &txn, &inline)?;
    map(&views, &txn, view)?;
    drop(txn);
    database_row_ids(&source)?;
    scope.check()
  }

  pub fn set_hyper_duplicate_hook(&self, hook: Arc<dyn HyperDatabaseDuplicateHook>) {
    *self.duplicate_hook.write().unwrap() = Some(hook);
  }
  pub fn invalidate_duplicate_operations(&self) {
    let _creation = self
      .creation_gate
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    for registry in self
      .row_activity_registries
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .iter()
      .filter_map(Weak::upgrade)
    {
      registry.invalidate();
    }
    let epoch = self
      .duplicate_epoch
      .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
      + 1;
    self.duplicate_changes.send_replace(epoch);
  }
  pub(crate) fn hyper_duplicate_scope(&self) -> FlowyResult<HyperDatabaseDuplicateScope> {
    let mut scope = user_scope(self.user.clone())?;
    scope.cloud = Some(self.cloud_service.clone());
    let epoch = self.duplicate_epoch.clone();
    let captured = epoch.load(std::sync::atomic::Ordering::SeqCst);
    let stamp = self
      .duplicate_context
      .read()
      .unwrap()
      .clone()
      .ok_or_else(|| invalid("The database copy context is not ready."))?;
    let context = stamp
      .context
      .upgrade()
      .ok_or_else(|| invalid("The database copy context was closed."))?;
    if stamp.epoch != captured
      || stamp.uid != scope.uid
      || stamp.workspace_id != scope.workspace_id
      || !stamp
        .db
        .upgrade()
        .is_some_and(|db| Arc::ptr_eq(&db, &scope.db))
    {
      return Err(invalid("The database owner changed. Reopen the dataset."));
    }
    scope.context = Some(context.clone());
    scope.changes = Some(self.duplicate_changes.clone());
    let stamps = self.duplicate_context.clone();
    let user_current = scope.current.clone();
    scope.current = Arc::new(move || {
      epoch.load(std::sync::atomic::Ordering::SeqCst) == captured
        && stamps.read().unwrap().as_ref().is_some_and(|stamp| {
          stamp.epoch == captured
            && stamp
              .context
              .upgrade()
              .is_some_and(|active| Arc::ptr_eq(&active, &context))
        })
        && user_current()
    });
    Ok(scope)
  }
  pub(crate) async fn hyper_duplicate_database(
    &self,
    source_view: &str,
    target_view: &str,
  ) -> FlowyResult<EncodedCollab> {
    let scope = self.hyper_duplicate_scope()?;
    scope
      .run_if_current(self.hyper_duplicate_database_inner(scope.clone(), source_view, target_view))
      .await?
  }

  async fn hyper_duplicate_database_inner(
    &self,
    scope: HyperDatabaseDuplicateScope,
    source_view: &str,
    target_view: &str,
  ) -> FlowyResult<EncodedCollab> {
    let _serial = self.duplicate_serial.lock().await;
    scope.check()?;
    let target_view = Uuid::parse_str(target_view).map_err(internal_error)?;
    let wdb_context = scope
      .context
      .as_ref()
      .ok_or_else(|| invalid("The database copy context is unavailable."))?
      .clone();
    let source_database = wdb_context
      .read()
      .await
      .get_database_id_with_view_id(source_view)
      .ok_or_else(|| invalid("The source database view is missing."))?;
    scope.check()?;
    let opened = self.editors.lock().await.get(&source_database).cloned();
    let opened = match opened {
      Some(opened) => Some(opened),
      None => self
        .removing_editor
        .lock()
        .await
        .get(&source_database)
        .cloned(),
    };
    let opened = opened
      .filter(|editor| editor.hyper_duplicate_context_matches(&scope))
      .map(|editor| editor.database.clone());
    let opened = if let Some(opened) = &opened {
      Some(opened.read().await)
    } else {
      None
    };
    let source = if let Some(opened) = &opened {
      hyper_duplicate_collab(opened, &source_database)?
    } else {
      snapshot_collab(&scope, &source_database, CollabType::Database).await?
    };
    let wdb = wdb_context;
    let mut wdb = wdb.write().await;
    scope.check()?;
    if wdb
      .get_database_id_with_view_id(&target_view.to_string())
      .is_some()
    {
      return Err(invalid(
        "A copied view already exists. It was kept without replacement.",
      ));
    }
    scope.check()?;
    {
      let txn = source.transact();
      let root = map(&source.data, &txn, DATABASE)?;
      if string(&root, &txn, DATABASE_ID)? != source_database {
        return Err(invalid(
          "The source database has inconsistent IDs. It was kept without repair.",
        ));
      }
    }
    let row_ids = database_row_ids(&source)?;
    let target_database = Uuid::new_v5(&target_view, b"HyperTask:database-copy:v1").to_string();
    let row_mapping: HashMap<_, _> = row_ids
      .iter()
      .map(|id| {
        (
          id.clone(),
          Uuid::new_v5(
            &target_view,
            format!("HyperTask:database-row-copy:v1:{id}").as_bytes(),
          )
          .to_string(),
        )
      })
      .collect();
    let (copied, view_mapping) = remap_database(
      &source,
      &target_database,
      source_view,
      &target_view,
      &row_mapping,
    )?;
    let saved_database = encoded(&copied, CollabType::Database)?;
    let mut objects = vec![saved_database];
    let mut rows = Vec::new();
    let source_views: Vec<_> = view_mapping.keys().cloned().collect();
    for id in row_ids {
      scope.check()?;
      let cached = if let Some(opened) = &opened {
        opened.get_database_row(&id.clone().into()).await
      } else {
        None
      };
      let cached = if let Some(cached) = &cached {
        Some(cached.read().await)
      } else {
        None
      };
      let row = if let Some(cached) = &cached {
        hyper_duplicate_collab(&cached.collab, &id)?
      } else {
        snapshot_collab(&scope, &id, CollabType::DatabaseRow).await?
      };
      scope.check()?;
      let (object, row) = row_copy(
        &row,
        &Uuid::parse_str(&id).map_err(internal_error)?,
        &Uuid::parse_str(&row_mapping[&id]).map_err(internal_error)?,
        &source_database,
        &target_database,
        source_views.clone(),
        &target_view.to_string(),
      )?;
      objects.push(object);
      rows.push(row);
    }
    let source_wdb: &Collab = (&*wdb).borrow();
    let mut staged_wdb =
      WorkspaceDatabase::open(hyper_duplicate_collab(source_wdb, source_wdb.object_id())?)
        .map_err(internal_error)?;
    drop(staged_wdb.add_database(&target_database, view_mapping.values().cloned().collect()));
    let workspace_object = encoded(&staged_wdb.collab, CollabType::WorkspaceDatabase)?;
    let saved_workspace = workspace_object.encoded_collab.clone();
    let replace = HashSet::from([workspace_object.object_id.clone()]);
    objects.push(workspace_object);
    let bodies = rows
      .iter()
      .map(|row| HyperCopiedBody {
        document_id: row.target_document_id,
        required: row.has_document,
      })
      .collect();
    let hook = self.duplicate_hook.read().unwrap().clone();
    persist(scope.clone(), hook.clone(), rows, objects, replace).await?;
    scope.check()?;
    apply_saved((&mut *wdb).borrow_mut(), &saved_workspace)?;
    let target = wdb.get_or_init_database(&target_database).await?;
    scope.check()?;
    drop(wdb);
    let builder = self.collab_builder()?;
    crate::hyper_creation::finalize_committed_database(
      &scope,
      &self.creation_gate,
      &builder,
      &target,
      &target_database,
      &row_mapping.values().cloned().collect(),
    )
    .await?;
    if let Some(hook) = hook {
      hook.initialize_committed(scope.clone(), bodies).await?;
    }
    scope.check()?;
    // Return the actual current root, including any valid updates during initialization.
    let current = target
      .read()
      .await
      .encode_collab_v1(|c| CollabType::Database.validate_require_data(c))
      .map_err(internal_error)?;
    scope.check()?;
    Ok(current)
  }
}

#[cfg(test)]
mod tests;
