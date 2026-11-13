//! Dataset sidecars join the same native transaction as their copied rows.
use std::collections::HashSet;
use std::sync::Weak;

use collab::preclude::*;
use collab_document::document::Document;
use collab_entity::CollabType;
use collab_entity::define::DOCUMENT_ROOT;
use flowy_database2::hyper_duplicate::EncodedCollabInfo;
use flowy_database2::hyper_duplicate::{
  HyperCopiedBody, HyperDatabaseDuplicateHook, HyperDatabaseDuplicateScope, HyperDuplicateRow,
  hyper_duplicate_collab, hyper_duplicate_encoded,
};
use flowy_document::entities::DocumentDataPB;
use flowy_document::manager::DocumentManager;
use flowy_error::{FlowyError, FlowyResult, internal_error};
use flowy_user::user_manager::UserManager;
use flowy_user::user_manager::hyper_duplicate_reminders::HyperDuplicateReminderBinding;
use lib_infra::async_trait::async_trait;
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use std::convert::TryInto;
use uuid::Uuid;

pub(super) struct HyperNativeDatabaseDuplicate {
  pub document: Weak<DocumentManager>,
  pub user: Weak<UserManager>,
  pub folder: Weak<flowy_folder::manager::FolderManager>,
  pub database: Weak<flowy_database2::DatabaseManager>,
}

fn invalid(message: &str) -> FlowyError {
  FlowyError::invalid_data().with_context(message)
}
fn map<T: ReadTxn>(root: &MapRef, txn: &T, key: &str) -> FlowyResult<MapRef> {
  root
    .get(txn, key)
    .and_then(|value| value.cast().ok())
    .ok_or_else(|| invalid("An unsupported row document cannot be copied. The source was kept."))
}

struct BodyTimer {
  source_id: String,
  target_id: String,
  block_id: String,
  offset: u32,
  text_id: Option<String>,
}

fn timers(
  value: &Value,
  target: &Uuid,
  block: &str,
  text_id: Option<&str>,
) -> FlowyResult<Vec<BodyTimer>> {
  let mut result = Vec::new();
  let mut offset = 0u32;
  for run in value
    .as_array()
    .ok_or_else(|| invalid("The row document has unsupported text."))?
  {
    let inserted = run
      .get("insert")
      .and_then(Value::as_str)
      .ok_or_else(|| invalid("Embedded document text cannot be copied safely."))?;
    if let Some(mention) = run.get("attributes").and_then(|value| value.get("mention")) {
      if matches!(
        mention.get("type").and_then(Value::as_str),
        Some("date" | "reminder")
      ) && mention.get("date").is_some_and(Value::is_string)
        && !inserted.is_empty()
        && inserted.chars().all(|c| c == '$')
      {
        if let Some(id) = mention
          .get("reminder_id")
          .and_then(Value::as_str)
          .filter(|id| !id.is_empty())
        {
          for _ in inserted.chars() {
            let next = super::hyper_document_duplicate::hyper_duplicate_reminder_id(
              target,
              block,
              offset as usize,
              id,
            )?;
            result.push(BodyTimer {
              source_id: id.into(),
              target_id: next,
              block_id: block.into(),
              offset,
              text_id: text_id.map(str::to_string),
            });
            offset += 1;
          }
          continue;
        }
      }
    }
    offset = offset
      .checked_add(
        inserted
          .encode_utf16()
          .count()
          .try_into()
          .map_err(internal_error)?,
      )
      .ok_or_else(|| invalid("The copied text is too large."))?;
  }
  Ok(result)
}

/// Validate using the shared reminder remapper, then format only the changed atoms
/// in a detached CRDT. Unknown roots, block fields, text attributes and asset paths stay intact.
fn remap_body(source: &Collab, target: &Uuid) -> FlowyResult<(Collab, Vec<BodyTimer>)> {
  flowy_document::hyper_duplicate::hyper_validate_duplicate_document(source)?;
  let document =
    Document::open(hyper_duplicate_collab(source, &target.to_string())?).map_err(internal_error)?;
  let original: DocumentDataPB = document.get_document_data().map_err(internal_error)?.into();
  let remapped = super::hyper_document_duplicate::hyper_remap_document_reminders(
    document.get_document_data().map_err(internal_error)?.into(),
    target,
  )?;
  let mut result = hyper_duplicate_collab(source, &target.to_string())?;
  let mut references = Vec::new();
  let mut owners = std::collections::HashMap::new();
  for (id, block) in &original.blocks {
    let value: Value = serde_json::from_str(if block.data.is_empty() {
      "{}"
    } else {
      &block.data
    })
    .map_err(internal_error)?;
    if let Some(delta) = value.get("delta") {
      references.extend(timers(delta, target, id, None)?);
    }
    if let Some(text) = &block.external_id {
      owners.insert(text.clone(), id.clone());
    }
  }
  for (text_id, value) in &original.meta.text_map {
    let fallback = format!("text:{text_id}");
    references.extend(timers(
      &serde_json::from_str(value).map_err(internal_error)?,
      target,
      owners.get(text_id).unwrap_or(&fallback),
      Some(text_id),
    )?);
  }
  let mut txn = result.context.transact_mut();
  let root = map(&result.data, &txn, DOCUMENT_ROOT)?;
  let blocks = map(&root, &txn, "blocks")?;
  if blocks.len(&txn) as usize != original.blocks.len() {
    return Err(invalid(
      "The row document contains unsupported blocks. The source was kept.",
    ));
  }
  for (id, next) in &remapped.blocks {
    let block = map(&blocks, &txn, id)?;
    let previous: Value = serde_json::from_str(if original.blocks[id].data.is_empty() {
      "{}"
    } else {
      &original.blocks[id].data
    })
    .map_err(internal_error)?;
    let changed: Value = serde_json::from_str(&next.data).map_err(internal_error)?;
    if previous != changed {
      block.insert(&mut txn, "data", next.data.clone());
    }
  }
  let meta = map(&root, &txn, "meta")?;
  let text_map = map(&meta, &txn, "text_map")?;
  for reference in &references {
    if let Some(text_id) = &reference.text_id {
      let text: TextRef = text_map
        .get(&txn, text_id)
        .and_then(|value| value.cast().ok())
        .ok_or_else(|| invalid("The copied document has unsupported external text."))?;
      let mut at = 0u32;
      let mut mention = None;
      for delta in text.diff(&txn, |_| ()) {
        let YrsValue::Any(Any::String(inserted)) = delta.insert else {
          return Err(invalid("Embedded document text cannot be copied safely."));
        };
        let end = at
          .checked_add(
            inserted
              .encode_utf16()
              .count()
              .try_into()
              .map_err(internal_error)?,
          )
          .ok_or_else(|| invalid("The copied text is too large."))?;
        if reference.offset >= at && reference.offset < end {
          let Some(Any::Map(original)) = delta
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.get("mention"))
          else {
            return Err(invalid("The copied date attributes changed."));
          };
          if original.get("reminder_id") != Some(&Any::String(reference.source_id.clone().into())) {
            return Err(invalid("The copied date binding changed."));
          }
          let mut value = (**original).clone();
          value.insert(
            "reminder_id".into(),
            Any::String(reference.target_id.clone().into()),
          );
          mention = Some(Any::Map(std::sync::Arc::new(value)));
          break;
        }
        at = end;
      }
      let mention =
        mention.ok_or_else(|| invalid("The copied date attributes are unavailable."))?;
      text.format(
        &mut txn,
        reference.offset,
        1,
        Attrs::from([("mention".into(), mention)]),
      );
    }
  }
  drop(txn);
  Ok((result, references))
}

#[async_trait]
impl HyperDatabaseDuplicateHook for HyperNativeDatabaseDuplicate {
  async fn check_row_access(
    &self,
    scope: &HyperDatabaseDuplicateScope,
    view_id: &str,
  ) -> FlowyResult<()> {
    scope.check()?;
    let folder = self.folder.upgrade().ok_or_else(FlowyError::ref_drop)?;
    let user = self.user.upgrade().ok_or_else(FlowyError::ref_drop)?;
    let view = folder.get_view(view_id).await?;
    scope.check()?;
    if !matches!(
      view.layout,
      collab_folder::ViewLayout::Grid
        | collab_folder::ViewLayout::Board
        | collab_folder::ViewLayout::Calendar
    ) {
      return Err(invalid("The row's database view is unavailable."));
    }
    if view.is_locked.unwrap_or(false) {
      return Err(FlowyError::view_is_locked());
    }
    let profile = user
      .get_user_profile_from_disk(scope.uid, &scope.workspace_id.to_string())
      .await?;
    scope.check()?;
    if profile.workspace_type.is_local()
      || profile.auth_type.is_local()
      || view.created_by == Some(scope.uid)
    {
      return Ok(());
    }
    let workspace = user.get_user_workspace_from_db(scope.uid, &scope.workspace_id)?;
    scope.check()?;
    let section = folder.get_shared_view_section(view_id).await?;
    scope.check()?;
    if matches!(
      section,
      flowy_folder::entities::SharedViewSectionPB::PublicSection
    ) && matches!(
      workspace.role.map(flowy_user_pub::entities::Role::from),
      Some(flowy_user_pub::entities::Role::Owner | flowy_user_pub::entities::Role::Member)
    ) {
      return Ok(());
    }
    let shared = folder
      .get_shared_page_details(&Uuid::parse_str(view_id).map_err(internal_error)?)
      .await?;
    scope.check()?;
    if shared
      .shared_with
      .iter()
      .any(|member| member.email == profile.email && member.access_level.can_write())
    {
      return Ok(());
    }
    Err(invalid("This database is read-only. Its rows were kept."))
  }
  async fn initialize_committed(
    &self,
    scope: HyperDatabaseDuplicateScope,
    documents: Vec<HyperCopiedBody>,
  ) -> FlowyResult<()> {
    use collab_integrate::CollabKVAction;
    use collab_plugins::local_storage::kv::KVTransactionDB;
    scope.check()?;
    let manager = self.document.upgrade().ok_or_else(FlowyError::ref_drop)?;
    let database = self.database.upgrade().ok_or_else(FlowyError::ref_drop)?;
    let gate = database.hyper_publication_gate();
    for document in documents {
      scope.check()?;
      let exists = scope.db.read_txn().is_exist(
        scope.uid,
        &scope.workspace_id.to_string(),
        &document.document_id.to_string(),
      );
      if !exists {
        if document.required {
          return Err(invalid(
            "The copy was saved but its body is no longer available. It was not recreated.",
          ));
        }
        continue;
      }
      manager
        .hyper_initialize_committed_document(
          flowy_document::hyper_committed_document::HyperCommittedDocumentScope {
            uid: scope.uid,
            workspace_id: scope.workspace_id,
            db: std::sync::Arc::downgrade(&scope.db),
            is_current: scope.current.clone(),
            publication_gate: gate.clone(),
          },
          document.document_id,
        )
        .await?;
      scope.check()?;
    }
    Ok(())
  }

  async fn persist(
    &self,
    scope: HyperDatabaseDuplicateScope,
    rows: Vec<HyperDuplicateRow>,
    mut objects: Vec<EncodedCollabInfo>,
    replace: HashSet<String>,
  ) -> FlowyResult<()> {
    scope.check()?;
    let document = self.document.upgrade().ok_or_else(FlowyError::ref_drop)?;
    let user = self.user.upgrade().ok_or_else(FlowyError::ref_drop)?;
    let mut bindings = Vec::new();
    let mut write_views = HashSet::new();
    for row in rows {
      scope.check()?;
      if row.source_view_ids.contains(&row.target_view_id) {
        write_views.insert(row.target_view_id.clone());
      }
      let source = document
        .snapshot_for_duplicate(
          scope.uid,
          scope.workspace_id,
          &scope.db,
          &row.source_document_id,
          row.has_document,
        )
        .await?;
      scope.check()?;
      if let Some(source) = source {
        let source = hyper_duplicate_encoded(&source, &row.source_document_id.to_string())?;
        let (copied, timers) = remap_body(&source, &row.target_document_id)?;
        let encoded_collab = copied
          .encode_collab_v1(|value| CollabType::Document.validate_require_data(value))
          .map_err(internal_error)?;
        objects.push(EncodedCollabInfo {
          object_id: row.target_document_id.to_string(),
          collab_type: CollabType::Document,
          encoded_collab,
        });
        for timer in timers {
          let mut allowed = row.source_view_ids.clone();
          allowed.push(row.source_document_id.to_string());
          bindings.push(HyperDuplicateReminderBinding {
            source_id: timer.source_id,
            target_id: timer.target_id,
            source_object_ids: allowed,
            source_row_id: row.source_row_id.clone(),
            source_block_id: Some(timer.block_id),
            source_document_id: Some(row.source_document_id.to_string()),
            target_object_id: row.target_view_id.clone(),
            target_row_id: row.target_row_id.clone(),
          });
        }
      }
      for timer in row.date_cells {
        bindings.push(HyperDuplicateReminderBinding {
          source_id: timer.source_id,
          target_id: timer.target_id,
          source_object_ids: row.source_view_ids.clone(),
          source_row_id: row.source_row_id.clone(),
          source_block_id: None,
          source_document_id: None,
          target_object_id: row.target_view_id.clone(),
          target_row_id: row.target_row_id.clone(),
        });
      }
    }
    scope.check()?;
    for view in write_views {
      self.check_row_access(&scope, &view).await?;
    }
    user
      .commit_hyper_duplicate(
        scope.uid,
        scope.workspace_id,
        scope.db.clone(),
        bindings,
        objects,
        replace,
        scope.current.clone(),
      )
      .await
  }
}

#[cfg(test)]
mod tests;
