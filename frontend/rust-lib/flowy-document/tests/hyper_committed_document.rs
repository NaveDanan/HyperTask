#[path = "document/util.rs"]
mod util;

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};

use collab::core::collab_plugin::CollabPluginType;
use collab::core::origin::CollabOrigin;
use collab::preclude::*;
use collab_document::document::Document;
use collab_document::document_data::default_document_data;
use collab_integrate::CollabKVAction;
use collab_integrate::collab_builder::{
  AppFlowyCollabBuilder, CollabCloudPluginProvider, CollabPluginProviderContext,
  CollabPluginProviderType, WorkspaceCollabIntegrate,
};
use collab_plugins::CollabKVDB;
use collab_plugins::local_storage::kv::keys::{make_doc_id_key_v1, make_doc_update_key};
use collab_plugins::local_storage::kv::{KVEntry, KVStore, KVTransactionDB};
use flowy_document::entities::{DocumentSnapshotData, DocumentSnapshotMeta};
use flowy_document::hyper_committed_document::HyperCommittedDocumentScope;
use flowy_document::manager::{DocumentManager, DocumentSnapshotService, DocumentUserService};
use flowy_error::{FlowyError, FlowyResult};
use flowy_storage_pub::storage::StorageService;
use lib_infra::async_trait::async_trait;
use tempfile::TempDir;
use uuid::Uuid;

struct Owner {
  uid: i64,
  workspace: Uuid,
  db: Option<Arc<CollabKVDB>>,
}
struct User(Mutex<Owner>, Mutex<Option<InitCallback>>);
impl DocumentUserService for User {
  fn user_id(&self) -> FlowyResult<i64> {
    let uid = self.0.lock().unwrap().uid;
    let callback = self.1.lock().unwrap().clone();
    if let Some(callback) = callback {
      callback();
    }
    Ok(uid)
  }
  fn workspace_id(&self) -> FlowyResult<Uuid> {
    Ok(self.0.lock().unwrap().workspace)
  }
  fn device_id(&self) -> FlowyResult<String> {
    Ok("copied-document-test".into())
  }
  fn collab_db(&self, _uid: i64) -> FlowyResult<Weak<CollabKVDB>> {
    Ok(
      self
        .0
        .lock()
        .unwrap()
        .db
        .as_ref()
        .map(Arc::downgrade)
        .unwrap_or_default(),
    )
  }
}
struct Integrate {
  user: Arc<User>,
  on_device: Arc<Mutex<Option<InitCallback>>>,
}
impl WorkspaceCollabIntegrate for Integrate {
  fn workspace_id(&self) -> FlowyResult<Uuid> {
    self.user.workspace_id()
  }
  fn device_id(&self) -> FlowyResult<String> {
    if let Some(callback) = self.on_device.lock().unwrap().clone() {
      callback();
    }
    self.user.device_id()
  }
}
struct Snapshot;
impl DocumentSnapshotService for Snapshot {
  fn get_document_snapshot_metas(&self, _id: &str) -> FlowyResult<Vec<DocumentSnapshotMeta>> {
    Ok(vec![])
  }
  fn get_document_snapshot(&self, _id: &str) -> FlowyResult<DocumentSnapshotData> {
    Err(FlowyError::record_not_found())
  }
}
type InitCallback = Arc<dyn Fn() + Send + Sync>;
type DocumentWeak =
  Weak<collab::lock::RwLock<dyn std::borrow::BorrowMut<Collab> + Send + Sync + 'static>>;
struct Provider {
  inits: Arc<AtomicUsize>,
  starts: Arc<AtomicUsize>,
  on_init: Arc<Mutex<Option<InitCallback>>>,
  document: Arc<Mutex<Option<DocumentWeak>>>,
}
struct Plugin {
  inits: Arc<AtomicUsize>,
  starts: Arc<AtomicUsize>,
  on_init: Arc<Mutex<Option<InitCallback>>>,
}
impl CollabPlugin for Plugin {
  fn did_init(&self, _collab: &Collab, _id: &str) {
    self.inits.fetch_add(1, Ordering::SeqCst);
    if let Some(callback) = self.on_init.lock().unwrap().clone() {
      callback();
    }
  }
  fn plugin_type(&self) -> CollabPluginType {
    CollabPluginType::CloudStorage
  }
  fn start_init_sync(&self) {
    self.starts.fetch_add(1, Ordering::SeqCst);
  }
}
#[async_trait]
impl CollabCloudPluginProvider for Provider {
  fn provider_type(&self) -> CollabPluginProviderType {
    CollabPluginProviderType::AppFlowyCloud
  }
  fn is_sync_enabled(&self) -> bool {
    true
  }
  fn get_plugins(&self, context: CollabPluginProviderContext) -> Vec<Box<dyn CollabPlugin>> {
    if let CollabPluginProviderContext::AppFlowyCloud { local_collab, .. } = context {
      *self.document.lock().unwrap() = Some(local_collab);
    }
    vec![Box::new(Plugin {
      inits: self.inits.clone(),
      starts: self.starts.clone(),
      on_init: self.on_init.clone(),
    })]
  }
}

struct Fixture {
  manager: DocumentManager,
  user: Arc<User>,
  _builder: Arc<AppFlowyCollabBuilder>,
  root: TempDir,
  inits: Arc<AtomicUsize>,
  starts: Arc<AtomicUsize>,
  on_init: Arc<Mutex<Option<InitCallback>>>,
  on_device: Arc<Mutex<Option<InitCallback>>>,
  document: Arc<Mutex<Option<DocumentWeak>>>,
  generation: Arc<AtomicU64>,
  current: Arc<AtomicBool>,
  gate: Arc<Mutex<()>>,
}
impl Fixture {
  fn new() -> Self {
    let root = TempDir::new().unwrap();
    let user = Arc::new(User(
      Mutex::new(Owner {
        uid: 7,
        workspace: Uuid::new_v4(),
        db: Some(Arc::new(CollabKVDB::open(root.path()).unwrap())),
      }),
      Mutex::new(None),
    ));
    let inits = Arc::new(AtomicUsize::new(0));
    let starts = Arc::new(AtomicUsize::new(0));
    let on_init = Arc::new(Mutex::new(None));
    let on_device = Arc::new(Mutex::new(None));
    let document = Arc::new(Mutex::new(None));
    let builder = Arc::new(AppFlowyCollabBuilder::new(
      Provider {
        inits: inits.clone(),
        starts: starts.clone(),
        on_init: on_init.clone(),
        document: document.clone(),
      },
      Integrate {
        user: user.clone(),
        on_device: on_device.clone(),
      },
      None,
    ));
    let storage = Arc::new(util::DocumentTestFileStorageService) as Arc<dyn StorageService>;
    let manager = DocumentManager::new(
      user.clone(),
      Arc::downgrade(&builder),
      Arc::new(util::LocalTestDocumentCloudServiceImpl()),
      Arc::downgrade(&storage),
      Arc::new(Snapshot),
    );
    Self {
      manager,
      user,
      _builder: builder,
      root,
      inits,
      starts,
      on_init,
      on_device,
      document,
      generation: Arc::new(AtomicU64::new(0)),
      current: Arc::new(AtomicBool::new(true)),
      gate: Arc::new(Mutex::new(())),
    }
  }
  fn db(&self) -> Arc<CollabKVDB> {
    self.user.0.lock().unwrap().db.clone().unwrap()
  }
  fn scope(&self) -> HyperCommittedDocumentScope {
    let generation = self.generation.clone();
    let captured = generation.load(Ordering::SeqCst);
    let current = self.current.clone();
    HyperCommittedDocumentScope {
      uid: self.user.user_id().unwrap(),
      workspace_id: self.user.workspace_id().unwrap(),
      db: Arc::downgrade(&self.db()),
      is_current: Arc::new(move || {
        current.load(Ordering::SeqCst) && generation.load(Ordering::SeqCst) == captured
      }),
      publication_gate: self.gate.clone(),
    }
  }
  fn commit(&self, id: Uuid, value: &str) {
    let mut data = default_document_data(&id.to_string());
    let block = data
      .blocks
      .values_mut()
      .find(|block| block.ty == "paragraph")
      .unwrap();
    block.external_id = Some("copy-text".into());
    block.external_type = Some("text".into());
    data
      .meta
      .text_map
      .get_or_insert_with(Default::default)
      .insert(
        "copy-text".into(),
        serde_json::json!([{ "insert":value }]).to_string(),
      );
    let mut document = Document::create(&id.to_string(), data).unwrap();
    {
      let collab: &mut Collab = std::borrow::BorrowMut::borrow_mut(&mut document);
      collab.data.insert(
        &mut collab.context.transact_mut(),
        "future_root",
        MapPrelim::from([("retained", true)]),
      );
    }
    self.commit_raw(id, &document);
  }
  fn commit_raw(&self, id: Uuid, collab: &Collab) {
    self
      .db()
      .with_write_txn(|write| {
        write.create_new_doc(
          self.user.user_id().unwrap(),
          &self.user.workspace_id().unwrap().to_string(),
          &id.to_string(),
          &collab.transact(),
        )
      })
      .unwrap();
  }
  fn bytes(&self) -> Vec<(Vec<u8>, Vec<u8>)> {
    self
      .db()
      .read_txn()
      .range([0u8].as_ref()..[255u8].as_ref())
      .unwrap()
      .map(|entry| (entry.key().to_vec(), entry.value().to_vec()))
      .collect()
  }
  async fn text(&self, id: Uuid) -> String {
    let live = self.manager.editable_document(&id).await.unwrap();
    let read = live.read().await;
    read.get_document_data().unwrap().meta.text_map.unwrap()["copy-text"].clone()
  }

  /// Real cloud plugins queue Arc readers during did_init. Force one reader to
  /// acquire the lock before the manager's post-finalize owner check returns.
  fn queued_cloud_reader(&self) -> QueuedCloudReader {
    let release = Arc::new(AtomicBool::new(false));
    let held = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let thread = Arc::new(Mutex::new(None));
    let document = self.document.clone();
    let (reader_release, reader_held, reader_finished, reader_thread) = (
      release.clone(),
      held.clone(),
      finished.clone(),
      thread.clone(),
    );
    *self.on_init.lock().unwrap() = Some(Arc::new(move || {
      let document = document.lock().unwrap().clone().unwrap();
      let (release, held, finished) = (
        reader_release.clone(),
        reader_held.clone(),
        reader_finished.clone(),
      );
      *reader_thread.lock().unwrap() = Some(std::thread::spawn(move || {
        let document = document
          .upgrade()
          .expect("prepared cloud document must remain live");
        let read = document.blocking_read();
        held.store(true, Ordering::SeqCst);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !release.load(Ordering::SeqCst) && std::time::Instant::now() < deadline {
          std::thread::sleep(std::time::Duration::from_millis(1));
        }
        drop(read);
        finished.store(true, Ordering::SeqCst);
      }));
    }));
    let inits = self.inits.clone();
    let reader_held = held.clone();
    *self.user.1.lock().unwrap() = Some(Arc::new(move || {
      if inits.load(Ordering::SeqCst) == 0 {
        return;
      }
      let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
      while !reader_held.load(Ordering::SeqCst) && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(1));
      }
      assert!(
        reader_held.load(Ordering::SeqCst),
        "queued cloud reader did not acquire the released finalize lock"
      );
    }));
    QueuedCloudReader {
      release,
      held,
      finished,
      thread,
    }
  }
}

struct QueuedCloudReader {
  release: Arc<AtomicBool>,
  held: Arc<AtomicBool>,
  finished: Arc<AtomicBool>,
  thread: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
}
impl Drop for QueuedCloudReader {
  fn drop(&mut self) {
    self.release.store(true, Ordering::SeqCst);
    if let Some(thread) = self.thread.lock().unwrap().take() {
      let _ = thread.join();
    }
  }
}

#[tokio::test]
async fn hyper_committed_document_normal_open_publishes_with_real_cloud_reader_holding_lock() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "retained");
  let reader = fixture.queued_cloud_reader();
  let result = fixture.manager.open_document(&id).await;
  assert!(reader.held.load(Ordering::SeqCst));
  assert!(
    !reader.finished.load(Ordering::SeqCst),
    "publication must not wait for the plugin reader to finish"
  );
  drop(reader);
  result.expect("cloud reader must not turn a normal open into TryLockError");
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
  assert!(fixture.text(id).await.contains("retained"));
}

#[tokio::test]
async fn hyper_committed_document_copy_publishes_with_real_cloud_reader_holding_lock() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "retained");
  let before = fixture.bytes();
  let reader = fixture.queued_cloud_reader();
  let result = fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await;
  assert!(reader.held.load(Ordering::SeqCst));
  assert!(
    !reader.finished.load(Ordering::SeqCst),
    "publication must not wait for the plugin reader to finish"
  );
  drop(reader);
  result.expect("cloud reader must not cause uncertain publication after a committed copy");
  assert_eq!(fixture.bytes(), before);
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn hyper_committed_document_initializes_once_and_retries_preserve_current_edits_and_history()
{
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "copied 😀");
  let before = fixture.bytes();
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  let live = fixture.manager.editable_document(&id).await.unwrap();
  {
    let document = live.read().await;
    assert!(!document.can_undo());
    assert!(!document.can_redo());
    assert_eq!(document.to_json_value()["future_root"]["retained"], true);
  }
  assert_eq!(
    fixture.bytes(),
    before,
    "initialization must not rewrite any raw data"
  );
  live.write().await.apply_text_delta(
    "copy-text",
    serde_json::json!([{ "retain":9 }, { "insert":" later" }]).to_string(),
  );
  let edited = fixture.text(id).await;
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  assert!(Arc::ptr_eq(
    &live,
    &fixture.manager.editable_document(&id).await.unwrap()
  ));
  assert_eq!(fixture.text(id).await, edited);
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
  assert!(live.write().await.undo());
  assert!(!fixture.text(id).await.contains("later"));
  assert!(live.write().await.redo());
  assert_eq!(fixture.text(id).await, edited);
}

#[tokio::test]
async fn hyper_committed_document_reuses_normal_open_and_recently_closed_instance() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "original");
  fixture.manager.open_document(&id).await.unwrap();
  let live = fixture.manager.editable_document(&id).await.unwrap();
  live.write().await.apply_text_delta(
    "copy-text",
    serde_json::json!([{ "insert":"edit " }]).to_string(),
  );
  fixture.manager.close_document(&id).await.unwrap();
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  assert!(Arc::ptr_eq(
    &live,
    &fixture.manager.editable_document(&id).await.unwrap()
  ));
  assert!(fixture.text(id).await.contains("edit "));
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn hyper_committed_document_normal_open_restarts_sync_only_for_recently_closed_entries() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "retained");
  fixture.manager.open_document(&id).await.unwrap();
  fixture.manager.open_document(&id).await.unwrap();
  assert_eq!(
    fixture.starts.load(Ordering::SeqCst),
    0,
    "an active cache hit stays a no-op"
  );
  fixture.manager.close_document(&id).await.unwrap();
  fixture.manager.open_document(&id).await.unwrap();
  fixture.manager.open_document(&id).await.unwrap();
  assert_eq!(
    fixture.starts.load(Ordering::SeqCst),
    1,
    "only a recently closed open restarts sync"
  );
  fixture.manager.close_document(&id).await.unwrap();
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  fixture.manager.open_document(&id).await.unwrap();
  assert_eq!(
    fixture.starts.load(Ordering::SeqCst),
    1,
    "copy retries keep the current initialized plugin"
  );
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn hyper_committed_document_absent_or_deleted_body_is_never_recreated_even_if_cached() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  let error = fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap_err();
  assert!(error.msg.contains("kept"));
  assert!(fixture.bytes().is_empty());
  fixture.commit(id, "retained");
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  fixture
    .db()
    .delete_doc(
      fixture.user.user_id().unwrap(),
      &fixture.user.workspace_id().unwrap().to_string(),
      &id.to_string(),
    )
    .await
    .unwrap();
  let bytes = fixture.bytes();
  assert!(
    fixture
      .manager
      .hyper_initialize_committed_document(fixture.scope(), id)
      .await
      .is_err()
  );
  assert_eq!(fixture.bytes(), bytes);
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn hyper_committed_document_foreign_physical_root_with_reused_ids_never_reuses_cached_arc() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "root A");
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  let old = fixture.manager.editable_document(&id).await.unwrap();
  let old_scope = fixture.scope();
  let other = TempDir::new().unwrap();
  fixture.user.0.lock().unwrap().db = Some(Arc::new(CollabKVDB::open(other.path()).unwrap()));
  fixture.commit(id, "root B");
  let bytes = fixture.bytes();
  assert!(
    fixture
      .manager
      .hyper_initialize_committed_document(old_scope, id)
      .await
      .is_err()
  );
  assert_eq!(fixture.bytes(), bytes);
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  assert!(!Arc::ptr_eq(
    &old,
    &fixture.manager.editable_document(&id).await.unwrap()
  ));
  assert!(fixture.text(id).await.contains("root B"));
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn hyper_committed_document_rejects_owner_aba_and_closed_storage_without_side_effects() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "kept");
  let before = fixture.bytes();
  let stale = fixture.scope();
  fixture.generation.fetch_add(2, Ordering::SeqCst);
  assert!(
    fixture
      .manager
      .hyper_initialize_committed_document(stale, id)
      .await
      .is_err()
  );
  assert_eq!(fixture.bytes(), before);
  let closed = fixture.scope();
  let retained_db = fixture.user.0.lock().unwrap().db.take();
  assert!(
    fixture
      .manager
      .hyper_initialize_committed_document(closed, id)
      .await
      .is_err()
  );
  fixture.user.0.lock().unwrap().db = retained_db;
  assert_eq!(fixture.bytes(), before);
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn hyper_committed_document_rechecks_owner_after_async_preparation_before_any_plugin_init() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "kept");
  let before = fixture.bytes();
  let generation = fixture.generation.clone();
  let calls = Arc::new(AtomicUsize::new(0));
  let devices = calls.clone();
  *fixture.on_device.lock().unwrap() = Some(Arc::new(move || {
    if devices.fetch_add(1, Ordering::SeqCst) == 1 {
      generation.fetch_add(2, Ordering::SeqCst);
    }
  }));
  assert!(
    fixture
      .manager
      .hyper_initialize_committed_document(fixture.scope(), id)
      .await
      .is_err()
  );
  assert_eq!(calls.load(Ordering::SeqCst), 2);
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 0);
  assert_eq!(fixture.bytes(), before);
}

#[tokio::test]
async fn hyper_committed_document_invalid_or_incomplete_schema_does_not_repair_saved_data() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  let mut raw = Collab::new_with_origin(CollabOrigin::Empty, &id.to_string(), vec![], false);
  raw.data.insert(
    &mut raw.context.transact_mut(),
    "document",
    MapPrelim::from([("future_field", true)]),
  );
  fixture.commit_raw(id, &raw);
  let before = fixture.bytes();
  for _ in 0..2 {
    assert!(
      fixture
        .manager
        .hyper_initialize_committed_document(fixture.scope(), id)
        .await
        .is_err()
    );
    assert_eq!(fixture.bytes(), before);
  }
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn hyper_committed_document_corrupt_update_is_retained_and_never_silently_truncated() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "kept");
  let db = fixture.db();
  let uid = fixture.user.user_id().unwrap();
  let workspace = fixture.user.workspace_id().unwrap().to_string();
  let mapping = db
    .read_txn()
    .get(make_doc_id_key_v1(
      &uid.to_be_bytes(),
      workspace.as_bytes(),
      id.to_string().as_bytes(),
    ))
    .unwrap()
    .unwrap();
  let did = u64::from_be_bytes(mapping.as_slice().try_into().unwrap());
  db.with_write_txn(|write| {
    write.insert(make_doc_update_key(did, 1), [255, 255, 255])?;
    Ok(())
  })
  .unwrap();
  let before = fixture.bytes();
  assert!(
    fixture
      .manager
      .hyper_initialize_committed_document(fixture.scope(), id)
      .await
      .is_err()
  );
  assert_eq!(fixture.bytes(), before);
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn hyper_committed_document_injected_publication_failure_retains_bytes_and_retry_initializes_once()
 {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "kept");
  let before = fixture.bytes();
  let failed = Arc::new(Mutex::new(()));
  let poison = failed.clone();
  assert!(
    std::thread::spawn(move || {
      let _lock = poison.lock().unwrap();
      panic!("injected publication failure");
    })
    .join()
    .is_err()
  );
  let mut scope = fixture.scope();
  scope.publication_gate = failed;
  assert!(
    fixture
      .manager
      .hyper_initialize_committed_document(scope, id)
      .await
      .is_err()
  );
  assert_eq!(fixture.bytes(), before);
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 0);
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn hyper_committed_document_owner_loss_during_plugin_init_reports_retained_uncertainty() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "kept");
  let before = fixture.bytes();
  let current = fixture.current.clone();
  *fixture.on_init.lock().unwrap() = Some(Arc::new(move || {
    current.store(false, Ordering::SeqCst);
  }));
  let error = fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap_err();
  assert!(error.msg.contains("committed"));
  assert!(error.msg.contains("kept"));
  assert_eq!(fixture.bytes(), before);
  assert!(fixture.manager.editable_document(&id).await.is_err());
}

#[tokio::test]
async fn hyper_committed_document_manager_lifecycle_discards_old_cache_even_when_ids_and_db_are_same()
 {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "kept");
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  let old = fixture.manager.editable_document(&id).await.unwrap();
  fixture.manager.invalidate_document_context();
  assert!(fixture.manager.editable_document(&id).await.is_err());
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  assert!(!Arc::ptr_eq(
    &old,
    &fixture.manager.editable_document(&id).await.unwrap()
  ));
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn hyper_committed_document_actual_edits_undo_redo_persist_across_physical_reopen_with_empty_history()
 {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "initial");
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  {
    let live = fixture.manager.editable_document(&id).await.unwrap();
    live.write().await.apply_text_delta(
      "copy-text",
      serde_json::json!([{ "retain":7 },{ "insert":" 😀 later" }]).to_string(),
    );
    assert!(live.write().await.undo());
    assert!(live.write().await.redo());
  }
  let expected = fixture.text(id).await;
  let bytes = fixture.bytes();
  fixture
    .manager
    .initialize(fixture.user.user_id().unwrap())
    .await
    .unwrap();
  let old_db = fixture.user.0.lock().unwrap().db.take().unwrap();
  old_db.flush().unwrap();
  drop(old_db);
  fixture.user.0.lock().unwrap().db =
    Some(Arc::new(CollabKVDB::open(fixture.root.path()).unwrap()));
  fixture
    .manager
    .hyper_initialize_committed_document(fixture.scope(), id)
    .await
    .unwrap();
  assert_eq!(fixture.bytes(), bytes);
  assert_eq!(fixture.text(id).await, expected);
  let live = fixture.manager.editable_document(&id).await.unwrap();
  let document = live.read().await;
  assert!(!document.can_undo());
  assert!(!document.can_redo());
  assert_eq!(document.to_json_value()["future_root"]["retained"], true);
}

#[tokio::test]
async fn hyper_committed_document_plain_get_data_keeps_sync_disabled() {
  let fixture = Fixture::new();
  let id = Uuid::new_v4();
  fixture.commit(id, "read only");
  let before = fixture.bytes();
  assert!(fixture.manager.get_document_data(&id).await.is_ok());
  assert_eq!(fixture.inits.load(Ordering::SeqCst), 0);
  assert!(fixture.manager.editable_document(&id).await.is_err());
  assert_eq!(fixture.bytes(), before);
}
