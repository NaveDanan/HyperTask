use super::*;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Notify;

struct Source {
  reads: Arc<AtomicUsize>,
  started: Arc<Notify>,
  blocked: bool,
}
#[async_trait]
impl CollabIndexedData for Source {
  async fn get_unindexed_data(&self, _: &CollabType) -> Option<UnindexedData> {
    self.reads.fetch_add(1, Ordering::SeqCst);
    self.started.notify_one();
    if self.blocked {
      std::future::pending::<()>().await;
    }
    Some(UnindexedData::Text("owned content".into()))
  }
}
struct Consumer(Arc<Mutex<Vec<String>>>);
#[async_trait]
impl InstantIndexedDataConsumer for Consumer {
  fn consumer_id(&self) -> String {
    "owner-test".into()
  }
  async fn consume_collab(
    &self,
    _: &Uuid,
    data: Option<UnindexedData>,
    _: &Uuid,
    _: CollabType,
  ) -> FlowyResult<bool> {
    self.0.lock().unwrap().push(data.unwrap().into_string());
    Ok(true)
  }
  async fn did_delete_collab(&self, _: &Uuid, _: &Uuid) -> FlowyResult<()> {
    Ok(())
  }
}
fn source(blocked: bool) -> (Arc<dyn CollabIndexedData>, Arc<AtomicUsize>, Arc<Notify>) {
  let reads = Arc::new(AtomicUsize::new(0));
  let started = Arc::new(Notify::new());
  (
    Arc::new(Source {
      reads: reads.clone(),
      started: started.clone(),
      blocked,
    }),
    reads,
    started,
  )
}
fn object(uid: i64, workspace: Uuid, source: &Arc<dyn CollabIndexedData>) -> WriteObject {
  WriteObject {
    collab_object: CollabObject::new(
      uid,
      Uuid::new_v4().to_string(),
      CollabType::Document,
      workspace.to_string(),
      "owner-test".into(),
    ),
    collab: Arc::downgrade(source),
  }
}

#[tokio::test]
async fn hyper_search_scope_queue_checks_uid_before_reading_a_same_uuid_object() {
  let writer = InstantIndexedDataWriter::new();
  let workspace = Uuid::new_v4();
  writer.activate_owner(2, workspace, || true).await;
  let seen = Arc::new(Mutex::new(Vec::new()));
  writer
    .register_consumer(Box::new(Consumer(seen.clone())))
    .await;
  let (source, reads, _) = source(false);
  let foreign = object(1, workspace, &source);
  let expected = hyper_owner_snapshot(&writer.owner);
  assert!(!hyper_consume_write_object(&foreign, &writer.consumers, &writer.owner, &expected).await);
  assert_eq!(reads.load(Ordering::SeqCst), 0);
  assert!(seen.lock().unwrap().is_empty());
  writer
    .queue_collab_embed(foreign.collab_object.clone(), foreign.collab.clone())
    .await;
  assert!(writer.collab_by_object.read().await.is_empty());
  let owned = object(2, workspace, &source);
  assert!(hyper_consume_write_object(&owned, &writer.consumers, &writer.owner, &expected).await);
  assert_eq!(&*seen.lock().unwrap(), &["owned content"]);
}

#[tokio::test]
async fn hyper_search_scope_queue_cancels_a_blocked_source_before_new_owner_dispatch() {
  let writer = Arc::new(InstantIndexedDataWriter::new());
  let workspace = Uuid::new_v4();
  writer.activate_owner(1, workspace, || true).await;
  let seen = Arc::new(Mutex::new(Vec::new()));
  writer
    .register_consumer(Box::new(Consumer(seen.clone())))
    .await;
  let (source, _, started) = source(true);
  let object = object(1, workspace, &source);
  writer
    .queue_collab_embed(object.collab_object, object.collab)
    .await;
  let expected = hyper_owner_snapshot(&writer.owner);
  let worker = writer.clone();
  let task = tokio::spawn(async move {
    let queued = worker.collab_by_object.read().await;
    let object = queued.values().next().unwrap();
    hyper_consume_write_object(object, &worker.consumers, &worker.owner, &expected).await
  });
  started.notified().await;
  tokio::time::timeout(
    Duration::from_secs(2),
    writer.activate_owner(2, workspace, || true),
  )
  .await
  .expect("Owner initialization must cancel the source and release the queue read lock");
  writer
    .register_consumer(Box::new(Consumer(seen.clone())))
    .await;
  assert!(
    !tokio::time::timeout(Duration::from_secs(2), task)
      .await
      .unwrap()
      .unwrap()
  );
  assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn hyper_search_scope_queue_aba_cancels_old_work_and_clears_derived_objects_only() {
  let writer = InstantIndexedDataWriter::new();
  let workspace = Uuid::new_v4();
  writer.activate_owner(1, workspace, || true).await;
  let (source, _, _) = source(false);
  let original = object(1, workspace, &source);
  writer
    .queue_collab_embed(original.collab_object, original.collab)
    .await;
  assert_eq!(writer.collab_by_object.read().await.len(), 1);
  let previous = hyper_owner_snapshot(&writer.owner);
  writer.activate_owner(2, workspace, || true).await;
  writer.activate_owner(1, workspace, || true).await;
  assert!(!hyper_owner_current(&writer.owner, &previous));
  assert!(writer.collab_by_object.read().await.is_empty());
  assert_eq!(
    source
      .get_unindexed_data(&CollabType::Document)
      .await
      .unwrap()
      .into_string(),
    "owned content"
  );
}

#[tokio::test]
async fn hyper_search_scope_unscoped_writer_retains_its_existing_contract() {
  let writer = InstantIndexedDataWriter::new();
  let workspace = Uuid::new_v4();
  let seen = Arc::new(Mutex::new(Vec::new()));
  writer
    .register_consumer(Box::new(Consumer(seen.clone())))
    .await;
  let (source, _, _) = source(false);
  let object = object(42, workspace, &source);
  assert!(hyper_consume_write_object(&object, &writer.consumers, &writer.owner, &None).await);
  assert_eq!(seen.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn hyper_search_scope_stale_activation_and_registration_cannot_replace_the_current_owner() {
  let writer = InstantIndexedDataWriter::new();
  let workspace = Uuid::new_v4();
  writer.activate_owner(2, workspace, || true).await;
  let expected = hyper_owner_snapshot(&writer.owner);
  writer.activate_owner(1, workspace, || false).await;
  assert!(hyper_owner_current(&writer.owner, &expected));
  let seen = Arc::new(Mutex::new(Vec::new()));
  writer
    .register_consumer_when(Box::new(Consumer(seen)), || false)
    .await;
  assert_eq!(writer.num_consumers().await, 0);
}
