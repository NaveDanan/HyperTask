use super::*;
use crate::entities::{LocalSearchResponseItemPB, RepeatedLocalSearchResponseItemPB};
use flowy_search_pub::tantivy_state_init::get_or_init_document_tantivy_state;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::sync::{Notify, mpsc};
use tokio_stream::wrappers::UnboundedReceiverStream;

struct Handler {
  requests: mpsc::UnboundedSender<(String, mpsc::UnboundedSender<FlowyResult<SearchResponsePB>>)>,
}
#[async_trait]
impl SearchHandler for Handler {
  fn search_type(&self) -> SearchType {
    SearchType::Folder
  }
  async fn perform_search(
    &self,
    query: String,
    _workspace: &Uuid,
  ) -> Pin<Box<dyn Stream<Item = FlowyResult<SearchResponsePB>> + Send>> {
    let (sender, receiver) = mpsc::unbounded_channel();
    self.requests.send((query, sender)).unwrap();
    Box::pin(UnboundedReceiverStream::new(receiver))
  }
}
fn manager() -> (
  Arc<SearchManager>,
  mpsc::UnboundedReceiver<(String, mpsc::UnboundedSender<FlowyResult<SearchResponsePB>>)>,
) {
  let (sender, receiver) = mpsc::unbounded_channel();
  (
    Arc::new(SearchManager::new(vec![Arc::new(Handler {
      requests: sender,
    })])),
    receiver,
  )
}
fn response(id: &str) -> SearchResponsePB {
  SearchResponsePB {
    local_search_result: Some(RepeatedLocalSearchResponseItemPB {
      items: vec![LocalSearchResponseItemPB {
        id: id.into(),
        display_name: id.into(),
        ..Default::default()
      }],
    }),
    ..Default::default()
  }
}
#[derive(Clone)]
struct Sink {
  frames: Arc<Mutex<Vec<Vec<u8>>>>,
  blocked: Arc<AtomicBool>,
  polling: Arc<Notify>,
}
impl Sink {
  fn new(blocked: bool) -> Self {
    Self {
      frames: Default::default(),
      blocked: Arc::new(AtomicBool::new(blocked)),
      polling: Arc::new(Notify::new()),
    }
  }
  fn states(&self) -> Vec<SearchStatePB> {
    self
      .frames
      .lock()
      .unwrap()
      .iter()
      .map(|frame| SearchStatePB::try_from(frame.as_slice()).unwrap())
      .collect()
  }
}
impl futures::Sink<Vec<u8>> for Sink {
  type Error = std::io::Error;
  fn poll_ready(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
    self.polling.notify_one();
    if self.blocked.load(Ordering::SeqCst) {
      Poll::Pending
    } else {
      Poll::Ready(Ok(()))
    }
  }
  fn start_send(self: Pin<&mut Self>, value: Vec<u8>) -> Result<(), Self::Error> {
    self.frames.lock().unwrap().push(value);
    Ok(())
  }
  fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
    Poll::Ready(Ok(()))
  }
  fn poll_close(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
    Poll::Ready(Ok(()))
  }
}
async fn finish(task: tokio::task::JoinHandle<()>) {
  tokio::time::timeout(Duration::from_secs(2), task)
    .await
    .expect("Canceled search must settle without another backend reply")
    .unwrap();
}
fn search(
  manager: &Arc<SearchManager>,
  sink: &Sink,
  id: i64,
  query: &str,
) -> tokio::task::JoinHandle<()> {
  let manager = manager.clone();
  let sink = sink.clone();
  let query = query.to_string();
  tokio::spawn(async move {
    manager.perform_search_with_sink(query, sink, id).await;
  })
}

#[tokio::test]
async fn hyper_search_scope_replacement_drops_late_results_and_finishes_and_accepts_a_new_id_sequence()
 {
  let workspace = Uuid::new_v4();
  let (manager, mut requests) = manager();
  let owner = manager.begin_context(1, &workspace);
  manager.initialize_after_sign_in(owner.clone(), None).await;
  let previous = Sink::new(false);
  let old = search(&manager, &previous, 100, "old");
  let (_, old_reply) = requests.recv().await.unwrap();
  let next_owner = manager.begin_context(2, &workspace);
  manager
    .initialize_after_sign_in(next_owner.clone(), None)
    .await;
  finish(old).await;
  assert!(old_reply.send(Ok(response("private old result"))).is_err());
  assert!(previous.states().is_empty());
  assert!(!owner.is_current());
  let current = Sink::new(false);
  let task = search(&manager, &current, 1, "new");
  let (query, reply) = requests.recv().await.unwrap();
  assert_eq!(query, "new");
  reply.send(Ok(response("current"))).unwrap();
  drop(reply);
  finish(task).await;
  let states = current.states();
  assert_eq!(states.len(), 2);
  assert!(states.iter().all(|state| state.search_id == "1"));
  assert_eq!(
    states[0]
      .response
      .as_ref()
      .unwrap()
      .local_search_result
      .as_ref()
      .unwrap()
      .items[0]
      .id,
    "current"
  );
  assert!(states[1].response.is_none());
}

#[tokio::test]
async fn hyper_search_scope_cancels_a_blocked_sink_without_releasing_it() {
  let workspace = Uuid::new_v4();
  let (manager, mut requests) = manager();
  let owner = manager.begin_context(1, &workspace);
  manager.on_launch_if_authenticated(owner, None).await;
  let sink = Sink::new(true);
  let task = search(&manager, &sink, 10, "blocked");
  let (_, reply) = requests.recv().await.unwrap();
  reply.send(Ok(response("private pending send"))).unwrap();
  sink.polling.notified().await;
  manager.invalidate_context();
  finish(task).await;
  assert!(sink.states().is_empty());
}

#[tokio::test]
async fn hyper_search_scope_new_query_cancels_the_previous_query_in_the_same_context() {
  let workspace = Uuid::new_v4();
  let (manager, mut requests) = manager();
  let owner = manager.begin_context(1, &workspace);
  manager.on_launch_if_authenticated(owner, None).await;
  let previous = Sink::new(false);
  let old = search(&manager, &previous, 10, "old");
  let (_, old_reply) = requests.recv().await.unwrap();
  let current = Sink::new(false);
  let task = search(&manager, &current, 11, "new");
  let (_, reply) = requests.recv().await.unwrap();
  finish(old).await;
  assert!(old_reply.is_closed());
  assert!(previous.states().is_empty());
  drop(reply);
  finish(task).await;
  assert_eq!(current.states()[0].search_id, "11");
}

#[tokio::test]
async fn hyper_search_scope_initialization_gap_and_late_publication_fail_closed() {
  let workspace = Uuid::new_v4();
  let (manager, mut requests) = manager();
  let old = manager.begin_context(1, &workspace);
  manager.on_launch_if_authenticated(old.clone(), None).await;
  let next = manager.begin_context(2, &workspace);
  assert_eq!(manager.owner_for_workspace(&workspace).unwrap().uid(), 2);
  assert!(manager.index_state(&next).is_none());
  let sink = Sink::new(false);
  manager
    .perform_search_with_sink("gap".into(), sink.clone(), 1)
    .await;
  assert!(sink.states().is_empty());
  assert!(requests.try_recv().is_err());
  manager.initialize_after_sign_in(old, None).await;
  assert!(manager.get_handler(SearchType::Folder).is_none());
  manager.initialize_after_sign_in(next, None).await;
  assert!(manager.get_handler(SearchType::Folder).is_some());
}

#[tokio::test]
async fn hyper_search_scope_pending_startup_is_canceled_by_an_aba_owner_change() {
  let workspace = Uuid::new_v4();
  let (manager, _) = manager();
  let first = manager.begin_context(1, &workspace);
  let waiting = first.clone();
  let ready = tokio::spawn(async move { waiting.wait_ready().await });
  manager.begin_context(2, &workspace);
  let current = manager.begin_context(1, &workspace);
  assert!(!first.is_current());
  assert!(current.is_current());
  assert!(
    !tokio::time::timeout(Duration::from_secs(2), ready)
      .await
      .unwrap()
      .unwrap()
  );
  manager
    .initialize_after_sign_in(current.clone(), None)
    .await;
  assert!(current.wait_ready().await);
  manager.close_workspace(&Uuid::new_v4());
  assert!(current.is_current());
  manager.close_workspace(&workspace);
  assert!(!current.is_current());
}

struct IndexFixture {
  path: std::path::PathBuf,
  workspace: Uuid,
}
impl IndexFixture {
  fn new() -> Self {
    let workspace = Uuid::new_v4();
    let path = std::env::temp_dir().join(format!("hyper-search-context-{workspace}"));
    Self { path, workspace }
  }
  fn state(&self) -> Arc<RwLock<DocumentTantivyState>> {
    get_or_init_document_tantivy_state(self.workspace, self.path.clone()).unwrap()
  }
}
impl Drop for IndexFixture {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.path);
  }
}

#[tokio::test]
async fn hyper_search_scope_context_retains_the_index_and_none_never_keeps_the_old_handler() {
  let fixture = IndexFixture::new();
  let (manager, _) = manager();
  let state = fixture.state();
  let weak = Arc::downgrade(&state);
  let first = manager.begin_context(1, &fixture.workspace);
  manager
    .on_launch_if_authenticated(first.clone(), Some(state))
    .await;
  assert!(weak.upgrade().is_some());
  assert!(manager.get_handler(SearchType::DocumentLocal).is_some());
  let second = manager.begin_context(2, &fixture.workspace);
  manager.initialize_after_sign_in(second, None).await;
  assert!(weak.upgrade().is_none());
  assert!(manager.get_handler(SearchType::DocumentLocal).is_none());
  assert!(manager.index_state(&first).is_none());
}

#[tokio::test]
async fn hyper_search_scope_reinit_shares_a_draining_physical_writer_without_dropping_the_new_context()
 {
  let fixture = IndexFixture::new();
  let (manager, mut requests) = manager();
  let state = fixture.state();
  let first = manager.begin_context(1, &fixture.workspace);
  manager
    .on_launch_if_authenticated(first, Some(state.clone()))
    .await;
  let sink = Sink::new(true);
  let task = search(&manager, &sink, 10, "draining");
  let (_, reply) = requests.recv().await.unwrap();
  reply.send(Ok(response("pending"))).unwrap();
  sink.polling.notified().await;
  let second = manager.begin_context(1, &fixture.workspace);
  let shared = fixture.state();
  assert!(Arc::ptr_eq(&state, &shared));
  manager
    .initialize_after_sign_in(second.clone(), Some(shared))
    .await;
  drop(state);
  finish(task).await;
  let retained = manager.index_state(&second).unwrap().upgrade().unwrap();
  let cached = fixture.state();
  assert!(Arc::ptr_eq(&retained, &cached));
}

struct CreatingHandler {
  started: Arc<Notify>,
  release: Arc<Notify>,
}
#[async_trait]
impl SearchHandler for CreatingHandler {
  fn search_type(&self) -> SearchType {
    SearchType::Folder
  }
  async fn perform_search(
    &self,
    _: String,
    _: &Uuid,
  ) -> Pin<Box<dyn Stream<Item = FlowyResult<SearchResponsePB>> + Send>> {
    self.started.notify_one();
    self.release.notified().await;
    Box::pin(tokio_stream::empty())
  }
}
#[tokio::test]
async fn hyper_search_scope_close_cancels_handler_creation_before_any_stream_exists() {
  let started = Arc::new(Notify::new());
  let manager = Arc::new(SearchManager::new(vec![Arc::new(CreatingHandler {
    started: started.clone(),
    release: Arc::new(Notify::new()),
  })]));
  let workspace = Uuid::new_v4();
  let owner = manager.begin_context(1, &workspace);
  manager.on_launch_if_authenticated(owner, None).await;
  let sink = Sink::new(false);
  let task = search(&manager, &sink, 1, "pending creation");
  started.notified().await;
  manager.invalidate_context();
  finish(task).await;
  assert!(sink.states().is_empty());
}

#[derive(Clone)]
struct ReadyChangeSink {
  sink: Sink,
  change: Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>,
}
impl futures::Sink<Vec<u8>> for ReadyChangeSink {
  type Error = std::io::Error;
  fn poll_ready(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
    let this = self.get_mut();
    let change = this.change.lock().unwrap().take();
    if let Some(change) = change {
      change();
    }
    Pin::new(&mut this.sink).poll_ready(cx)
  }
  fn start_send(self: Pin<&mut Self>, value: Vec<u8>) -> Result<(), Self::Error> {
    Pin::new(&mut self.get_mut().sink).start_send(value)
  }
  fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
    Pin::new(&mut self.get_mut().sink).poll_flush(cx)
  }
  fn poll_close(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
    Pin::new(&mut self.get_mut().sink).poll_close(cx)
  }
}

#[tokio::test]
async fn hyper_search_scope_rechecks_owner_after_sink_readiness_before_accepting_packets() {
  for query in ["", "payload"] {
    let workspace = Uuid::new_v4();
    let (manager, mut requests) = manager();
    let owner = manager.begin_context(1, &workspace);
    manager.on_launch_if_authenticated(owner, None).await;
    let packets = Sink::new(false);
    let changing = manager.clone();
    let sink = ReadyChangeSink {
      sink: packets.clone(),
      change: Arc::new(Mutex::new(Some(Box::new(move || {
        changing.begin_context(2, &workspace);
      })))),
    };
    if query.is_empty() {
      manager
        .perform_search_with_sink(query.into(), sink, 1)
        .await;
    } else {
      let searching = manager.clone();
      let task = tokio::spawn(async move {
        searching
          .perform_search_with_sink("payload".into(), sink, 1)
          .await;
      });
      let (_, reply) = requests.recv().await.unwrap();
      reply.send(Ok(response("private payload"))).unwrap();
      drop(reply);
      finish(task).await;
    }
    assert!(
      packets.states().is_empty(),
      "The owner changed during readiness, but an old result/completion packet was accepted"
    );
  }
}
