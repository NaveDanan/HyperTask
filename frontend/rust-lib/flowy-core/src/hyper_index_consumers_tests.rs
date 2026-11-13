use super::*;
use collab::core::collab::IndexContent;
use flowy_search::services::manager::SearchManager;
use flowy_search_pub::tantivy_state_init::get_or_init_document_tantivy_state;
use std::time::Duration;

struct Fixture {
  path: std::path::PathBuf,
  workspace: Uuid,
}
impl Fixture {
  fn new() -> Self {
    let workspace = Uuid::new_v4();
    Self {
      path: std::env::temp_dir().join(format!("hyper-consumer-scope-{}", workspace)),
      workspace,
    }
  }
  fn state(&self) -> Arc<RwLock<DocumentTantivyState>> {
    get_or_init_document_tantivy_state(self.workspace, self.path.clone()).unwrap()
  }
}
impl Drop for Fixture {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.path);
  }
}
fn data(workspace_id: Uuid, text: &str) -> UnindexedCollab {
  UnindexedCollab {
    workspace_id,
    object_id: Uuid::from_u128(10),
    collab_type: CollabType::Document,
    data: Some(UnindexedData::Text(text.into())),
    metadata: UnindexedCollabMetadata {
      name: Some("Page".into()),
      icon: None,
    },
  }
}
async fn hits(state: &Arc<RwLock<DocumentTantivyState>>, query: &str) -> usize {
  let state = state.read().await;
  state.reader.reload().unwrap();
  state
    .search(&state.workspace_id, query, None, 10, 0.0)
    .unwrap()
    .len()
}

#[tokio::test]
async fn hyper_search_scope_full_consumer_requires_the_captured_uid_and_generation() {
  let fixture = Fixture::new();
  let state = fixture.state();
  let manager = SearchManager::new(vec![]);
  let owner = manager.begin_context(1, &fixture.workspace);
  manager
    .on_launch_if_authenticated(owner.clone(), Some(state.clone()))
    .await;
  let consumer = SearchFullIndexConsumer::new(owner, Arc::downgrade(&state));
  consumer
    .consume_indexed_data(2, &data(fixture.workspace, "foreignuidtoken"))
    .await
    .unwrap();
  assert_eq!(hits(&state, "foreignuidtoken").await, 0);
  consumer
    .consume_indexed_data(1, &data(fixture.workspace, "originaluidtoken"))
    .await
    .unwrap();
  assert_eq!(hits(&state, "originaluidtoken").await, 1);
  manager.begin_context(2, &fixture.workspace);
  consumer
    .consume_indexed_data(1, &data(fixture.workspace, "stalegenerationtoken"))
    .await
    .unwrap();
  assert_eq!(hits(&state, "stalegenerationtoken").await, 0);
  assert_eq!(hits(&state, "originaluidtoken").await, 1);
}

#[tokio::test]
async fn hyper_search_scope_full_consumer_cancels_a_pending_index_write_lock() {
  let fixture = Fixture::new();
  let state = fixture.state();
  let manager = SearchManager::new(vec![]);
  let owner = manager.begin_context(1, &fixture.workspace);
  manager
    .on_launch_if_authenticated(owner.clone(), Some(state.clone()))
    .await;
  let consumer = SearchFullIndexConsumer::new(owner, Arc::downgrade(&state));
  let guard = state.write().await;
  let indexed = data(fixture.workspace, "staleafterlocktoken");
  let task = tokio::spawn(async move { consumer.consume_indexed_data(1, &indexed).await });
  tokio::task::yield_now().await;
  manager.begin_context(2, &fixture.workspace);
  tokio::time::timeout(Duration::from_secs(2), task)
    .await
    .unwrap()
    .unwrap()
    .unwrap();
  drop(guard);
  assert_eq!(hits(&state, "staleafterlocktoken").await, 0);
}

#[tokio::test]
async fn hyper_search_scope_folder_observer_closes_its_receiver_and_drops_queued_old_deletes() {
  let fixture = Fixture::new();
  let state = fixture.state();
  let manager = SearchManager::new(vec![]);
  let owner = manager.begin_context(1, &fixture.workspace);
  manager
    .on_launch_if_authenticated(owner.clone(), Some(state.clone()))
    .await;
  state
    .write()
    .await
    .add_document(
      "same-view",
      Some("preservedobservertoken".into()),
      Some("Page".into()),
      None,
    )
    .unwrap();
  let (sender, receiver) = tokio::sync::broadcast::channel(4);
  let observer = FolderViewObserverImpl::new(owner, Arc::downgrade(&state));
  observer.set_observer_rx(receiver).await;
  let guard = state.write().await;
  sender
    .send(IndexContent::Delete(vec!["same-view".into()]))
    .unwrap();
  tokio::task::yield_now().await;
  manager.begin_context(2, &fixture.workspace);
  tokio::time::timeout(Duration::from_secs(2), async {
    while sender.receiver_count() != 0 {
      tokio::task::yield_now().await;
    }
  })
  .await
  .unwrap();
  drop(guard);
  assert_eq!(hits(&state, "preservedobservertoken").await, 1);
}
