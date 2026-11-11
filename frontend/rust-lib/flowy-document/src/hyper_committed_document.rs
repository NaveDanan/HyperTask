//! Publish a committed copied body without recreating, repairing or re-copying it.
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, Weak};

use collab::core::collab::DataSource;
use collab::core::collab_plugin::CollabPersistence;
use collab::entity::EncodedCollab;
use collab::error::CollabError;
use collab::lock::RwLock;
use collab::preclude::updates::decoder::Decode;
use collab::preclude::*;
use collab_document::document::Document;
use collab_entity::CollabType;
use collab_integrate::collab_builder::CollabBuilderConfig;
use collab_plugins::CollabKVDB;
use collab_plugins::local_storage::kv::keys::{
  Clock, make_doc_end_key, make_doc_id_key_v0, make_doc_id_key_v1, make_doc_start_key,
  make_doc_state_key, make_doc_update_key,
};
use collab_plugins::local_storage::kv::{KVEntry, KVStore, KVTransactionDB};
use flowy_error::{FlowyError, FlowyResult, internal_error};
use uuid::Uuid;

use crate::document::{
  subscribe_document_changed, subscribe_document_snapshot_state, subscribe_document_sync_state,
};
use crate::manager::DocumentManager;

/// The caller's duplicate lifecycle and physical storage. No callback is cached.
pub struct HyperCommittedDocumentScope {
  pub uid: i64,
  pub workspace_id: Uuid,
  pub db: Weak<CollabKVDB>,
  pub is_current: Arc<dyn Fn() -> bool + Send + Sync>,
  pub publication_gate: Arc<Mutex<()>>,
}

fn retained(reason: &str) -> FlowyError {
  FlowyError::invalid_data().with_context(format!(
    "The copy was committed, but its document publication could not be confirmed. {reason} The existing copy was kept; retry the same copy operation."
  ))
}

#[derive(Clone)]
pub(crate) struct HyperDocumentContext {
  pub(crate) uid: i64,
  pub(crate) workspace_id: Uuid,
  pub(crate) db: Weak<CollabKVDB>,
  epoch: u64,
}

#[derive(Clone)]
pub(crate) struct HyperDocumentCacheEntry {
  pub(crate) context: HyperDocumentContext,
  pub(crate) document: Arc<RwLock<Document>>,
}

impl HyperDocumentContext {
  pub(crate) fn capture(manager: &DocumentManager) -> FlowyResult<Self> {
    let epoch = manager.document_epoch.load(Ordering::SeqCst);
    let uid = manager.user_service.user_id()?;
    let context = Self {
      uid,
      workspace_id: manager.user_service.workspace_id()?,
      db: manager.user_service.collab_db(uid)?,
      epoch,
    };
    context.check(manager)?;
    Ok(context)
  }

  pub(crate) fn matches(&self, other: &Self) -> bool {
    self.uid == other.uid
      && self.workspace_id == other.workspace_id
      && self.epoch == other.epoch
      && Weak::ptr_eq(&self.db, &other.db)
  }

  pub(crate) fn check(&self, manager: &DocumentManager) -> FlowyResult<()> {
    if self.epoch != manager.document_epoch.load(Ordering::SeqCst)
      || self.uid != manager.user_service.user_id()?
      || self.workspace_id != manager.user_service.workspace_id()?
      || !Weak::ptr_eq(&self.db, &manager.user_service.collab_db(self.uid)?)
      || self.db.upgrade().is_none()
    {
      return Err(FlowyError::invalid_data().with_context(
        "The document account, workspace or storage context changed. Reopen the document.",
      ));
    }
    Ok(())
  }

  fn check_scope(
    &self,
    manager: &DocumentManager,
    scope: &HyperCommittedDocumentScope,
  ) -> FlowyResult<()> {
    self
      .check(manager)
      .map_err(|_| retained("The document account, workspace or storage context changed."))?;
    if self.uid != scope.uid
      || self.workspace_id != scope.workspace_id
      || !Weak::ptr_eq(&self.db, &scope.db)
      || !(scope.is_current)()
    {
      return Err(retained("The original copy owner is no longer active."));
    }
    Ok(())
  }
}

impl DocumentManager {
  pub(crate) fn hyper_cached_document(
    &self,
    doc_id: &Uuid,
  ) -> FlowyResult<Option<Arc<RwLock<Document>>>> {
    let _publication = self.document_publication_gate.lock().map_err(|_| {
      FlowyError::internal().with_context("The document publication lock is unavailable.")
    })?;
    let context = HyperDocumentContext::capture(self)?;
    Ok(
      self
        .hyper_cached_document_in_context(doc_id, &context)?
        .map(|entry| entry.document),
    )
  }

  /// The caller holds document_publication_gate. Mismatched arcs are never reused.
  pub(crate) fn hyper_cached_document_in_context(
    &self,
    doc_id: &Uuid,
    context: &HyperDocumentContext,
  ) -> FlowyResult<Option<HyperDocumentCacheEntry>> {
    context.check(self)?;
    for map in [&self.documents, &self.removing_documents] {
      map.remove_if(doc_id, |_, entry| !entry.context.matches(context));
    }
    if let Some(entry) = self.documents.get(doc_id) {
      return Ok(Some(entry.value().clone()));
    }
    if let Some((id, entry)) = self.removing_documents.remove(doc_id) {
      self.documents.insert(id, entry.clone());
      return Ok(Some(entry));
    }
    Ok(None)
  }

  /// Initialize CURRENT local copied bytes before the duplicate acknowledgement.
  /// It never reads the source/HTTP or creates an absent target, and never rolls
  /// back a copy whose commit already succeeded.
  pub async fn hyper_initialize_committed_document(
    &self,
    scope: HyperCommittedDocumentScope,
    doc_id: Uuid,
  ) -> FlowyResult<()> {
    let context = HyperDocumentContext::capture(self)
      .map_err(|_| retained("The original document owner is no longer active."))?;
    context.check_scope(self, &scope)?;
    // A current live instance contains later edits, so it takes precedence over
    // both the initial copy snapshot and another detached preparation.
    {
      let _caller = scope
        .publication_gate
        .lock()
        .map_err(|_| retained("The copy publication lock is unavailable."))?;
      let _publication = self
        .document_publication_gate
        .lock()
        .map_err(|_| retained("The document publication lock is unavailable."))?;
      context.check_scope(self, &scope)?;
      if let Some(current) = self.hyper_cached_document_in_context(&doc_id, &context)? {
        required_local(&scope.db, scope.uid, scope.workspace_id, doc_id)?;
        let document = current
          .document
          .try_read()
          .map_err(|_| retained("The copied document is busy."))?;
        validate_document(&document, doc_id)?;
        context.check_scope(self, &scope)?;
        return Ok(());
      }
    }

    let builder = self
      .collab_builder
      .upgrade()
      .ok_or_else(|| retained("The document builder was closed."))?;
    let object = builder
      .collab_object(
        &scope.workspace_id,
        scope.uid,
        &doc_id,
        CollabType::Document,
      )
      .map_err(|_| retained("The document owner changed before preparation."))?;
    let loaded = Arc::new(Mutex::new(None));
    let persistence = HyperCommittedPersistence {
      db: scope.db.clone(),
      uid: scope.uid,
      workspace_id: scope.workspace_id,
      doc_id,
      loaded: loaded.clone(),
    };
    let collab = builder
      .build_collab(
        &object,
        &scope.db,
        DataSource::Disk(Some(Box::new(persistence))),
      )
      .await
      .map_err(|_| retained("The committed local body could not be loaded exactly."))?;
    context.check_scope(self, &scope)?;
    validate_collab(&collab, doc_id)?;
    let before_open = collab
      .transact()
      .encode_state_as_update_v1(&StateVector::default());
    let document = Document::open(collab)
      .map_err(|_| retained("The committed document schema is unsupported."))?;
    if document
      .transact()
      .encode_state_as_update_v1(&StateVector::default())
      != before_open
    {
      return Err(retained(
        "Opening this document would change its committed data.",
      ));
    }
    if document.can_undo() || document.can_redo() {
      return Err(retained(
        "The prepared document has unexpected initial history.",
      ));
    }
    let document = Arc::new(RwLock::new(document));
    let expected = loaded
      .lock()
      .map_err(|_| retained("The local preparation lock is unavailable."))?
      .take()
      .ok_or_else(|| retained("The committed local body was not loaded."))?;

    // No await is allowed between this final owner/data check, plugin did_init,
    // observer setup and cache publication. Both lifecycle gates stay held.
    let _caller = scope
      .publication_gate
      .lock()
      .map_err(|_| retained("The copy publication lock is unavailable."))?;
    let _publication = self
      .document_publication_gate
      .lock()
      .map_err(|_| retained("The document publication lock is unavailable."))?;
    context.check_scope(self, &scope)?;
    if let Some(current) = self.hyper_cached_document_in_context(&doc_id, &context)? {
      required_local(&scope.db, scope.uid, scope.workspace_id, doc_id)?;
      let live = current
        .document
        .try_read()
        .map_err(|_| retained("The copied document is busy."))?;
      validate_document(&live, doc_id)?;
      context.check_scope(self, &scope)?;
      return Ok(());
    }
    if required_local(&scope.db, scope.uid, scope.workspace_id, doc_id)? != expected {
      return Err(retained(
        "The copied body changed during preparation. Retry to publish its current data.",
      ));
    }
    context.check_scope(self, &scope)?;
    hyper_subscribe_prepared_document(&doc_id, &document)
      .map_err(|_| retained("The copied document is busy."))?;
    let document = builder
      .finalize(
        object,
        CollabBuilderConfig::default().sync_enable(true),
        document,
      )
      .map_err(|error| {
        tracing::warn!(phase = "hyper_copied_document_builder_finalize", document_id = %doc_id, error = %error, "Copied document initialization failed");
        retained("The copied document could not be initialized.")
      })?;
    context.check_scope(self, &scope)?;
    self
      .documents
      .insert(doc_id, HyperDocumentCacheEntry { context, document });
    Ok(())
  }
}

/// Only call while the prepared Arc is private, before finalize exposes a Weak
/// handle to cloud/indexing readers. Never try to take a new writer after init.
pub(crate) fn hyper_subscribe_prepared_document(
  id: &Uuid,
  document: &Arc<RwLock<Document>>,
) -> FlowyResult<()> {
  let mut write = document.try_write().map_err(|error| {
    tracing::warn!(phase = "hyper_document_prepared_observers", document_id = %id, error = %error, "Prepared document observer setup was busy");
    FlowyError::internal().with_context("The document is busy. Reopen it to try again. Your saved content was kept.")
  })?;
  subscribe_document_changed(id, &mut write);
  subscribe_document_snapshot_state(&write);
  subscribe_document_sync_state(&write);
  Ok(())
}

/// Preserve the entire raw record, including unknown metadata, for the final
/// comparison. No encoded PB/document-data roundtrip or disk repair is involved.
#[derive(Clone, PartialEq, Eq)]
struct HyperCommittedRaw {
  mapping: Vec<u8>,
  records: Vec<(Vec<u8>, Vec<u8>)>,
  state: Vec<u8>,
  updates: Vec<Vec<u8>>,
}

fn required_local(
  db: &Weak<CollabKVDB>,
  uid: i64,
  workspace: Uuid,
  id: Uuid,
) -> FlowyResult<HyperCommittedRaw> {
  let db = db
    .upgrade()
    .ok_or_else(|| retained("The copied document storage was closed."))?;
  let read = db.read_txn();
  let workspace = workspace.to_string();
  let id = id.to_string();
  let mapping = match read
    .get(make_doc_id_key_v1(
      &uid.to_be_bytes(),
      workspace.as_bytes(),
      id.as_bytes(),
    ))
    .map_err(|_| retained("The committed body identity could not be read."))?
  {
    Some(mapping) => mapping,
    None => read
      .get(make_doc_id_key_v0(&uid.to_be_bytes(), id.as_bytes()))
      .map_err(|_| retained("The committed body identity could not be read."))?
      .ok_or_else(|| retained("The copied body is absent; no empty replacement was created."))?,
  };
  let bytes: [u8; 8] = mapping
    .as_slice()
    .try_into()
    .map_err(|_| retained("The copied body's storage identity is invalid."))?;
  let did = u64::from_be_bytes(bytes);
  let state = read
    .get(make_doc_state_key(did))
    .map_err(|_| retained("The committed body state could not be read."))?
    .ok_or_else(|| retained("The committed body state is missing."))?;
  let records = read
    .range(make_doc_start_key(did).as_ref()..make_doc_end_key(did).as_ref())
    .map_err(|_| retained("The committed body records could not be read."))?
    .map(|entry| (entry.key().to_vec(), entry.value().to_vec()))
    .collect();
  let updates = read
    .range(make_doc_update_key(did, 0).as_ref()..=make_doc_update_key(did, Clock::MAX).as_ref())
    .map_err(|_| retained("The committed body updates could not be read."))?
    .map(|entry| entry.value().to_vec())
    .collect();
  Ok(HyperCommittedRaw {
    mapping,
    records,
    state,
    updates,
  })
}

struct HyperCommittedPersistence {
  db: Weak<CollabKVDB>,
  uid: i64,
  workspace_id: Uuid,
  doc_id: Uuid,
  loaded: Arc<Mutex<Option<HyperCommittedRaw>>>,
}

impl CollabPersistence for HyperCommittedPersistence {
  fn load_collab_from_disk(&self, collab: &mut Collab) -> Result<(), CollabError> {
    let mut load = || -> FlowyResult<()> {
      if collab.object_id() != self.doc_id.to_string() {
        return Err(retained("The copied document identity is inconsistent."));
      }
      let raw = required_local(&self.db, self.uid, self.workspace_id, self.doc_id)?;
      {
        let mut txn = collab.context.transact_mut();
        txn
          .apply_update(Update::decode_v1(&raw.state).map_err(internal_error)?)
          .map_err(internal_error)?;
        for update in &raw.updates {
          txn
            .apply_update(Update::decode_v1(update).map_err(internal_error)?)
            .map_err(internal_error)?;
        }
      }
      *self
        .loaded
        .lock()
        .map_err(|_| retained("The local preparation lock is unavailable."))? = Some(raw);
      Ok(())
    };
    load().map_err(|error| CollabError::Internal(error.into()))
  }
  fn save_collab_to_disk(
    &self,
    _object_id: &str,
    _encoded: EncodedCollab,
  ) -> Result<(), CollabError> {
    Err(CollabError::Internal(
      retained("A publication read cannot replace committed body data.").into(),
    ))
  }
}

fn validate_document(document: &Document, id: Uuid) -> FlowyResult<()> {
  validate_collab(document, id)
}

/// Document::open would otherwise initialize absent maps. Require all of them
/// and their existing page identity before opening, while allowing unknown data.
fn validate_collab(collab: &Collab, id: Uuid) -> FlowyResult<()> {
  if collab.object_id() != id.to_string() {
    return Err(retained("The copied body has the wrong identity."));
  }
  CollabType::Document
    .validate_require_data(collab)
    .map_err(|_| retained("The committed document schema is unsupported."))?;
  let txn = collab.transact();
  let map = |parent: &MapRef, key: &str| -> FlowyResult<MapRef> {
    parent
      .get(&txn, key)
      .and_then(|value| value.cast().ok())
      .ok_or_else(|| retained("The committed document is incomplete; no fields were repaired."))
  };
  let root = map(&collab.data, "document")?;
  let blocks = map(&root, "blocks")?;
  let meta = map(&root, "meta")?;
  map(&meta, "children_map")?;
  map(&meta, "text_map")?;
  let page: String = root
    .get(&txn, "page_id")
    .and_then(|value| value.cast().ok())
    .ok_or_else(|| retained("The committed document page identity is missing."))?;
  let block = map(&blocks, &page)?;
  let stored_id: String = block
    .get(&txn, "id")
    .and_then(|value| value.cast().ok())
    .ok_or_else(|| retained("The committed page block identity is missing."))?;
  if page.is_empty() || stored_id != page {
    return Err(retained(
      "The committed document page identity is inconsistent.",
    ));
  }
  Ok(())
}
