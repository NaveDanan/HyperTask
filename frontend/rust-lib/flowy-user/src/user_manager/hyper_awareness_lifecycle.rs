//! Serialize awareness publication with owner changes, without holding a lock across I/O.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use flowy_error::{FlowyError, FlowyResult};
use uuid::Uuid;

#[derive(Default)]
struct State {
  epoch: u64,
  next_load: u64,
  loading: HashMap<Uuid, u64>,
}

#[derive(Default)]
pub(crate) struct HyperAwarenessLifecycle {
  state: Mutex<State>,
}

fn changed() -> FlowyError {
  FlowyError::invalid_data()
    .with_context("The account or workspace changed while loading reminders.")
}

impl HyperAwarenessLifecycle {
  pub(crate) fn begin(&self, clear: impl FnOnce()) -> u64 {
    let mut state = self.state.lock().unwrap();
    state.epoch = state
      .epoch
      .checked_add(1)
      .expect("awareness epoch exhausted");
    state.loading.clear();
    clear();
    state.epoch
  }

  pub(crate) fn epoch(&self) -> u64 {
    self.state.lock().unwrap().epoch
  }

  /// `operation` is synchronous: invalidation cannot pass a successful owner check.
  pub(crate) fn current<T>(
    &self,
    epoch: u64,
    operation: impl FnOnce() -> FlowyResult<T>,
  ) -> FlowyResult<T> {
    let state = self.state.lock().unwrap();
    if state.epoch != epoch {
      return Err(changed());
    }
    operation()
  }

  pub(crate) fn reserve(
    self: &Arc<Self>,
    epoch: u64,
    object_id: Uuid,
  ) -> FlowyResult<HyperAwarenessLoad> {
    let mut state = self.state.lock().unwrap();
    if state.epoch != epoch {
      return Err(changed());
    }
    if state.loading.contains_key(&object_id) {
      return Err(FlowyError::internal().with_context("Reminders are already being loaded."));
    }
    state.next_load = state
      .next_load
      .checked_add(1)
      .expect("awareness load ID exhausted");
    let id = state.next_load;
    state.loading.insert(object_id, id);
    Ok(HyperAwarenessLoad {
      lifecycle: self.clone(),
      epoch,
      object_id,
      id,
    })
  }
}

pub(crate) struct HyperAwarenessLoad {
  lifecycle: Arc<HyperAwarenessLifecycle>,
  epoch: u64,
  object_id: Uuid,
  id: u64,
}

impl HyperAwarenessLoad {
  pub(crate) fn publish<T>(&self, operation: impl FnOnce() -> FlowyResult<T>) -> FlowyResult<T> {
    let mut state = self.lifecycle.state.lock().unwrap();
    if state.epoch != self.epoch || state.loading.get(&self.object_id) != Some(&self.id) {
      return Err(changed());
    }
    let result = operation();
    state.loading.remove(&self.object_id);
    result
  }
}

impl Drop for HyperAwarenessLoad {
  fn drop(&mut self) {
    let mut state = self.lifecycle.state.lock().unwrap();
    // A late old task must not release a newer owner's reservation for the same object.
    if state.epoch == self.epoch && state.loading.get(&self.object_id) == Some(&self.id) {
      state.loading.remove(&self.object_id);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use dashmap::DashMap;
  use std::sync::atomic::{AtomicUsize, Ordering};

  #[test]
  fn hyper_awareness_background_publication_reaches_the_shared_owner_map() {
    let state = Arc::new(HyperAwarenessLifecycle::default());
    let shared = Arc::new(DashMap::new());
    let workspace = Uuid::new_v4();
    let epoch = state.begin(|| shared.clear());
    let load = state.reserve(epoch, workspace).unwrap();
    let worker_map = shared.clone();
    std::thread::spawn(move || {
      load
        .publish(|| {
          worker_map.insert(workspace, "loaded");
          Ok(())
        })
        .unwrap()
    })
    .join()
    .unwrap();
    assert_eq!(*shared.get(&workspace).unwrap(), "loaded");
  }

  #[test]
  fn hyper_awareness_deduplicates_pending_loads_and_allows_retry_after_failure() {
    let state = Arc::new(HyperAwarenessLifecycle::default());
    let object = Uuid::new_v4();
    let epoch = state.epoch();
    let first = state.reserve(epoch, object).unwrap();
    assert!(state.reserve(epoch, object).is_err());
    drop(first);
    let retry = state.reserve(epoch, object).unwrap();
    retry.publish(|| Ok(())).unwrap();
    assert!(state.reserve(epoch, object).is_ok());
  }

  #[test]
  fn hyper_awareness_rejects_stale_aba_publication_and_notifications() {
    let state = Arc::new(HyperAwarenessLifecycle::default());
    let object = Uuid::new_v4();
    let first_a = state.begin(|| {});
    let old = state.reserve(first_a, object).unwrap();
    state.begin(|| {}); // B
    let current_a = state.begin(|| {}); // Same UID/workspace, a different owner lifetime.
    let current = state.reserve(current_a, object).unwrap();
    let notifications = AtomicUsize::new(0);
    assert!(old
      .publish(|| {
        notifications.fetch_add(1, Ordering::SeqCst);
        Ok(())
      })
      .is_err());
    drop(old);
    assert!(state.reserve(current_a, object).is_err());
    current
      .publish(|| {
        notifications.fetch_add(1, Ordering::SeqCst);
        Ok(())
      })
      .unwrap();
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn hyper_awareness_invalidation_clears_published_values_and_blocks_old_mutations() {
    let state = Arc::new(HyperAwarenessLifecycle::default());
    let shared = DashMap::new();
    let object = Uuid::new_v4();
    let epoch = state.begin(|| shared.clear());
    state
      .reserve(epoch, object)
      .unwrap()
      .publish(|| {
        shared.insert(object, "old");
        Ok(())
      })
      .unwrap();
    state.begin(|| shared.clear());
    assert!(shared.is_empty());
    assert!(state
      .current(epoch, || {
        shared.insert(object, "stale");
        Ok(())
      })
      .is_err());
    assert!(shared.is_empty());
  }
}
