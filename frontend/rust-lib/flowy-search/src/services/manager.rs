use crate::document::local_search_handler::DocumentLocalSearchHandler;
use crate::entities::{SearchResponsePB, SearchStatePB};
use arc_swap::ArcSwapOption;
use flowy_error::FlowyResult;
use flowy_search_pub::tantivy_state::DocumentTantivyState;
use flowy_search_pub::tantivy_state_init::close_document_tantivy_state;
use futures::Sink;
use lib_infra::async_trait::async_trait;
use lib_infra::hyper_stream::HyperStreamSink;
use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex, Weak};
use tokio::sync::{RwLock, watch};
use tokio_stream::{Stream, StreamExt};
use tracing::{error, info};
use uuid::Uuid;

#[path = "hyper_context.rs"]
mod hyper_context;
pub use hyper_context::HyperSearchOwner;
use hyper_context::HyperSearchRequest;

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub enum SearchType {
  Folder,
  DocumentCloud,
  DocumentLocal,
}

#[async_trait]
pub trait SearchHandler: Send + Sync + 'static {
  fn search_type(&self) -> SearchType;
  async fn perform_search(
    &self,
    query: String,
    workspace_id: &Uuid,
  ) -> Pin<Box<dyn Stream<Item = FlowyResult<SearchResponsePB>> + Send + 'static>>;
}

struct HyperSearchContext {
  owner: HyperSearchOwner,
  index: Option<Arc<RwLock<DocumentTantivyState>>>,
  handlers: HashMap<SearchType, Arc<dyn SearchHandler>>,
  searches: watch::Sender<Option<i64>>,
}

/// A search captures one immutable workspace/index/handler context. Initialization
/// invalidates it before any folder or account state can be replaced.
pub struct SearchManager {
  base_handlers: HashMap<SearchType, Arc<dyn SearchHandler>>,
  context: ArcSwapOption<HyperSearchContext>,
  lifecycle: Mutex<Option<HyperSearchOwner>>,
  generations: watch::Sender<u64>,
}

impl SearchManager {
  pub fn new(handlers: Vec<Arc<dyn SearchHandler>>) -> Self {
    let (generations, _) = watch::channel(0);
    Self {
      base_handlers: handlers
        .into_iter()
        .map(|handler| (handler.search_type(), handler))
        .collect(),
      context: Default::default(),
      lifecycle: Mutex::new(None),
      generations,
    }
  }

  pub fn begin_context(&self, uid: i64, workspace_id: &Uuid) -> HyperSearchOwner {
    let mut lifecycle = self
      .lifecycle
      .lock()
      .unwrap_or_else(|error| error.into_inner());
    let generation = self.generations.borrow().wrapping_add(1);
    self.generations.send_replace(generation);
    let previous = self.context.swap(None);
    let owner = HyperSearchOwner::new(uid, *workspace_id, generation, self.generations.clone());
    *lifecycle = Some(owner.clone());
    drop(lifecycle);
    Self::release_context(previous);
    owner
  }

  pub fn invalidate_context(&self) {
    self.invalidate_matching(None);
  }

  pub fn close_workspace(&self, workspace_id: &Uuid) {
    self.invalidate_matching(Some(workspace_id));
  }

  fn invalidate_matching(&self, workspace_id: Option<&Uuid>) {
    let mut lifecycle = self
      .lifecycle
      .lock()
      .unwrap_or_else(|error| error.into_inner());
    if let Some(expected) = workspace_id {
      if lifecycle
        .as_ref()
        .is_none_or(|owner| owner.workspace_id() != *expected)
      {
        return;
      }
    }
    let generation = self.generations.borrow().wrapping_add(1);
    self.generations.send_replace(generation);
    *lifecycle = None;
    let previous = self.context.swap(None);
    drop(lifecycle);
    Self::release_context(previous);
  }

  fn release_context(previous: Option<Arc<HyperSearchContext>>) {
    if let Some(context) = previous {
      let workspace_id = context.owner.workspace_id();
      let index = context.index.as_ref().map(Arc::downgrade);
      drop(context);
      if let Some(index) = index {
        close_document_tantivy_state(&workspace_id, &index);
      }
    }
  }

  pub fn get_handler(&self, search_type: SearchType) -> Option<Arc<dyn SearchHandler>> {
    let context = self.context.load_full()?;
    if !context.owner.is_current() {
      return None;
    }
    context.handlers.get(&search_type).cloned()
  }

  pub fn owner_for_workspace(&self, workspace_id: &Uuid) -> Option<HyperSearchOwner> {
    // Folder initialization can perform scoped cleanup before an index exists.
    // Search requests still require a fully published immutable context.
    let lifecycle = self
      .lifecycle
      .lock()
      .unwrap_or_else(|error| error.into_inner());
    lifecycle
      .as_ref()
      .filter(|owner| owner.is_current() && owner.workspace_id() == *workspace_id)
      .cloned()
  }

  pub fn index_state(
    &self,
    owner: &HyperSearchOwner,
  ) -> Option<Weak<RwLock<DocumentTantivyState>>> {
    let context = self.context.load_full()?;
    if !owner.is_current() || !context.owner.same(owner) {
      return None;
    }
    context.index.as_ref().map(Arc::downgrade)
  }

  async fn publish_context(
    &self,
    owner: HyperSearchOwner,
    index: Option<Arc<RwLock<DocumentTantivyState>>>,
  ) {
    if !owner.belongs_to(&self.generations) || !owner.is_current() {
      return;
    }
    let index = if let Some(index) = index {
      let matches = owner
        .run_if_current(async { index.read().await.workspace_id == owner.workspace_id() })
        .await;
      match matches {
        Some(true) => Some(index),
        Some(false) => None,
        None => return,
      }
    } else {
      None
    };
    let lifecycle = self
      .lifecycle
      .lock()
      .unwrap_or_else(|error| error.into_inner());
    if !owner.is_current()
      || lifecycle
        .as_ref()
        .is_none_or(|current| !current.same(&owner))
    {
      return;
    }
    let mut handlers = self.base_handlers.clone();
    handlers.remove(&SearchType::DocumentLocal);
    if let Some(index) = &index {
      handlers.insert(
        SearchType::DocumentLocal,
        Arc::new(DocumentLocalSearchHandler::new(Arc::downgrade(index))),
      );
    } else {
      error!("[Tantivy] No local index for the current search owner");
    }
    let (searches, _) = watch::channel(None);
    self.context.store(Some(Arc::new(HyperSearchContext {
      owner: owner.clone(),
      index,
      handlers,
      searches,
    })));
    owner.mark_ready();
  }

  pub async fn on_launch_if_authenticated(
    &self,
    owner: HyperSearchOwner,
    state: Option<Arc<RwLock<DocumentTantivyState>>>,
  ) {
    self.publish_context(owner, state).await;
  }
  pub async fn initialize_after_sign_in(
    &self,
    owner: HyperSearchOwner,
    state: Option<Arc<RwLock<DocumentTantivyState>>>,
  ) {
    self.publish_context(owner, state).await;
  }
  pub async fn initialize_after_sign_up(
    &self,
    owner: HyperSearchOwner,
    state: Option<Arc<RwLock<DocumentTantivyState>>>,
  ) {
    self.publish_context(owner, state).await;
  }
  pub async fn initialize_after_open_workspace(
    &self,
    owner: HyperSearchOwner,
    state: Option<Arc<RwLock<DocumentTantivyState>>>,
  ) {
    self.publish_context(owner, state).await;
  }

  pub async fn perform_search(&self, query: String, stream_port: i64, search_id: i64) {
    self
      .perform_search_with_sink(query, HyperStreamSink::new(stream_port), search_id)
      .await;
  }

  pub async fn perform_search_with_sink<S>(&self, query: String, mut sink: S, search_id: i64)
  where
    S: Sink<Vec<u8>> + Clone + Send + Unpin + 'static,
    S::Error: std::fmt::Display,
  {
    let Some(context) = self.context.load_full() else {
      return;
    };
    let Some(request) =
      HyperSearchRequest::new(context.owner.clone(), search_id, context.searches.clone())
    else {
      return;
    };
    let request = Arc::new(request);
    info!("[Search] perform search: {}", query);
    if query.is_empty() {
      let response = SearchStatePB {
        response: None,
        search_id: search_id.to_string(),
      };
      if let Ok::<Vec<u8>, _>(data) = response.try_into() {
        let _ = request.send(&mut sink, data).await;
      }
      return;
    }
    let mut tasks = Vec::new();
    for handler in context.handlers.values().cloned() {
      let request = request.clone();
      let context = context.clone();
      let query = query.clone();
      let mut sink = sink.clone();
      tasks.push(tokio::spawn(async move {
        let workspace_id = context.owner.workspace_id();
        let Some(mut stream) = request
          .run(handler.perform_search(query, &workspace_id))
          .await
        else {
          return;
        };
        loop {
          let Some(next) = request.run(stream.next()).await else {
            return;
          };
          let response = match next {
            Some(Ok(response)) => response,
            Some(Err(error)) => {
              error!("[Search] Handler failed: {}", error);
              break;
            },
            None => break,
          };
          let response = SearchStatePB {
            response: Some(response),
            search_id: search_id.to_string(),
          };
          if let Ok::<Vec<u8>, _>(data) = response.try_into() {
            match request.send(&mut sink, data).await {
              Some(Ok(())) => {},
              Some(Err(error)) => {
                error!("[Search] Result delivery failed: {}", error);
                break;
              },
              None => return,
            }
          }
        }
        let response = SearchStatePB {
          response: None,
          search_id: search_id.to_string(),
        };
        if let Ok::<Vec<u8>, _>(data) = response.try_into() {
          let _ = request.send(&mut sink, data).await;
        }
      }));
    }
    futures::future::join_all(tasks).await;
  }
}

impl Drop for SearchManager {
  fn drop(&mut self) {
    self.invalidate_context();
  }
}

#[cfg(test)]
#[path = "hyper_context_tests.rs"]
mod hyper_context_tests;
