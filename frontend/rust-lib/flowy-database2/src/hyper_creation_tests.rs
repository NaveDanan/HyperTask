use super::*;
use collab::core::collab_plugin::CollabPluginType;
use collab::preclude::CollabPlugin;
use collab_integrate::collab_builder::{
  CollabCloudPluginProvider, CollabPluginProviderContext, CollabPluginProviderType,
  WorkspaceCollabIntegrate,
};
use std::path::PathBuf;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

struct Directory(PathBuf);
impl Directory {
  fn new() -> Self {
    let path = std::env::temp_dir().join(format!("hyper-create-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    Self(path)
  }
}
impl Drop for Directory {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.0);
  }
}
struct User {
  uid: i64,
  workspace: StdMutex<Uuid>,
  wdb: Uuid,
  db: Arc<CollabKVDB>,
  closed: AtomicBool,
}
impl DatabaseUser for User {
  fn user_id(&self) -> FlowyResult<i64> {
    Ok(self.uid)
  }
  fn workspace_id(&self) -> FlowyResult<Uuid> {
    Ok(*self.workspace.lock().unwrap())
  }
  fn workspace_database_object_id(&self) -> FlowyResult<Uuid> {
    Ok(self.wdb)
  }
  fn collab_db(&self, uid: i64) -> FlowyResult<Weak<CollabKVDB>> {
    assert_eq!(uid, self.uid);
    if self.closed.load(Ordering::SeqCst) {
      return Err(crate::hyper_creation::interrupted());
    }
    Ok(Arc::downgrade(&self.db))
  }
}
struct Integrate(Arc<User>);
impl WorkspaceCollabIntegrate for Integrate {
  fn workspace_id(&self) -> FlowyResult<Uuid> {
    self.0.workspace_id()
  }
  fn device_id(&self) -> FlowyResult<String> {
    Ok("hyper-created-test".into())
  }
}
#[derive(Default)]
struct Events {
  initialized: StdMutex<HashMap<String, usize>>,
  flip_owner: StdMutex<Option<Arc<User>>>,
}
struct Plugin {
  id: String,
  events: Arc<Events>,
}
impl CollabPlugin for Plugin {
  fn plugin_type(&self) -> CollabPluginType {
    CollabPluginType::CloudStorage
  }
  fn did_init(&self, _collab: &Collab, _id: &str) {
    *self
      .events
      .initialized
      .lock()
      .unwrap()
      .entry(self.id.clone())
      .or_default() += 1;
  }
}
struct Provider {
  events: Arc<Events>,
  local: bool,
}
impl CollabCloudPluginProvider for Provider {
  fn provider_type(&self) -> CollabPluginProviderType {
    if self.local {
      CollabPluginProviderType::Local
    } else {
      CollabPluginProviderType::AppFlowyCloud
    }
  }
  fn is_sync_enabled(&self) -> bool {
    !self.local
  }
  fn get_plugins(&self, context: CollabPluginProviderContext) -> Vec<Box<dyn CollabPlugin>> {
    match context {
      CollabPluginProviderContext::AppFlowyCloud { collab_object, .. } => {
        if collab_object.collab_type == CollabType::DatabaseRow {
          if let Some(user) = self.events.flip_owner.lock().unwrap().take() {
            *user.workspace.lock().unwrap() = Uuid::new_v4();
          }
        }
        vec![Box::new(Plugin {
          id: collab_object.object_id.to_string(),
          events: self.events.clone(),
        })]
      },
      _ => vec![],
    }
  }
}
#[derive(Default)]
struct Cloud {
  creates: AtomicUsize,
}
#[async_trait]
impl DatabaseCloudService for Cloud {
  async fn get_database_encode_collab(
    &self,
    id: &Uuid,
    kind: CollabType,
    _: &Uuid,
  ) -> FlowyResult<Option<EncodedCollab>> {
    Ok((kind == CollabType::WorkspaceDatabase).then(|| {
      collab_database::workspace_database::default_workspace_database_data(&id.to_string())
    }))
  }
  async fn create_database_encode_collab(
    &self,
    _: &Uuid,
    _: CollabType,
    _: &Uuid,
    _: EncodedCollab,
  ) -> FlowyResult<()> {
    self.creates.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }
  async fn batch_get_database_encode_collab(
    &self,
    _: Vec<Uuid>,
    _: CollabType,
    _: &Uuid,
  ) -> FlowyResult<flowy_database_pub::cloud::EncodeCollabByOid> {
    Ok(HashMap::new())
  }
  async fn get_database_collab_object_snapshots(
    &self,
    _: &Uuid,
    _: usize,
  ) -> FlowyResult<Vec<flowy_database_pub::cloud::DatabaseSnapshot>> {
    Ok(vec![])
  }
}
struct AI;
#[async_trait]
impl DatabaseAIService for AI {}
pub(crate) struct Fixture {
  pub(crate) manager: DatabaseManager,
  pub(crate) builder: Arc<AppFlowyCollabBuilder>,
  user: Arc<User>,
  events: Arc<Events>,
  cloud: Arc<Cloud>,
  _directory: Directory,
}
impl Fixture {
  pub(crate) async fn new(local: bool) -> Self {
    let directory = Directory::new();
    let db = Arc::new(CollabKVDB::open(directory.0.join("db")).unwrap());
    let user = Arc::new(User {
      uid: 301,
      workspace: StdMutex::new(Uuid::new_v4()),
      wdb: Uuid::new_v4(),
      db,
      closed: AtomicBool::new(false),
    });
    let events = Arc::new(Events::default());
    let cloud = Arc::new(Cloud::default());
    let builder = Arc::new(AppFlowyCollabBuilder::new(
      Provider {
        events: events.clone(),
        local,
      },
      Integrate(user.clone()),
      None,
    ));
    let manager = DatabaseManager::new(
      user.clone(),
      Arc::new(TokioRwLock::new(TaskDispatcher::new(Duration::from_secs(
        5,
      )))),
      Arc::downgrade(&builder),
      cloud.clone(),
      Arc::new(AI),
    );
    manager.initialize(user.uid, local).await.unwrap();
    events.initialized.lock().unwrap().clear();
    Self {
      manager,
      builder,
      user,
      events,
      cloud,
      _directory: directory,
    }
  }
  pub(crate) fn count(&self, id: &str) -> usize {
    *self
      .events
      .initialized
      .lock()
      .unwrap()
      .get(id)
      .unwrap_or(&0)
  }
}

#[tokio::test]
async fn hyper_creation_initial_root_and_all_three_rows_initialize_once_without_http_snapshots() {
  let f = Fixture::new(false).await;
  let view = Uuid::new_v4().to_string();
  let params = crate::template::make_default_grid(&view, "Rows");
  let id = params.database_id.clone();
  let rows = params
    .rows
    .iter()
    .map(|row| row.id.clone())
    .collect::<Vec<_>>();
  let database = f.manager.import_database(params).await.unwrap();
  assert_eq!(f.count(&id), 1);
  for row in &rows {
    assert_eq!(f.count(row.as_str()), 1);
    assert!(
      database
        .read()
        .await
        .get_or_init_database_row(row)
        .await
        .unwrap()
        .read()
        .await
        .has_cloud_plugin()
    );
  }
  let scope = f.manager.hyper_duplicate_scope().unwrap();
  crate::hyper_creation::finalize_created_database(
    &scope,
    &f.manager.creation_gate,
    &f.builder,
    &database,
    &id,
    &rows,
  )
  .await
  .unwrap();
  let editor = f
    .manager
    .get_database_editor_with_view_id(&view)
    .await
    .unwrap();
  for row in &rows {
    editor.init_database_row(row).await.unwrap();
    editor.init_database_row(row).await.unwrap();
    assert_eq!(f.count(row.as_str()), 1);
  }
  assert_eq!(f.count(&id), 1);
  assert_eq!(f.events.initialized.lock().unwrap().len(), 4);
  assert_eq!(f.cloud.creates.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn hyper_creation_new_row_ack_and_concurrent_initializers_keep_its_sync_plugin() {
  let f = Fixture::new(false).await;
  let view = Uuid::new_v4().to_string();
  let params = crate::template::make_default_grid(&view, "Rows");
  f.manager.import_database(params).await.unwrap();
  let editor = f
    .manager
    .get_database_editor_with_view_id(&view)
    .await
    .unwrap();
  let row = editor
    .create_row(crate::entities::CreateRowPayloadPB {
      view_id: view.clone(),
      ..Default::default()
    })
    .await
    .unwrap()
    .unwrap();
  let id = row.row.id.clone();
  assert_eq!(f.count(id.as_str()), 1);
  let (a, b) = tokio::join!(editor.init_database_row(&id), editor.init_database_row(&id));
  let a = a.unwrap();
  assert!(Arc::ptr_eq(&a, &b.unwrap()));
  tokio::task::yield_now().await;
  assert_eq!(f.count(id.as_str()), 1);
  assert!(a.read().await.has_cloud_plugin());
}

#[tokio::test]
async fn hyper_creation_duplicate_input_rows_fail_without_silently_dropping_data() {
  let f = Fixture::new(false).await;
  let mut params = crate::template::make_default_grid(&Uuid::new_v4().to_string(), "Bad rows");
  params.rows[1].id = params.rows[0].id.clone();
  assert!(f.manager.import_database(params).await.is_err());
  assert!(f.events.initialized.lock().unwrap().is_empty());
  assert!(f.manager.get_all_databases_meta().await.is_empty());
}

#[tokio::test]
async fn hyper_creation_missing_expected_rows_is_an_error_and_keeps_the_completed_source() {
  let f = Fixture::new(false).await;
  let params = crate::template::make_default_grid(&Uuid::new_v4().to_string(), "Rows");
  let id = params.database_id.clone();
  let mut rows = params
    .rows
    .iter()
    .map(|row| row.id.clone())
    .collect::<Vec<_>>();
  let database = f.manager.import_database(params).await.unwrap();
  rows.push(Uuid::new_v4().to_string().into());
  let scope = f.manager.hyper_duplicate_scope().unwrap();
  assert!(
    crate::hyper_creation::finalize_created_database(
      &scope,
      &f.manager.creation_gate,
      &f.builder,
      &database,
      &id,
      &rows
    )
    .await
    .is_err()
  );
  assert_eq!(database.read().await.get_all_row_orders().await.len(), 3);
  assert_eq!(f.events.initialized.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn hyper_creation_owner_loss_keeps_old_data_and_does_not_finalize_new_owner_objects() {
  let f = Fixture::new(false).await;
  let original = f.user.workspace_id().unwrap();
  let params = crate::template::make_default_grid(&Uuid::new_v4().to_string(), "Rows");
  let id = params.database_id.clone();
  let rows = params
    .rows
    .iter()
    .map(|row| row.id.to_string())
    .collect::<Vec<_>>();
  *f.events.flip_owner.lock().unwrap() = Some(f.user.clone());
  assert!(f.manager.import_database(params).await.is_err());
  let read = f.user.db.read_txn();
  assert!(read.is_exist(f.user.uid, &original.to_string(), &id));
  for row in &rows {
    assert!(read.is_exist(f.user.uid, &original.to_string(), row));
    assert!(!read.is_exist(f.user.uid, &f.user.workspace_id().unwrap().to_string(), row));
  }
  assert_eq!(f.count(&id), 0);
  assert!(f.events.initialized.lock().unwrap().len() <= 1);
}

#[tokio::test]
async fn hyper_creation_offline_local_root_and_rows_remain_persisted() {
  let f = Fixture::new(true).await;
  let params = crate::template::make_default_grid(&Uuid::new_v4().to_string(), "Offline");
  let id = params.database_id.clone();
  let rows = params
    .rows
    .iter()
    .map(|row| row.id.to_string())
    .collect::<Vec<_>>();
  let database = f.manager.import_database(params).await.unwrap();
  let data = database.read().await;
  assert_eq!(data.get_all_row_orders().await.len(), 3);
  let read = f.user.db.read_txn();
  for object in std::iter::once(&id).chain(rows.iter()) {
    assert!(read.is_exist(
      f.user.uid,
      &f.user.workspace_id().unwrap().to_string(),
      object
    ));
  }
  assert_eq!(f.cloud.creates.load(Ordering::SeqCst), 0);
  assert!(f.events.initialized.lock().unwrap().is_empty());
}

#[tokio::test]
async fn hyper_creation_fetched_row_snapshot_remains_load_only() {
  let f = Fixture::new(false).await;
  let row_id: RowId = Uuid::new_v4().to_string().into();
  let database_id = Uuid::new_v4().to_string();
  let encoded = collab_database::rows::default_database_row_data(
    &row_id,
    collab_database::rows::Row::new(row_id.clone(), &database_id),
  );
  let owner = crate::hyper_creation::HyperDatabaseCreationOwner::capture(
    f.user.clone(),
    f.manager.duplicate_epoch.clone(),
    f.manager
      .duplicate_epoch
      .load(std::sync::atomic::Ordering::SeqCst),
  )
  .unwrap();
  let service = WorkspaceDatabaseCollabServiceImpl::new(
    false,
    Arc::downgrade(&f.builder),
    f.cloud.clone(),
    owner,
  );
  let collab = service
    .build_collab(
      row_id.as_str(),
      CollabType::DatabaseRow,
      Some((encoded, false)),
    )
    .await
    .unwrap();
  assert!(!collab.has_cloud_plugin());
  assert_eq!(f.cloud.creates.load(Ordering::SeqCst), 0);
  assert!(f.events.initialized.lock().unwrap().is_empty());
}

#[tokio::test]
async fn hyper_creation_closed_current_database_rejects_an_upgradeable_old_handle() {
  let f = Fixture::new(false).await;
  let owner = crate::hyper_creation::HyperDatabaseCreationOwner::capture(
    f.user.clone(),
    f.manager.duplicate_epoch.clone(),
    f.manager.duplicate_epoch.load(Ordering::SeqCst),
  )
  .unwrap();
  let scope = f.manager.hyper_duplicate_scope().unwrap();
  let original = owner.db.upgrade().unwrap();
  f.user.closed.store(true, Ordering::SeqCst);
  assert!(Arc::ptr_eq(&owner.db.upgrade().unwrap(), &original));
  assert!(owner.check().is_err());
  assert!(scope.check().is_err());
  let params = crate::template::make_default_grid(&Uuid::new_v4().to_string(), "Closed");
  assert!(f.manager.import_database(params).await.is_err());
  assert!(f.events.initialized.lock().unwrap().is_empty());
}

#[tokio::test]
async fn hyper_creation_poisoned_gate_returns_a_retained_data_error_instead_of_panicking() {
  let f = Fixture::new(false).await;
  let gate = f.manager.creation_gate.clone();
  assert!(
    std::thread::spawn(move || {
      let _guard = gate.lock().unwrap();
      panic!("deliberately poison the creation gate");
    })
    .join()
    .is_err()
  );
  let params = crate::template::make_default_grid(&Uuid::new_v4().to_string(), "Poisoned");
  assert!(f.manager.import_database(params).await.is_err());
  assert!(f.events.initialized.lock().unwrap().is_empty());
  // Invalidation must still revoke work after another thread poisoned the gate.
  let before = f.manager.duplicate_epoch.load(Ordering::SeqCst);
  f.manager.invalidate_duplicate_operations();
  assert!(f.manager.duplicate_epoch.load(Ordering::SeqCst) > before);
}

#[path = "hyper_row_read_tests.rs"]
mod hyper_row_read_tests;
