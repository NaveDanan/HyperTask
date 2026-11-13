use collab::core::collab::DataSource;
use collab::core::origin::CollabOrigin;
use collab::entity::EncodedCollab;
use collab::lock::RwLock;
use collab::preclude::{Collab, Transact};
use collab_document::document::DocumentBody;
use collab_entity::{CollabObject, CollabType};
use flowy_ai_pub::entities::{UnindexedCollab, UnindexedCollabMetadata, UnindexedData};
use flowy_error::{FlowyError, FlowyResult};
use lib_infra::async_trait::async_trait;
use std::borrow::BorrowMut;
use std::collections::HashMap;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::runtime::Runtime;
use tokio::time::interval;
use tracing::{error, info, trace};
use uuid::Uuid;

#[derive(Clone, Eq, PartialEq)]
struct HyperIndexOwner {
  uid: i64,
  workspace_id: Uuid,
  revision: u64,
}
type HyperIndexOwnerState = tokio::sync::watch::Sender<Option<HyperIndexOwner>>;

fn hyper_owner_snapshot(owner: &HyperIndexOwnerState) -> Option<HyperIndexOwner> {
  owner.borrow().clone()
}
fn hyper_owner_current(owner: &HyperIndexOwnerState, expected: &Option<HyperIndexOwner>) -> bool {
  hyper_owner_snapshot(owner) == *expected
}
async fn hyper_owner_run<F: std::future::Future>(
  owner: &HyperIndexOwnerState,
  expected: &Option<HyperIndexOwner>,
  operation: F,
) -> Option<F::Output> {
  let mut changed = owner.subscribe();
  if !hyper_owner_current(owner, expected) {
    return None;
  }
  tokio::select! {
    biased;
    _ = changed.changed() => None,
    value = operation => hyper_owner_current(owner, expected).then_some(value),
  }
}

pub struct WriteObject {
  pub collab_object: CollabObject,
  pub collab: Weak<dyn CollabIndexedData>,
}

pub struct InstantIndexedDataWriter {
  collab_by_object: Arc<RwLock<HashMap<String, WriteObject>>>,
  consumers: Arc<RwLock<Vec<Box<dyn InstantIndexedDataConsumer>>>>,
  owner: HyperIndexOwnerState,
}

impl Default for InstantIndexedDataWriter {
  fn default() -> Self {
    Self::new()
  }
}

impl InstantIndexedDataWriter {
  pub fn new() -> InstantIndexedDataWriter {
    let collab_by_object = Arc::new(RwLock::new(HashMap::<String, WriteObject>::new()));
    let consumers = Arc::new(RwLock::new(
      Vec::<Box<dyn InstantIndexedDataConsumer>>::new(),
    ));

    InstantIndexedDataWriter {
      collab_by_object,
      consumers,
      owner: tokio::sync::watch::channel(None).0,
    }
  }

  pub async fn num_consumers(&self) -> usize {
    let consumers = self.consumers.read().await;
    consumers.len()
  }

  pub async fn clear_consumers(&self) {
    let owner = hyper_owner_snapshot(&self.owner);
    let mut consumers = self.consumers.write().await;
    if !hyper_owner_current(&self.owner, &owner) {
      return;
    }
    consumers.clear();
    info!("[Indexing] Cleared all instant index consumers");
  }

  pub async fn register_consumer(&self, consumer: Box<dyn InstantIndexedDataConsumer>) {
    self.register_consumer_when(consumer, || true).await;
  }

  pub async fn register_consumer_when(
    &self,
    consumer: Box<dyn InstantIndexedDataConsumer>,
    is_current: impl Fn() -> bool,
  ) {
    let owner = hyper_owner_snapshot(&self.owner);
    info!(
      "[Indexing] Registering instant index consumer: {}",
      consumer.consumer_id()
    );
    let mut guard = self.consumers.write().await;
    if !is_current() || !hyper_owner_current(&self.owner, &owner) {
      return;
    }
    guard.push(consumer);
  }

  /// Change only derived indexing state; documents and persistence are untouched.
  pub async fn activate_owner(&self, uid: i64, workspace_id: Uuid, is_current: impl Fn() -> bool) {
    let mut expected = None;
    self.owner.send_if_modified(|owner| {
      if !is_current() {
        return false;
      }
      let revision = owner
        .as_ref()
        .map_or(1, |value| value.revision.wrapping_add(1));
      let next = HyperIndexOwner {
        uid,
        workspace_id,
        revision,
      };
      *owner = Some(next.clone());
      expected = Some(next);
      true
    });
    if expected.is_none() {
      return;
    }
    let mut queued = self.collab_by_object.write().await;
    if !hyper_owner_current(&self.owner, &expected) {
      return;
    }
    queued.clear();
    drop(queued);
    let mut consumers = self.consumers.write().await;
    if hyper_owner_current(&self.owner, &expected) {
      consumers.clear();
    }
  }

  pub async fn spawn_instant_indexed_provider(&self, runtime: &Runtime) -> FlowyResult<()> {
    let weak_objects = Arc::downgrade(&self.collab_by_object);
    let weak_consumers = Arc::downgrade(&self.consumers);
    let owner = self.owner.clone();
    let expected = hyper_owner_snapshot(&owner);
    runtime.spawn(async move {
      if !hyper_owner_current(&owner, &expected) {
        return;
      }
      let mut ticker = interval(Duration::from_secs(30));
      ticker.tick().await;
      let mut changed = owner.subscribe();
      if !hyper_owner_current(&owner, &expected) {
        return;
      }
      loop {
        tokio::select! { biased; _ = changed.changed() => break, _ = ticker.tick() => {} }
        if !hyper_owner_current(&owner, &expected) {
          break;
        }
        let (Some(objects), Some(consumers)) = (weak_objects.upgrade(), weak_consumers.upgrade())
        else {
          break;
        };
        let guard = objects.read().await;
        if !hyper_owner_current(&owner, &expected) {
          break;
        }
        let mut expired = Vec::new();
        for (id, object) in guard.iter() {
          if !hyper_consume_write_object(object, &consumers, &owner, &expected).await {
            expired.push((id.clone(), object.collab.clone()));
          }
          if !hyper_owner_current(&owner, &expected) {
            break;
          }
        }
        // Release the read guard before cleanup requests the same lock for writing.
        drop(guard);
        if !expired.is_empty() {
          let mut queued = objects.write().await;
          if !hyper_owner_current(&owner, &expected) {
            break;
          }
          queued.retain(|id, object| {
            !expired.iter().any(|(previous_id, previous)| {
              id == previous_id && Weak::ptr_eq(&object.collab, previous)
            })
          });
        }
      }
      info!("[Indexing] Instant indexed data provider stopped");
    });
    Ok(())
  }

  pub fn support_collab_type(&self, t: &CollabType) -> bool {
    matches!(t, CollabType::Document)
  }

  pub async fn index_encoded_collab(
    &self,
    workspace_id: Uuid,
    object_id: Uuid,
    data: EncodedCollab,
    collab_type: CollabType,
  ) -> FlowyResult<()> {
    match unindexed_collab_from_encoded_collab(workspace_id, object_id, data, collab_type) {
      None => Err(FlowyError::internal().with_context("Failed to create unindexed collab")),
      Some(data) => {
        self.index_unindexed_collab(data).await?;
        Ok(())
      },
    }
  }

  pub async fn index_unindexed_collab(&self, data: UnindexedCollab) -> FlowyResult<()> {
    let owner = hyper_owner_snapshot(&self.owner);
    if owner
      .as_ref()
      .is_some_and(|owner| owner.workspace_id != data.workspace_id)
    {
      return Ok(());
    }
    let consumers_guard = self.consumers.read().await;
    for consumer in consumers_guard.iter() {
      if !hyper_owner_current(&self.owner, &owner) {
        return Ok(());
      }
      let Some(result) = hyper_owner_run(
        &self.owner,
        &owner,
        consumer.consume_collab(
          &data.workspace_id,
          data.data.clone(),
          &data.object_id,
          data.collab_type,
        ),
      )
      .await
      else {
        return Ok(());
      };
      match result {
        Ok(is_indexed) => {
          if is_indexed {
            trace!(
              "[Indexing] {} consumed {}",
              consumer.consumer_id(),
              data.object_id
            );
          }
        },
        Err(err) => {
          error!(
            "Consumer {} failed on {}: {}",
            consumer.consumer_id(),
            data.object_id,
            err
          );
        },
      }
    }
    Ok(())
  }

  pub async fn queue_collab_embed(
    &self,
    collab_object: CollabObject,
    collab: Weak<dyn CollabIndexedData>,
  ) {
    if !self.support_collab_type(&collab_object.collab_type) {
      return;
    }
    let owner = hyper_owner_snapshot(&self.owner);
    if owner.as_ref().is_some_and(|owner| {
      owner.uid != collab_object.uid || owner.workspace_id.to_string() != collab_object.workspace_id
    }) {
      return;
    }
    let mut map = self.collab_by_object.write().await;
    if !hyper_owner_current(&self.owner, &owner) {
      return;
    }
    map.insert(
      collab_object.object_id.clone(),
      WriteObject {
        collab_object,
        collab,
      },
    );
  }
}

#[cfg(test)]
#[path = "hyper_index_owner_tests.rs"]
mod hyper_index_owner_tests;

async fn hyper_consume_write_object(
  object: &WriteObject,
  consumers: &Arc<RwLock<Vec<Box<dyn InstantIndexedDataConsumer>>>>,
  owner: &HyperIndexOwnerState,
  expected: &Option<HyperIndexOwner>,
) -> bool {
  if !hyper_owner_current(owner, expected) {
    return false;
  }
  let Ok(workspace_id) = Uuid::parse_str(&object.collab_object.workspace_id) else {
    return false;
  };
  if expected.as_ref().is_some_and(|owner| {
    owner.uid != object.collab_object.uid || owner.workspace_id != workspace_id
  }) {
    return false;
  }
  let Some(collab) = object.collab.upgrade() else {
    return false;
  };
  let Some(data) = hyper_owner_run(
    owner,
    expected,
    collab.get_unindexed_data(&object.collab_object.collab_type),
  )
  .await
  else {
    return false;
  };
  let Some(consumers) = hyper_owner_run(owner, expected, consumers.read()).await else {
    return false;
  };
  if !hyper_owner_current(owner, expected) {
    return false;
  }
  let Ok(object_id) = Uuid::parse_str(&object.collab_object.object_id) else {
    return false;
  };
  for consumer in consumers.iter() {
    if !hyper_owner_current(owner, expected) {
      return false;
    }
    let Some(result) = hyper_owner_run(
      owner,
      expected,
      consumer.consume_collab(
        &workspace_id,
        data.clone(),
        &object_id,
        object.collab_object.collab_type,
      ),
    )
    .await
    else {
      return false;
    };
    if let Err(error) = result {
      error!(
        "[Indexing] {} failed on {}: {}",
        consumer.consumer_id(),
        object_id,
        error
      );
    }
  }
  true
}

pub fn unindexed_data_form_collab(
  collab: &Collab,
  collab_type: &CollabType,
) -> Option<UnindexedData> {
  match collab_type {
    CollabType::Document => {
      let txn = collab.doc().try_transact().ok()?;
      let doc = DocumentBody::from_collab(collab)?;
      let paras = doc.paragraphs(txn);
      Some(UnindexedData::Paragraphs(paras))
    },
    _ => None,
  }
}

pub fn unindexed_collab_from_encoded_collab(
  workspace_id: Uuid,
  object_id: Uuid,
  encoded_collab: EncodedCollab,
  collab_type: CollabType,
) -> Option<UnindexedCollab> {
  match collab_type {
    CollabType::Document => {
      let collab = Collab::new_with_source(
        CollabOrigin::Empty,
        &object_id.to_string(),
        DataSource::DocStateV1(encoded_collab.doc_state.to_vec()),
        vec![],
        false,
      )
      .ok()?;
      let data = unindexed_data_form_collab(&collab, &collab_type)?;
      Some(UnindexedCollab {
        workspace_id,
        object_id,
        collab_type,
        data: Some(data),
        metadata: UnindexedCollabMetadata::default(), // default means do not update metadata
      })
    },
    _ => None,
  }
}

#[async_trait]
pub trait CollabIndexedData: Send + Sync + 'static {
  async fn get_unindexed_data(&self, collab_type: &CollabType) -> Option<UnindexedData>;
}

#[async_trait]
impl<T> CollabIndexedData for RwLock<T>
where
  T: BorrowMut<Collab> + Send + Sync + 'static,
{
  async fn get_unindexed_data(&self, collab_type: &CollabType) -> Option<UnindexedData> {
    let collab = self.try_read().ok()?;
    unindexed_data_form_collab(collab.borrow(), collab_type)
  }
}

/// writer interface
#[async_trait]
pub trait InstantIndexedDataConsumer: Send + Sync + 'static {
  fn consumer_id(&self) -> String;

  async fn consume_collab(
    &self,
    workspace_id: &Uuid,
    data: Option<UnindexedData>,
    object_id: &Uuid,
    collab_type: CollabType,
  ) -> Result<bool, FlowyError>;

  async fn did_delete_collab(
    &self,
    workspace_id: &Uuid,
    object_id: &Uuid,
  ) -> Result<(), FlowyError>;
}
