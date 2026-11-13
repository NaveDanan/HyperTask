use std::future::{Future, poll_fn};
use std::pin::Pin;
use std::time::Duration;
use tokio::sync::watch;
use uuid::Uuid;

/// One owner initialization, including the interval before its index is ready.
#[derive(Clone)]
pub struct HyperSearchOwner {
  uid: i64,
  workspace_id: Uuid,
  generation: u64,
  generations: watch::Sender<u64>,
  ready: watch::Sender<bool>,
}

impl HyperSearchOwner {
  pub(super) fn new(
    uid: i64,
    workspace_id: Uuid,
    generation: u64,
    generations: watch::Sender<u64>,
  ) -> Self {
    let (ready, _) = watch::channel(false);
    Self {
      uid,
      workspace_id,
      generation,
      generations,
      ready,
    }
  }

  pub fn is_current(&self) -> bool {
    *self.generations.borrow() == self.generation
  }

  pub fn uid(&self) -> i64 {
    self.uid
  }

  pub fn workspace_id(&self) -> Uuid {
    self.workspace_id
  }

  pub fn matches(&self, uid: i64, workspace_id: &Uuid) -> bool {
    self.is_current() && self.uid == uid && self.workspace_id == *workspace_id
  }

  pub(super) fn same(&self, other: &Self) -> bool {
    self.generation == other.generation && self.generations.same_channel(&other.generations)
  }

  pub(super) fn belongs_to(&self, generations: &watch::Sender<u64>) -> bool {
    self.generations.same_channel(generations)
  }

  pub(super) fn mark_ready(&self) {
    self.ready.send_replace(true);
  }

  /// Cancel pending native work as soon as the owner changes, including A → B → A.
  pub async fn run_if_current<F: Future>(&self, operation: F) -> Option<F::Output> {
    let mut changed = self.generations.subscribe();
    if !self.is_current() {
      return None;
    }
    tokio::select! {
      biased;
      _ = changed.changed() => None,
      value = operation => self.is_current().then_some(value),
    }
  }

  /// Indexing may be scheduled before the lifecycle publishes its search context.
  pub async fn wait_ready(&self) -> bool {
    let waiting = async {
      let mut ready = self.ready.subscribe();
      loop {
        if *ready.borrow_and_update() {
          return true;
        }
        if ready.changed().await.is_err() {
          return false;
        }
      }
    };
    matches!(
      tokio::time::timeout(Duration::from_secs(20), self.run_if_current(waiting)).await,
      Ok(Some(true))
    )
  }
}

pub(super) struct HyperSearchRequest {
  pub owner: HyperSearchOwner,
  id: i64,
  searches: watch::Sender<Option<i64>>,
}

impl HyperSearchRequest {
  pub fn new(
    owner: HyperSearchOwner,
    id: i64,
    searches: watch::Sender<Option<i64>>,
  ) -> Option<Self> {
    let mut admitted = false;
    searches.send_if_modified(|current| {
      if !owner.is_current() || current.is_some_and(|value| value > id) {
        return false;
      }
      *current = Some(id);
      admitted = true;
      true
    });
    admitted.then_some(Self {
      owner,
      id,
      searches,
    })
  }

  fn is_current(&self) -> bool {
    self.owner.is_current() && *self.searches.borrow() == Some(self.id)
  }

  pub async fn run<F: Future>(&self, operation: F) -> Option<F::Output> {
    let mut owner_changed = self.owner.generations.subscribe();
    let mut query_changed = self.searches.subscribe();
    if !self.is_current() {
      return None;
    }
    tokio::select! {
      biased;
      _ = owner_changed.changed() => None,
      _ = query_changed.changed() => None,
      value = operation => self.is_current().then_some(value),
    }
  }

  pub async fn send<S: futures::Sink<Vec<u8>> + Unpin>(
    &self,
    sink: &mut S,
    value: Vec<u8>,
  ) -> Option<Result<(), S::Error>> {
    match self
      .run(poll_fn(|cx| Pin::new(&mut *sink).poll_ready(cx)))
      .await?
    {
      Ok(()) => {},
      Err(error) => return Some(Err(error)),
    }
    {
      // Admission takes the query lock before reading the owner generation too.
      // Hold both reads only during synchronous acceptance, never across awaits.
      let query = self.searches.borrow();
      let owner = self.owner.generations.borrow();
      if *query != Some(self.id) || *owner != self.owner.generation {
        return None;
      }
      if let Err(error) = Pin::new(&mut *sink).start_send(value) {
        return Some(Err(error));
      }
    }
    self
      .run(poll_fn(|cx| Pin::new(&mut *sink).poll_flush(cx)))
      .await
  }
}
