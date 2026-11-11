use std::sync::Arc;
use std::sync::Mutex;
use std::sync::Weak;
use std::sync::atomic::{AtomicU64, Ordering};

use collab::core::collab::DataSource;
use collab::core::collab_plugin::CollabPersistence;
use collab::core::origin::CollabOrigin;
use collab::entity::EncodedCollab;
use collab::lock::RwLock;
use collab::preclude::Collab;
use collab_document::blocks::DocumentData;
use collab_document::document::Document;
use collab_document::document_awareness::DocumentAwarenessState;
use collab_document::document_awareness::DocumentAwarenessUser;
use collab_document::document_data::default_document_data;
use collab_entity::CollabType;

use collab_integrate::CollabKVAction;
use collab_integrate::collab_builder::{
  AppFlowyCollabBuilder, CollabBuilderConfig, CollabPersistenceImpl,
};
use collab_plugins::CollabKVDB;
use collab_plugins::local_storage::kv::KVTransactionDB;
use dashmap::DashMap;
use flowy_document_pub::cloud::DocumentCloudService;
use flowy_error::{ErrorCode, FlowyError, FlowyResult, internal_error};
use flowy_storage_pub::storage::{CreatedUpload, StorageService};
use lib_infra::util::timestamp;
use tracing::{event, instrument};
use tracing::{info, trace};
use uuid::Uuid;

use crate::entities::UpdateDocumentAwarenessStatePB;
use crate::entities::{
  DocumentSnapshotData, DocumentSnapshotMeta, DocumentSnapshotMetaPB, DocumentSnapshotPB,
};
use crate::hyper_committed_document::{
  HyperDocumentCacheEntry, HyperDocumentContext, hyper_subscribe_prepared_document,
};
use crate::reminder::DocumentReminderAction;

pub trait DocumentUserService: Send + Sync {
  fn user_id(&self) -> Result<i64, FlowyError>;
  fn device_id(&self) -> Result<String, FlowyError>;
  fn workspace_id(&self) -> Result<Uuid, FlowyError>;
  fn collab_db(&self, uid: i64) -> Result<Weak<CollabKVDB>, FlowyError>;
}

pub trait DocumentSnapshotService: Send + Sync {
  fn get_document_snapshot_metas(
    &self,
    document_id: &str,
  ) -> FlowyResult<Vec<DocumentSnapshotMeta>>;
  fn get_document_snapshot(&self, snapshot_id: &str) -> FlowyResult<DocumentSnapshotData>;
}

pub struct DocumentManager {
  pub user_service: Arc<dyn DocumentUserService>,
  pub(crate) collab_builder: Weak<AppFlowyCollabBuilder>,
  pub(crate) documents: Arc<DashMap<Uuid, HyperDocumentCacheEntry>>,
  pub(crate) removing_documents: Arc<DashMap<Uuid, HyperDocumentCacheEntry>>,
  pub(crate) document_epoch: AtomicU64,
  pub(crate) document_publication_gate: Arc<Mutex<()>>,
  cloud_service: Arc<dyn DocumentCloudService>,
  storage_service: Weak<dyn StorageService>,
  snapshot_service: Arc<dyn DocumentSnapshotService>,
}

impl Drop for DocumentManager {
  fn drop(&mut self) {
    trace!("[Drop] drop document manager");
  }
}

impl DocumentManager {
  pub fn new(
    user_service: Arc<dyn DocumentUserService>,
    collab_builder: Weak<AppFlowyCollabBuilder>,
    cloud_service: Arc<dyn DocumentCloudService>,
    storage_service: Weak<dyn StorageService>,
    snapshot_service: Arc<dyn DocumentSnapshotService>,
  ) -> Self {
    Self {
      user_service,
      collab_builder,
      documents: Arc::new(Default::default()),
      removing_documents: Arc::new(Default::default()),
      document_epoch: AtomicU64::new(0),
      document_publication_gate: Arc::new(Mutex::new(())),
      cloud_service,
      storage_service,
      snapshot_service,
    }
  }

  fn collab_builder(&self) -> FlowyResult<Arc<AppFlowyCollabBuilder>> {
    self
      .collab_builder
      .upgrade()
      .ok_or_else(FlowyError::ref_drop)
  }

  /// Get the encoded collab of the document.
  pub async fn get_encoded_collab_with_view_id(&self, doc_id: &Uuid) -> FlowyResult<EncodedCollab> {
    let uid = self.user_service.user_id()?;
    let workspace_id = self.user_service.workspace_id()?;
    let doc_state =
      CollabPersistenceImpl::new(self.user_service.collab_db(uid)?, uid, workspace_id)
        .into_data_source();
    let collab = self
      .collab_for_document(uid, doc_id, doc_state, false)
      .await?;
    let encoded_collab = collab
      .try_read()
      .unwrap()
      .encode_collab_v1(|collab| CollabType::Document.validate_require_data(collab))
      .map_err(internal_error)?;
    Ok(encoded_collab)
  }

  pub async fn initialize(&self, _uid: i64) -> FlowyResult<()> {
    trace!("initialize document manager");
    self.invalidate_document_context();
    Ok(())
  }

  /// Invalidate cache ownership synchronously at the start of an owner change,
  /// including close_db, before asynchronous workspace initialization runs.
  pub fn invalidate_document_context(&self) {
    let _publication = self
      .document_publication_gate
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    self.document_epoch.fetch_add(1, Ordering::SeqCst);
    self.documents.clear();
    self.removing_documents.clear();
  }

  #[instrument(
    name = "document_initialize_after_sign_up",
    level = "debug",
    skip_all,
    err
  )]
  pub async fn initialize_after_sign_up(&self, uid: i64) -> FlowyResult<()> {
    self.initialize(uid).await?;
    Ok(())
  }

  pub async fn initialize_after_open_workspace(&self, uid: i64) -> FlowyResult<()> {
    self.initialize(uid).await?;
    Ok(())
  }

  #[instrument(level = "debug", skip_all, err)]
  pub async fn initialize_after_sign_in(&self, uid: i64) -> FlowyResult<()> {
    self.initialize(uid).await?;
    Ok(())
  }

  pub async fn handle_reminder_action(&self, action: DocumentReminderAction) {
    match action {
      DocumentReminderAction::Add { reminder: _ } => {},
      DocumentReminderAction::Remove { reminder_id: _ } => {},
      DocumentReminderAction::Update { reminder: _ } => {},
    }
  }

  fn persistence(&self) -> FlowyResult<CollabPersistenceImpl> {
    let uid = self.user_service.user_id()?;
    let workspace_id = self.user_service.workspace_id()?;
    let db = self.user_service.collab_db(uid)?;
    Ok(CollabPersistenceImpl::new(db, uid, workspace_id))
  }

  /// Create a new document.
  ///
  /// if the document already exists, return the existing document.
  /// if the data is None, will create a document with default data.
  #[instrument(level = "info", skip(self, data))]
  pub async fn create_document(
    &self,
    _uid: i64,
    doc_id: &Uuid,
    data: Option<DocumentData>,
  ) -> FlowyResult<EncodedCollab> {
    if self.is_doc_exist(doc_id).await.unwrap_or(false) {
      Err(FlowyError::new(
        ErrorCode::RecordAlreadyExists,
        format!("document {} already exists", doc_id),
      ))
    } else {
      let encoded_collab = doc_state_from_document_data(doc_id, data).await?;
      self
        .persistence()?
        .save_collab_to_disk(doc_id.to_string().as_str(), encoded_collab.clone())
        .map_err(internal_error)?;

      // Send the collab data to server with a background task.
      let cloud_service = self.cloud_service.clone();
      let cloned_encoded_collab = encoded_collab.clone();
      let workspace_id = self.user_service.workspace_id()?;
      let doc_id = *doc_id;
      tokio::spawn(async move {
        let _ = cloud_service
          .create_document_collab(&workspace_id, &doc_id, cloned_encoded_collab)
          .await;
      });
      Ok(encoded_collab)
    }
  }

  async fn collab_for_document(
    &self,
    uid: i64,
    doc_id: &Uuid,
    data_source: DataSource,
    sync_enable: bool,
  ) -> FlowyResult<Arc<RwLock<Document>>> {
    let db = self.user_service.collab_db(uid)?;
    let workspace_id = self.user_service.workspace_id()?;
    let collab_object =
      self
        .collab_builder()?
        .collab_object(&workspace_id, uid, doc_id, CollabType::Document)?;
    let document = self
      .collab_builder()?
      .create_document(
        collab_object,
        data_source,
        db,
        CollabBuilderConfig::default().sync_enable(sync_enable),
        None,
      )
      .await?;
    Ok(document)
  }

  /// Return a document instance if the document is already opened.
  pub async fn editable_document(&self, doc_id: &Uuid) -> FlowyResult<Arc<RwLock<Document>>> {
    if let Some(doc) = self.hyper_cached_document(doc_id)? {
      return Ok(doc);
    }

    Err(FlowyError::internal().with_context("Call open document first"))
  }

  /// Returns Document for given object id
  /// If the document does not exist in local disk, try get the doc state from the cloud.
  /// If the document exists, open the document and cache it
  #[tracing::instrument(level = "info", skip(self), err)]
  async fn create_document_instance(
    &self,
    doc_id: &Uuid,
    enable_sync: bool,
  ) -> FlowyResult<Arc<RwLock<Document>>> {
    let context = HyperDocumentContext::capture(self)?;
    let uid = context.uid;
    let mut doc_state =
      CollabPersistenceImpl::new(context.db.clone(), uid, context.workspace_id).into_data_source();
    // If the document does not exist in local disk, try get the doc state from the cloud. This happens
    // When user_device_a create a document and user_device_b open the document.
    let exists = context
      .db
      .upgrade()
      .ok_or_else(FlowyError::ref_drop)?
      .read_txn()
      .is_exist(uid, &context.workspace_id.to_string(), &doc_id.to_string());
    if !exists {
      info!(
        "document {} not found in local disk, try to get the doc state from the cloud",
        doc_id
      );
      doc_state = DataSource::DocStateV1(
        self
          .cloud_service
          .get_document_doc_state(doc_id, &context.workspace_id)
          .await?,
      );
      context.check(self)?;

      // the doc_state should not be empty if remote return the doc state without error.
      if doc_state.is_empty() {
        return Err(FlowyError::new(
          ErrorCode::RecordNotFound,
          format!("document {} not found", doc_id),
        ));
      }
    }

    event!(
      tracing::Level::DEBUG,
      "Initialize document: {}, workspace_id: {:?}",
      doc_id,
      self.user_service.workspace_id()
    );
    context.check(self)?;
    if !enable_sync {
      // Ordinary data reads remain detached and do not enable cloud sync.
      let document = self
        .collab_for_document(uid, doc_id, doc_state, false)
        .await?;
      context.check(self)?;
      return Ok(document);
    }

    // Prepare without plugins running, then publish under the lifecycle gate.
    // This also gives copied-body retries proof of a cache entry's physical owner.
    let builder = self.collab_builder()?;
    let object = builder.collab_object(&context.workspace_id, uid, doc_id, CollabType::Document)?;
    let mut collab = builder
      .build_collab(&object, &context.db, doc_state)
      .await?;
    context.check(self)?;
    collab.enable_undo_redo();
    let document = Arc::new(RwLock::new(Document::open(collab).map_err(internal_error)?));
    let _publication = self.document_publication_gate.lock().map_err(|_| {
      FlowyError::internal().with_context("The document publication lock is unavailable.")
    })?;
    context.check(self)?;
    if let Some(current) = self.hyper_cached_document_in_context(doc_id, &context)? {
      return Ok(current.document);
    }
    hyper_subscribe_prepared_document(doc_id, &document)?;
    let document = builder
      .finalize(
        object,
        CollabBuilderConfig::default().sync_enable(true),
        document,
      )
      .map_err(|error| {
        tracing::warn!(phase = "hyper_document_builder_finalize", document_id = %doc_id, error = %error, "Document initialization failed");
        FlowyError::internal().with_context("The document is busy. Reopen it to try again. Your saved content was kept.")
      })?;
    context.check(self)?;
    self.documents.insert(
      *doc_id,
      HyperDocumentCacheEntry {
        context,
        document: document.clone(),
      },
    );
    Ok(document)
  }

  pub async fn get_document_data(&self, doc_id: &Uuid) -> FlowyResult<DocumentData> {
    let document = self.get_document(doc_id).await?;
    let document = document.read().await;
    crate::hyper_duplicate::hyper_validate_document_text(&document)?;
    document.get_document_data().map_err(internal_error)
  }

  pub async fn get_document_data_for_duplicate(&self, doc_id: &Uuid) -> FlowyResult<DocumentData> {
    let uid = self.user_service.user_id()?;
    let workspace = self.user_service.workspace_id()?;
    let db = self
      .user_service
      .collab_db(uid)?
      .upgrade()
      .ok_or_else(FlowyError::ref_drop)?;
    let source = self
      .snapshot_for_duplicate(uid, workspace, &db, doc_id, true)
      .await?
      .ok_or_else(FlowyError::record_not_found)?;
    let collab = Collab::new_with_source(
      CollabOrigin::Empty,
      &doc_id.to_string(),
      DataSource::DocStateV1(source.doc_state.to_vec()),
      vec![],
      false,
    )
    .map_err(internal_error)?;
    crate::hyper_duplicate::hyper_validate_document_pb_copy(&collab)?;
    Document::open(collab)
      .map_err(internal_error)?
      .get_document_data()
      .map_err(internal_error)
  }

  /// Snapshot a copy source without default creation, repair, deletion or plugins.
  /// Existing open edits take precedence over the persisted snapshot.
  pub async fn snapshot_for_duplicate(
    &self,
    uid: i64,
    workspace: Uuid,
    db: &Arc<CollabKVDB>,
    doc_id: &Uuid,
    required: bool,
  ) -> FlowyResult<Option<EncodedCollab>> {
    let check = || -> FlowyResult<()> {
      if self.user_service.user_id()? != uid
        || self.user_service.workspace_id()? != workspace
        || !self
          .user_service
          .collab_db(uid)?
          .upgrade()
          .is_some_and(|active| Arc::ptr_eq(&active, db))
      {
        return Err(
          FlowyError::invalid_data().with_context("The document owner changed while copying."),
        );
      }
      Ok(())
    };
    check()?;
    let opened = self.hyper_cached_document(doc_id)?;
    if let Some(opened) = opened {
      let opened = opened.read().await;
      check()?;
      crate::hyper_duplicate::hyper_validate_document_text_encoding(&opened)?;
      return opened
        .encode_collab_v1(|value| CollabType::Document.validate_require_data(value))
        .map(Some)
        .map_err(internal_error);
    }
    let local = {
      let read = db.read_txn();
      if read.is_exist(uid, &workspace.to_string(), &doc_id.to_string()) {
        let mut value = Collab::new(uid, &doc_id.to_string(), "duplicate-read", vec![], false);
        read
          .load_doc_with_txn(
            uid,
            &workspace.to_string(),
            &doc_id.to_string(),
            &mut value.context.transact_mut(),
          )
          .map_err(internal_error)?;
        Some(value)
      } else {
        None
      }
    };
    let value = match local {
      Some(value) => value,
      None if !required => return Ok(None),
      None => {
        let state = self
          .cloud_service
          .get_document_doc_state(doc_id, &workspace)
          .await?;
        check()?;
        if state.is_empty() {
          return Err(
            FlowyError::record_not_found()
              .with_context("The source row document is missing. No empty copy was created."),
          );
        }
        Collab::new_with_source(
          CollabOrigin::Empty,
          &doc_id.to_string(),
          DataSource::DocStateV1(state),
          vec![],
          false,
        )
        .map_err(internal_error)?
      },
    };
    check()?;
    crate::hyper_duplicate::hyper_validate_document_text_encoding(&value)?;
    value
      .encode_collab_v1(|value| CollabType::Document.validate_require_data(value))
      .map(Some)
      .map_err(internal_error)
  }
  pub async fn get_document_text(&self, doc_id: &Uuid) -> FlowyResult<String> {
    let document = self.get_document(doc_id).await?;
    let document = document.read().await;
    let text = document.paragraphs().join("\n");
    Ok(text)
  }

  /// Return a document instance.
  /// The returned document might or might not be able to sync with the cloud.
  async fn get_document(&self, doc_id: &Uuid) -> FlowyResult<Arc<RwLock<Document>>> {
    if let Some(doc) = self.hyper_cached_document(doc_id)? {
      return Ok(doc);
    }

    let document = self.create_document_instance(doc_id, false).await?;
    Ok(document)
  }

  pub async fn open_document(&self, doc_id: &Uuid) -> FlowyResult<()> {
    let context = HyperDocumentContext::capture(self)?;
    let cached = {
      let _publication = self.document_publication_gate.lock().map_err(|_| {
        FlowyError::internal().with_context("The document publication lock is unavailable.")
      })?;
      context.check(self)?;
      let active = self
        .documents
        .get(doc_id)
        .is_some_and(|entry| entry.context.matches(&context));
      self
        .hyper_cached_document_in_context(doc_id, &context)?
        .map(|entry| (entry.document, !active))
    };
    if let Some((mutex_document, restored)) = cached {
      // Preserve the existing distinction: an active open is a no-op, while
      // reopening a recently closed document restarts its existing sync plugin.
      if restored {
        let lock = mutex_document.read().await;
        let _publication = self.document_publication_gate.lock().map_err(|_| {
          FlowyError::internal().with_context("The document publication lock is unavailable.")
        })?;
        context.check(self)?;
        lock.start_init_sync();
      }
      return Ok(());
    }

    let _ = self.create_document_instance(doc_id, true).await?;
    Ok(())
  }

  pub async fn close_document(&self, doc_id: &Uuid) -> FlowyResult<()> {
    let context = HyperDocumentContext::capture(self)?;
    let candidate = self.hyper_cached_document(doc_id)?;
    if let Some(document) = candidate {
      {
        // clear the awareness state when close the document
        let mut lock = document.write().await;
        context.check(self)?;
        lock.clean_awareness_local_state();
      }
      let _publication = self.document_publication_gate.lock().map_err(|_| {
        FlowyError::internal().with_context("The document publication lock is unavailable.")
      })?;
      context.check(self)?;
      let Some((id, entry)) = self.documents.remove_if(doc_id, |_, entry| {
        Arc::ptr_eq(&entry.document, &document) && entry.context.matches(&context)
      }) else {
        return Ok(());
      };
      let clone_doc_id = id;
      trace!("move document to removing_documents: {}", doc_id);
      self.removing_documents.insert(id, entry);

      let weak_removing_documents = Arc::downgrade(&self.removing_documents);
      let publication_gate = self.document_publication_gate.clone();
      let weak_document = Arc::downgrade(&document);
      tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(120)).await;
        if let Some(removing_documents) = weak_removing_documents.upgrade() {
          let Ok(_publication) = publication_gate.lock() else {
            return;
          };
          if removing_documents
            .remove_if(&clone_doc_id, |_, entry| {
              Weak::ptr_eq(&Arc::downgrade(&entry.document), &weak_document)
            })
            .is_some()
          {
            trace!("drop document from removing_documents: {}", clone_doc_id);
          }
        }
      });
    }

    Ok(())
  }

  pub async fn delete_document(&self, doc_id: &Uuid) -> FlowyResult<()> {
    let context = HyperDocumentContext::capture(self)?;
    let uid = context.uid;
    let workspace_id = context.workspace_id;
    if let Some(db) = context.db.upgrade() {
      let _publication = self.document_publication_gate.lock().map_err(|_| {
        FlowyError::internal().with_context("The document publication lock is unavailable.")
      })?;
      context.check(self)?;
      db.with_write_txn(|write| {
        write.delete_doc(uid, &workspace_id.to_string(), &doc_id.to_string())
      })?;
      // When deleting a document, we need to remove it from the cache.
      self.documents.remove(doc_id);
      self.removing_documents.remove(doc_id);
    }
    Ok(())
  }

  #[instrument(level = "debug", skip_all, err)]
  pub async fn set_document_awareness_local_state(
    &self,
    doc_id: &Uuid,
    state: UpdateDocumentAwarenessStatePB,
  ) -> FlowyResult<bool> {
    let uid = self.user_service.user_id()?;
    let device_id = self.user_service.device_id()?;
    if let Ok(doc) = self.editable_document(doc_id).await {
      let doc = doc.write().await;
      let user = DocumentAwarenessUser { uid, device_id };
      let selection = state.selection.map(|s| s.into());
      let state = DocumentAwarenessState {
        version: 1,
        user,
        selection,
        metadata: state.metadata,
        timestamp: timestamp(),
      };
      doc.set_awareness_local_state(state);
      return Ok(true);
    }
    Ok(false)
  }

  /// Return the list of snapshots of the document.
  pub async fn get_document_snapshot_meta(
    &self,
    document_id: &Uuid,
    _limit: usize,
  ) -> FlowyResult<Vec<DocumentSnapshotMetaPB>> {
    let metas = self
      .snapshot_service
      .get_document_snapshot_metas(document_id.to_string().as_str())?
      .into_iter()
      .map(|meta| DocumentSnapshotMetaPB {
        snapshot_id: meta.snapshot_id,
        object_id: meta.object_id,
        created_at: meta.created_at,
      })
      .collect::<Vec<_>>();

    Ok(metas)
  }

  pub async fn get_document_snapshot(&self, snapshot_id: &str) -> FlowyResult<DocumentSnapshotPB> {
    let snapshot = self
      .snapshot_service
      .get_document_snapshot(snapshot_id)
      .map(|snapshot| DocumentSnapshotPB {
        object_id: snapshot.object_id,
        encoded_v1: snapshot.encoded_v1,
      })?;
    Ok(snapshot)
  }

  #[instrument(level = "debug", skip_all, err)]
  pub async fn upload_file(
    &self,
    workspace_id: String,
    document_id: &str,
    local_file_path: &str,
  ) -> FlowyResult<CreatedUpload> {
    let storage_service = self.storage_service_upgrade()?;
    let upload = storage_service
      .create_upload(&workspace_id, document_id, local_file_path)
      .await?
      .0;
    Ok(upload)
  }

  pub async fn download_file(&self, local_file_path: String, url: String) -> FlowyResult<()> {
    let storage_service = self.storage_service_upgrade()?;
    storage_service.download_object(url, local_file_path)?;
    Ok(())
  }

  pub async fn download_file_complete(
    &self,
    local_file_path: String,
    url: String,
  ) -> FlowyResult<()> {
    self
      .storage_service_upgrade()?
      .download_object_complete(url, local_file_path)
      .await
  }

  pub async fn delete_file(&self, url: String) -> FlowyResult<()> {
    let storage_service = self.storage_service_upgrade()?;
    storage_service.delete_object(url).await?;
    Ok(())
  }

  async fn is_doc_exist(&self, doc_id: &Uuid) -> FlowyResult<bool> {
    let uid = self.user_service.user_id()?;
    let workspace_id = self.user_service.workspace_id()?;
    if let Some(collab_db) = self.user_service.collab_db(uid)?.upgrade() {
      let is_exist = collab_db
        .is_exist(uid, &workspace_id.to_string(), &doc_id.to_string())
        .await?;
      Ok(is_exist)
    } else {
      Ok(false)
    }
  }

  fn storage_service_upgrade(&self) -> FlowyResult<Arc<dyn StorageService>> {
    let storage_service = self.storage_service.upgrade().ok_or_else(|| {
      FlowyError::internal().with_context("The file storage service is already dropped")
    })?;
    Ok(storage_service)
  }

  /// Only expose this method for testing
  #[cfg(debug_assertions)]
  pub fn get_cloud_service(&self) -> &Arc<dyn DocumentCloudService> {
    &self.cloud_service
  }
  /// Only expose this method for testing
  #[cfg(debug_assertions)]
  pub fn get_file_storage_service(&self) -> &Weak<dyn StorageService> {
    &self.storage_service
  }
}

async fn doc_state_from_document_data(
  doc_id: &Uuid,
  data: Option<DocumentData>,
) -> Result<EncodedCollab, FlowyError> {
  let doc_id = doc_id.to_string();
  let data = data.unwrap_or_else(|| {
    trace!(
      "{} document data is None, use default document data",
      doc_id.to_string()
    );
    default_document_data(&doc_id)
  });
  // spawn_blocking is used to avoid blocking the tokio thread pool if the document is large.
  let encoded_collab = tokio::task::spawn_blocking(move || {
    let collab = Collab::new_with_origin(CollabOrigin::Empty, doc_id, vec![], false);
    let document = Document::create_with_data(collab, data).map_err(internal_error)?;
    let encode_collab = document.encode_collab()?;
    Ok::<_, FlowyError>(encode_collab)
  })
  .await??;
  Ok(encoded_collab)
}
