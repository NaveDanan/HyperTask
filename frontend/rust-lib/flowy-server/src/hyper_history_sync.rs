//! Route native document history through the existing cloud sync plugin.
//!
//! Yrs uses the undo manager's own binary origin for Undo/Redo transactions. The pinned
//! Collab observer cannot decode it as a client origin, although it still persists the
//! update locally. Match only this document's manager, then use the existing client
//! origin on the wire. Remote and unknown origins keep their existing behavior.

use arc_swap::ArcSwapOption;
use collab::core::awareness::{AwarenessUpdate, Event};
use collab::core::collab_plugin::{CollabPlugin, CollabPluginType};
use collab::core::origin::CollabOrigin;
use collab::preclude::{Collab, Doc, Origin, TransactionMut};
use std::sync::Arc;

struct HyperHistoryIdentity {
  object_id: String,
  client_origin: CollabOrigin,
  undo_origin: Origin,
}

/// Decorates the document cloud plugin without changing dependency code or origins.
/// Document construction enables its undo manager before plugin initialization.
pub struct HyperHistorySyncPlugin {
  inner: Box<dyn CollabPlugin>,
  identity: ArcSwapOption<HyperHistoryIdentity>,
}

impl HyperHistorySyncPlugin {
  pub fn new(inner: Box<dyn CollabPlugin>) -> Self {
    Self {
      inner,
      identity: ArcSwapOption::empty(),
    }
  }
}

impl CollabPlugin for HyperHistorySyncPlugin {
  fn init(&self, object_id: &str, origin: &CollabOrigin, doc: &Doc) {
    self.identity.store(None);
    self.inner.init(object_id, origin, doc);
  }

  fn did_init(&self, collab: &Collab, object_id: &str) {
    let identity = match (collab.origin(), collab.undo_manager()) {
      (client_origin @ CollabOrigin::Client(_), Ok(manager)) if collab.object_id() == object_id => {
        Some(Arc::new(HyperHistoryIdentity {
          object_id: object_id.to_owned(),
          client_origin: client_origin.clone(),
          undo_origin: manager.as_origin(),
        }))
      },
      _ => None,
    };
    self.identity.store(identity);
    self.inner.did_init(collab, object_id);
  }

  fn receive_update(&self, object_id: &str, txn: &TransactionMut, update: &[u8]) {
    self.inner.receive_update(object_id, txn, update);
    if let Some(identity) = self.identity.load_full() {
      if identity.object_id == object_id
        && txn.origin() == Some(&identity.undo_origin)
        // Ordinary client transactions are already sent by Collab's local callback.
        && CollabOrigin::from(txn) != identity.client_origin
      {
        self
          .inner
          .receive_local_update(&identity.client_origin, object_id, update);
      }
    }
  }

  fn receive_local_update(&self, origin: &CollabOrigin, object_id: &str, update: &[u8]) {
    self.inner.receive_local_update(origin, object_id, update);
  }

  fn receive_local_state(
    &self,
    origin: &CollabOrigin,
    object_id: &str,
    event: &Event,
    update: &AwarenessUpdate,
  ) {
    self
      .inner
      .receive_local_state(origin, object_id, event, update);
  }

  fn after_transaction(&self, object_id: &str, txn: &mut TransactionMut) {
    self.inner.after_transaction(object_id, txn);
  }

  fn plugin_type(&self) -> CollabPluginType {
    self.inner.plugin_type()
  }

  fn start_init_sync(&self) {
    self.inner.start_init_sync();
  }

  fn destroy(&self) {
    self.identity.store(None);
    self.inner.destroy();
  }
}

#[cfg(test)]
#[path = "hyper_history_sync_tests.rs"]
mod tests;
