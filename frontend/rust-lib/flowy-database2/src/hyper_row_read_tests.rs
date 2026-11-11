use super::*;
use crate::hyper_creation::HyperDatabaseCreationOwner;
use crate::hyper_row_read::HyperRowReadFallback;
use collab::preclude::{Map, MapExt, MapRef};
use collab_database::rows::{Row, default_database_row_data};
use flowy_database_pub::cloud::{DatabaseSnapshot, EncodeCollabByOid};
use flowy_error::ErrorCode;
use std::collections::HashSet;
use tokio::sync::{Notify, Semaphore};

#[derive(Default)]
struct Reads {
  batch: StdMutex<EncodeCollabByOid>,
  single: StdMutex<EncodeCollabByOid>,
  errors: StdMutex<HashSet<Uuid>>,
  calls: StdMutex<Vec<Uuid>>,
  root: StdMutex<Option<(Uuid, EncodedCollab)>>,
  gate: StdMutex<Option<Arc<Semaphore>>>,
  active: AtomicUsize,
  maximum: AtomicUsize,
  changed: Notify,
}

struct Active<'a>(&'a Reads);
impl Drop for Active<'_> {
  fn drop(&mut self) {
    self.0.active.fetch_sub(1, Ordering::SeqCst);
    self.0.changed.notify_one();
  }
}

#[async_trait]
impl DatabaseCloudService for Reads {
  async fn get_database_encode_collab(
    &self,
    id: &Uuid,
    kind: CollabType,
    _: &Uuid,
  ) -> FlowyResult<Option<EncodedCollab>> {
    if kind == CollabType::WorkspaceDatabase {
      return Ok(Some(
        collab_database::workspace_database::default_workspace_database_data(&id.to_string()),
      ));
    }
    if kind == CollabType::Database {
      return Ok(
        self
          .root
          .lock()
          .unwrap()
          .as_ref()
          .filter(|(key, _)| key == id)
          .map(|(_, value)| value.clone()),
      );
    }
    self.calls.lock().unwrap().push(*id);
    let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
    self.maximum.fetch_max(active, Ordering::SeqCst);
    let _active = Active(self);
    self.changed.notify_one();
    let gate = self.gate.lock().unwrap().clone();
    if let Some(gate) = gate {
      gate.acquire().await.unwrap().forget();
    }
    if self.errors.lock().unwrap().contains(id) {
      return Err(FlowyError::new(
        ErrorCode::NotEnoughPermissions,
        "Fixture read denied",
      ));
    }
    Ok(self.single.lock().unwrap().get(id).cloned())
  }

  async fn create_database_encode_collab(
    &self,
    _: &Uuid,
    _: CollabType,
    _: &Uuid,
    _: EncodedCollab,
  ) -> FlowyResult<()> {
    panic!("Reading rows must not create or overwrite a remote collab")
  }

  async fn batch_get_database_encode_collab(
    &self,
    ids: Vec<Uuid>,
    _: CollabType,
    _: &Uuid,
  ) -> FlowyResult<EncodeCollabByOid> {
    Ok(
      self
        .batch
        .lock()
        .unwrap()
        .iter()
        .filter(|(id, _)| ids.contains(id))
        .map(|(id, value)| (*id, value.clone()))
        .collect(),
    )
  }
  async fn get_database_collab_object_snapshots(
    &self,
    _: &Uuid,
    _: usize,
  ) -> FlowyResult<Vec<DatabaseSnapshot>> {
    Ok(vec![])
  }
}

fn owner(fixture: &Fixture) -> HyperDatabaseCreationOwner {
  HyperDatabaseCreationOwner::capture(
    fixture.user.clone(),
    fixture.manager.duplicate_epoch.clone(),
    fixture.manager.duplicate_epoch.load(Ordering::SeqCst),
  )
  .unwrap()
  .with_changes(fixture.manager.duplicate_changes.clone())
}

fn row(database: &str) -> (Uuid, EncodedCollab) {
  let id = Uuid::new_v4();
  (
    id,
    default_database_row_data(&id.to_string().into(), Row::new(id.to_string(), database)),
  )
}

#[tokio::test]
async fn hyper_row_read_missing_batch_uses_single_without_reencoding_or_losing_unknown_data() {
  let f = Fixture::new(false).await;
  let (id, encoded) = row(&Uuid::new_v4().to_string());
  let mut raw = Collab::new_with_source(
    CollabOrigin::Empty,
    &id.to_string(),
    DataSource::from(encoded),
    vec![],
    false,
  )
  .unwrap();
  let data: MapRef = raw.data.get_with_path(&raw.transact(), ["data"]).unwrap();
  data.insert(
    &mut raw.context.transact_mut(),
    "future_row_metadata",
    "keep exactly",
  );
  let encoded = raw.encode_collab_v1(|_| Ok::<_, FlowyError>(())).unwrap();
  let cloud = Arc::new(Reads::default());
  cloud.single.lock().unwrap().insert(id, encoded.clone());
  let service: Arc<dyn DatabaseCloudService> = cloud.clone();
  let result = HyperRowReadFallback::default()
    .read(&owner(&f), &service, vec![id], CollabType::DatabaseRow)
    .await
    .unwrap();
  assert_eq!(result.get(&id), Some(&encoded));
  assert_eq!(*cloud.calls.lock().unwrap(), vec![id]);
}

#[tokio::test]
async fn hyper_row_read_batch_present_ids_never_fetch_again_and_missing_ids_deduplicate() {
  let f = Fixture::new(false).await;
  let database = Uuid::new_v4().to_string();
  let first = row(&database);
  let second = row(&database);
  let cloud = Arc::new(Reads::default());
  cloud.batch.lock().unwrap().insert(first.0, first.1.clone());
  cloud
    .single
    .lock()
    .unwrap()
    .insert(second.0, second.1.clone());
  let service: Arc<dyn DatabaseCloudService> = cloud.clone();
  let reader = HyperRowReadFallback::default();
  let result = reader
    .read(
      &owner(&f),
      &service,
      vec![first.0, second.0, second.0],
      CollabType::DatabaseRow,
    )
    .await
    .unwrap();
  assert_eq!(result.len(), 2);
  assert_eq!(*cloud.calls.lock().unwrap(), vec![second.0]);
  let empty = reader
    .read(&owner(&f), &service, vec![], CollabType::DatabaseRow)
    .await
    .unwrap();
  assert!(empty.is_empty());
  assert_eq!(cloud.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn hyper_row_read_rejects_malformed_wrong_type_wrong_id_and_invalid_database_id() {
  let f = Fixture::new(false).await;
  let database = Uuid::new_v4().to_string();
  let (id, good) = row(&database);
  let other = row(&database).1;
  let root = collab_database::database::default_database_data(&database)
    .await
    .unwrap();
  let invalid_database = default_database_row_data(
    &id.to_string().into(),
    Row::new(id.to_string(), "future-invalid-database"),
  );
  let mut malformed = good;
  malformed.doc_state = vec![255, 255, 255].into();
  for encoded in [other, root, invalid_database, malformed] {
    let cloud = Arc::new(Reads::default());
    cloud.single.lock().unwrap().insert(id, encoded.clone());
    let service: Arc<dyn DatabaseCloudService> = cloud.clone();
    assert!(
      HyperRowReadFallback::default()
        .read(&owner(&f), &service, vec![id], CollabType::DatabaseRow)
        .await
        .is_err()
    );
    // The same validation applies to data already present in the batch.
    cloud.batch.lock().unwrap().insert(id, encoded);
    cloud.calls.lock().unwrap().clear();
    assert!(
      HyperRowReadFallback::default()
        .read(&owner(&f), &service, vec![id], CollabType::DatabaseRow)
        .await
        .is_err()
    );
    assert!(cloud.calls.lock().unwrap().is_empty());
  }
}

#[tokio::test]
async fn hyper_row_read_permission_error_propagates_but_genuine_absence_remains_absent() {
  let f = Fixture::new(false).await;
  let id = Uuid::new_v4();
  let cloud = Arc::new(Reads::default());
  let service: Arc<dyn DatabaseCloudService> = cloud.clone();
  let reader = HyperRowReadFallback::default();
  assert!(
    reader
      .read(&owner(&f), &service, vec![id], CollabType::DatabaseRow)
      .await
      .unwrap()
      .is_empty()
  );
  cloud.errors.lock().unwrap().insert(id);
  let error = reader
    .read(&owner(&f), &service, vec![id], CollabType::DatabaseRow)
    .await
    .unwrap_err();
  assert_eq!(error.code, ErrorCode::NotEnoughPermissions);
}

#[tokio::test]
async fn hyper_row_read_shared_limit_and_owner_cancellation_drop_requests_and_queued_reads() {
  let f = Fixture::new(false).await;
  let captured = owner(&f);
  let cloud = Arc::new(Reads::default());
  *cloud.gate.lock().unwrap() = Some(Arc::new(Semaphore::new(0)));
  let service: Arc<dyn DatabaseCloudService> = cloud.clone();
  let reader = Arc::new(HyperRowReadFallback::default());
  let mut jobs = vec![];
  for _ in 0..2 {
    let reader = reader.clone();
    let owner = captured.clone();
    let cloud = service.clone();
    jobs.push(tokio::spawn(async move {
      reader
        .read(
          &owner,
          &cloud,
          (0..8).map(|_| Uuid::new_v4()).collect(),
          CollabType::DatabaseRow,
        )
        .await
    }));
  }
  tokio::time::timeout(Duration::from_secs(2), async {
    loop {
      let changed = cloud.changed.notified();
      if cloud.calls.lock().unwrap().len() == 4 {
        break;
      }
      changed.await;
    }
  })
  .await
  .unwrap();
  assert_eq!(cloud.maximum.load(Ordering::SeqCst), 4);
  f.manager.invalidate_duplicate_operations();
  for job in jobs {
    assert!(
      tokio::time::timeout(Duration::from_secs(2), job)
        .await
        .unwrap()
        .unwrap()
        .is_err()
    );
  }
  assert_eq!(cloud.active.load(Ordering::SeqCst), 0);
  assert_eq!(cloud.calls.lock().unwrap().len(), 4);
  assert!(
    reader
      .read(
        &captured,
        &service,
        vec![Uuid::new_v4()],
        CollabType::DatabaseRow
      )
      .await
      .is_err()
  );
  assert_eq!(cloud.calls.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn hyper_row_read_actual_manager_loads_all_initial_rows_from_single_live_reads() {
  let source = Fixture::new(false).await;
  let view = Uuid::new_v4().to_string();
  let params = crate::template::make_default_grid(&view, "Remote initial rows");
  let id = params.database_id.clone();
  let rows = params
    .rows
    .iter()
    .map(|row| row.id.clone())
    .collect::<Vec<_>>();
  let database = source.manager.import_database(params).await.unwrap();
  let cloud = Arc::new(Reads::default());
  *cloud.root.lock().unwrap() = Some((
    Uuid::parse_str(&id).unwrap(),
    database
      .read()
      .await
      .encode_collab_v1(|c| CollabType::Database.validate_require_data(c))
      .unwrap(),
  ));
  for row in &rows {
    let value = database
      .read()
      .await
      .get_or_init_database_row(row)
      .await
      .unwrap()
      .read()
      .await
      .encoded_collab()
      .unwrap();
    cloud
      .single
      .lock()
      .unwrap()
      .insert(Uuid::parse_str(row.as_str()).unwrap(), value);
  }
  let mut recipient = Fixture::new(false).await;
  recipient.manager.cloud_service = cloud.clone();
  recipient
    .manager
    .initialize(recipient.user.uid, false)
    .await
    .unwrap();
  recipient
    .manager
    .update_database_indexing(HashMap::from([(id.clone(), vec![view.clone()])]))
    .await
    .unwrap();
  let editor = recipient
    .manager
    .get_database_editor_with_view_id(&view)
    .await
    .unwrap();
  let opened = editor.open_database_view(&view, None).await.unwrap();
  assert_eq!(opened.id, id);
  assert_eq!(
    opened
      .rows
      .iter()
      .map(|row| row.id.as_str())
      .collect::<Vec<_>>(),
    rows.iter().map(|row| row.as_str()).collect::<Vec<_>>()
  );
  for row in &rows {
    assert_eq!(
      editor.get_row_meta(&view, row).await.unwrap().id,
      row.to_string()
    );
  }
  assert_eq!(cloud.calls.lock().unwrap().len(), 3);
  editor.open_database_view(&view, None).await.unwrap();
  assert_eq!(cloud.calls.lock().unwrap().len(), 3);
}
