//! Copy timers against a captured owner. No source repair or dynamic-owner writes.
use std::borrow::BorrowMut;
use std::collections::HashSet;
use std::sync::Arc;

use collab::core::collab::TransactionMutExt;
use collab::core::{collab::DataSource, origin::CollabOrigin};
use collab::preclude::updates::decoder::Decode;
use collab::preclude::*;
use collab_database::entity::EncodedCollabInfo;
use collab_entity::CollabType;
use collab_entity::define::USER_AWARENESS;
use collab_integrate::{CollabKVAction, CollabKVDB};
use collab_plugins::local_storage::kv::KVTransactionDB;
use collab_user::core::UserAwareness;
use flowy_error::{FlowyError, FlowyResult, internal_error};
use uuid::Uuid;

use super::UserManager;

pub struct HyperDuplicateReminderBinding {
  pub source_id: String,
  pub target_id: String,
  pub source_object_ids: Vec<String>,
  pub source_row_id: String,
  pub source_block_id: Option<String>,
  pub source_document_id: Option<String>,
  pub target_object_id: String,
  pub target_row_id: String,
}

fn invalid(message: &str) -> FlowyError {
  FlowyError::invalid_data().with_context(message)
}

fn map<T: ReadTxn>(root: &MapRef, txn: &T, key: &str) -> FlowyResult<MapRef> {
  root
    .get(txn, key)
    .and_then(|value| value.cast().ok())
    .ok_or_else(|| invalid("A reminder has unsupported metadata. The source was kept."))
}

fn meta_string<T: ReadTxn>(source: &MapRef, txn: &T, key: &str) -> FlowyResult<Option<String>> {
  let value = match source.get(txn, "meta") {
    Some(YrsValue::Any(Any::Map(meta))) => meta.get(key).cloned().map(YrsValue::Any),
    Some(YrsValue::YMap(meta)) => meta.get(txn, key),
    _ => {
      return Err(invalid(
        "A reminder has unsupported metadata. The source was kept.",
      ));
    },
  };
  value
    .map(|value| {
      value
        .cast::<String>()
        .map_err(|_| invalid("A reminder has an unsupported row or block binding."))
    })
    .transpose()
}

fn clone_awareness(
  source: &UserAwareness,
  bindings: &[HyperDuplicateReminderBinding],
) -> FlowyResult<Collab> {
  let encoded = source
    .encode_collab_v1(|value| CollabType::UserAwareness.validate_require_data(value))
    .map_err(internal_error)?;
  let mut copied = Collab::new_with_source(
    CollabOrigin::Empty,
    source.object_id(),
    DataSource::DocStateV1(encoded.doc_state.to_vec()),
    vec![],
    false,
  )
  .map_err(internal_error)?;
  let mut txn = copied.context.transact_mut();
  let root = map(&copied.data, &txn, USER_AWARENESS)?;
  let reminders: ArrayRef = root
    .get(&txn, "reminders")
    .and_then(|value| value.cast().ok())
    .ok_or_else(|| invalid("The reminder collection is unavailable."))?;
  let mut targets = HashSet::new();
  for binding in bindings {
    if binding.source_id == binding.target_id || !targets.insert(binding.target_id.clone()) {
      return Err(invalid("Copied timer IDs are inconsistent."));
    }
    let mut sources = Vec::new();
    for value in reminders.iter(&txn) {
      let value: MapRef = value
        .cast()
        .map_err(|_| invalid("An unsupported timer cannot be copied safely."))?;
      let id: String = value
        .get(&txn, "id")
        .and_then(|value| value.cast().ok())
        .ok_or_else(|| invalid("A timer has no ID."))?;
      if id == binding.target_id {
        return Err(invalid(
          "A copied timer already exists. Its data was kept; do not duplicate again.",
        ));
      }
      if id == binding.source_id {
        sources.push(value);
      }
    }
    if sources.len() != 1 {
      return Err(invalid(
        "A source timer is missing or duplicated. Finish its reminder updates before copying.",
      ));
    }
    let source = &sources[0];
    let object: String = source
      .get(&txn, "object_id")
      .and_then(|value| value.cast().ok())
      .ok_or_else(|| invalid("A timer has no page binding."))?;
    if !binding.source_object_ids.contains(&object) {
      return Err(invalid(
        "A timer belongs to another page. The source was kept.",
      ));
    }
    let source_row = meta_string(source, &txn, "row_id")?;
    if let Some(row) = &source_row {
      if row != &binding.source_row_id {
        return Err(invalid(
          "A timer belongs to another row. The source was kept.",
        ));
      }
    }
    if source_row.is_none() && binding.source_document_id.as_deref() != Some(object.as_str()) {
      return Err(invalid(
        "A row timer has no unambiguous row binding. The source was kept.",
      ));
    }
    if let Some(block) = meta_string(source, &txn, "block_id")? {
      if Some(block.as_str()) != binding.source_block_id.as_deref() {
        return Err(invalid(
          "A timer belongs to another block. The source was kept.",
        ));
      }
    }
    let cloned = source.as_prelim(&txn);
    let target: MapRef = reminders.push_back(&mut txn, cloned);
    target.insert(&mut txn, "id", binding.target_id.clone());
    target.insert(&mut txn, "object_id", binding.target_object_id.clone());
    match target.get(&txn, "meta") {
      Some(YrsValue::YMap(meta)) => {
        meta.insert(&mut txn, "row_id", binding.target_row_id.clone());
      },
      Some(YrsValue::Any(Any::Map(meta))) => {
        let mut next = (*meta).clone();
        next.insert(
          "row_id".into(),
          Any::String(binding.target_row_id.clone().into()),
        );
        target.insert(&mut txn, "meta", Any::Map(Arc::new(next)));
      },
      _ => return Err(invalid("The copied reminder has unsupported metadata.")),
    }
  }
  drop(txn);
  Ok(copied)
}

/// Every target is checked inside the same native transaction as publication.
pub fn hyper_persist_duplicate_collabs(
  db: &CollabKVDB,
  uid: i64,
  workspace: &Uuid,
  objects: &[EncodedCollabInfo],
  replace: &HashSet<String>,
  current: &dyn Fn() -> bool,
) -> FlowyResult<()> {
  if !current() {
    return Err(invalid("The account or workspace changed while copying."));
  }
  let txn = db.write_txn();
  let workspace = workspace.to_string();
  let mut seen = HashSet::new();
  for object in objects {
    if !seen.insert(object.object_id.as_str()) {
      return Err(invalid("The copy contains repeated target objects."));
    }
    if !replace.contains(&object.object_id) && txn.is_exist(uid, &workspace, &object.object_id) {
      return Err(invalid(
        "A copied object already exists. It was kept without replacement.",
      ));
    }
    txn
      .flush_doc(
        uid,
        &workspace,
        &object.object_id,
        object.encoded_collab.state_vector.to_vec(),
        object.encoded_collab.doc_state.to_vec(),
      )
      .map_err(internal_error)?;
  }
  if !current() {
    return Err(invalid(
      "The account or workspace changed before the copy was committed.",
    ));
  }
  txn.commit_transaction().map_err(internal_error)
}

async fn persist_off_thread(
  db: Arc<CollabKVDB>,
  uid: i64,
  workspace: Uuid,
  objects: Vec<EncodedCollabInfo>,
  replace: HashSet<String>,
  current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> FlowyResult<()> {
  tokio::task::spawn_blocking(move || {
    hyper_persist_duplicate_collabs(&db, uid, &workspace, &objects, &replace, current.as_ref())
  })
  .await
  .map_err(internal_error)?
}

impl UserManager {
  pub async fn commit_hyper_duplicate(
    &self,
    uid: i64,
    workspace: Uuid,
    db: Arc<CollabKVDB>,
    bindings: Vec<HyperDuplicateReminderBinding>,
    mut objects: Vec<EncodedCollabInfo>,
    mut replace: HashSet<String>,
    current: Arc<dyn Fn() -> bool + Send + Sync>,
  ) -> FlowyResult<()> {
    let check = || -> FlowyResult<()> {
      if !current()
        || self.user_id()? != uid
        || self.workspace_id()? != workspace
        || !self
          .get_collab_db(uid)?
          .upgrade()
          .is_some_and(|active| Arc::ptr_eq(&active, &db))
      {
        return Err(invalid("The account or workspace changed while copying."));
      }
      Ok(())
    };
    check()?;
    let expected_awareness = flowy_user_pub::entities::user_awareness_object_id(
      &self.user_uuid()?,
      &workspace.to_string(),
    )
    .to_string();
    if bindings.is_empty() {
      persist_off_thread(
        db.clone(),
        uid,
        workspace,
        objects,
        replace,
        current.clone(),
      )
      .await?;
      return check().map_err(|_| invalid("The copy was committed for its original owner. Reopen that workspace and inspect the copy before trying again."));
    }
    let awareness = self
      .user_awareness_by_workspace
      .get(&workspace)
      .map(|value| value.value().clone())
      .ok_or_else(|| invalid("Reminders are not available yet. Wait before copying."))?;
    let mut active = awareness.write().await;
    check()?;
    if active.object_id() != expected_awareness || active.origin().client_user_id() != Some(uid) {
      return Err(invalid(
        "The reminder collection belongs to another account. Wait for this account's reminders before copying.",
      ));
    }
    if !self
      .user_awareness_by_workspace
      .get(&workspace)
      .is_some_and(|value| Arc::ptr_eq(value.value(), &awareness))
    {
      return Err(invalid("The reminder collection changed while copying."));
    }
    let copied = clone_awareness(&active, &bindings)?;
    let encoded = copied
      .encode_collab_v1(|value| CollabType::UserAwareness.validate_require_data(value))
      .map_err(internal_error)?;
    replace.insert(copied.object_id().to_string());
    objects.push(EncodedCollabInfo {
      object_id: copied.object_id().to_string(),
      collab_type: CollabType::UserAwareness,
      encoded_collab: encoded.clone(),
    });
    persist_off_thread(
      db.clone(),
      uid,
      workspace,
      objects,
      replace,
      current.clone(),
    )
    .await?;
    // The storage commit is complete. Apply only to this captured awareness instance.
    // If ownership changed, the old owner's committed data will be loaded next time.
    check().map_err(|_| invalid("The copy was committed for its original owner. Reopen that workspace and inspect the copy before trying again."))?;
    let collab: &mut Collab = active.borrow_mut();
    collab
      .transact_mut()
      .try_apply_update(Update::decode_v1(&encoded.doc_state).map_err(internal_error)?)
      .map_err(internal_error)?;
    Ok(())
  }
}

#[cfg(test)]
mod tests;
