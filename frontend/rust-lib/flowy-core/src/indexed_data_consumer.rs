use crate::folder_view_observer::FolderViewObserverImpl;
use crate::full_indexed_data_provider::FullIndexedDataConsumer;
use collab_entity::CollabType;
use collab_folder::folder_diff::FolderViewChange;
use collab_folder::{IconType, View, ViewIcon};
use collab_integrate::instant_indexed_data_provider::InstantIndexedDataConsumer;
use dashmap::DashMap;
use flowy_ai_pub::entities::{UnindexedCollab, UnindexedCollabMetadata, UnindexedData};
use flowy_error::{FlowyError, FlowyResult};
use flowy_folder::manager::FolderManager;
use flowy_search::services::manager::HyperSearchOwner;
use flowy_search_pub::entities::FolderViewObserver;
use flowy_search_pub::tantivy_state::DocumentTantivyState;
use flowy_server::af_cloud::define::LoggedUser;
use lib_infra::async_trait::async_trait;
use std::sync::{Arc, Weak};
use tokio::sync::RwLock;
use tracing::error;
use uuid::Uuid;

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub struct EmbeddingFullIndexConsumer(pub HyperSearchOwner);

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
#[async_trait]
impl FullIndexedDataConsumer for EmbeddingFullIndexConsumer {
  fn consumer_id(&self) -> String {
    "embedding_full_index_consumer".into()
  }
  async fn consume_indexed_data(&self, uid: i64, data: &UnindexedCollab) -> FlowyResult<()> {
    if !self.0.matches(uid, &data.workspace_id)
      || !matches!(data.collab_type, CollabType::Document)
      || data.data.as_ref().is_none_or(|data| data.is_empty())
    {
      return Ok(());
    }
    let scheduler = flowy_ai::embeddings::context::EmbedContext::shared().get_scheduler()?;
    if let Some(result) = self
      .0
      .run_if_current(scheduler.index_collab(data.clone()))
      .await
    {
      result?;
    }
    Ok(())
  }
}

pub struct EmbeddingsInstantConsumerImpl {
  consume_history: DashMap<Uuid, String>,
  owner: HyperSearchOwner,
}
impl EmbeddingsInstantConsumerImpl {
  pub fn new(owner: HyperSearchOwner) -> Self {
    Self {
      consume_history: Default::default(),
      owner,
    }
  }
}
#[async_trait]
impl InstantIndexedDataConsumer for EmbeddingsInstantConsumerImpl {
  fn consumer_id(&self) -> String {
    "embedding_instant_index_consumer".into()
  }
  async fn consume_collab(
    &self,
    workspace_id: &Uuid,
    data: Option<UnindexedData>,
    object_id: &Uuid,
    collab_type: CollabType,
  ) -> FlowyResult<bool> {
    if !self.owner.matches(self.owner.uid(), workspace_id) {
      return Ok(false);
    }
    let Some(data) = data.filter(|data| !data.is_empty()) else {
      return Ok(false);
    };
    let hash = data.content_hash();
    if self
      .consume_history
      .get(object_id)
      .is_some_and(|value| value.value() == &hash)
    {
      return Ok(false);
    }
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
      if let Ok(scheduler) = flowy_ai::embeddings::context::EmbedContext::shared().get_scheduler() {
        let indexed = UnindexedCollab {
          workspace_id: *workspace_id,
          object_id: *object_id,
          collab_type,
          data: Some(data),
          metadata: UnindexedCollabMetadata::default(),
        };
        let Some(result) = self
          .owner
          .run_if_current(scheduler.index_collab(indexed))
          .await
        else {
          return Ok(false);
        };
        result?;
      }
    }
    if !self.owner.is_current() {
      return Ok(false);
    }
    self.consume_history.insert(*object_id, hash);
    Ok(true)
  }
  async fn did_delete_collab(&self, workspace_id: &Uuid, object_id: &Uuid) -> FlowyResult<()> {
    if !self.owner.matches(self.owner.uid(), workspace_id) {
      return Ok(());
    }
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
      if let Ok(scheduler) = flowy_ai::embeddings::context::EmbedContext::shared().get_scheduler() {
        if let Some(result) = self
          .owner
          .run_if_current(scheduler.delete_collab(workspace_id, object_id))
          .await
        {
          result?;
        }
      }
    }
    Ok(())
  }
}

pub struct SearchFullIndexConsumer {
  owner: HyperSearchOwner,
  state: Weak<RwLock<DocumentTantivyState>>,
}
impl SearchFullIndexConsumer {
  pub fn new(owner: HyperSearchOwner, state: Weak<RwLock<DocumentTantivyState>>) -> Self {
    Self { owner, state }
  }
}
#[async_trait]
impl FullIndexedDataConsumer for SearchFullIndexConsumer {
  fn consumer_id(&self) -> String {
    "search_full_index_consumer".into()
  }
  async fn consume_indexed_data(&self, uid: i64, data: &UnindexedCollab) -> FlowyResult<()> {
    if !self.owner.matches(uid, &data.workspace_id) {
      return Ok(());
    }
    let Some(state) = self.state.upgrade() else {
      return Ok(());
    };
    let Some(mut state) = self.owner.run_if_current(state.write()).await else {
      return Ok(());
    };
    if !self.owner.matches(uid, &data.workspace_id) {
      return Ok(());
    }
    state.add_document(
      &data.object_id.to_string(),
      data.data.clone().map(|data| data.into_string()),
      data.metadata.name.clone(),
      data.metadata.icon.clone().map(|icon| ViewIcon {
        ty: IconType::from(icon.ty as u8),
        value: icon.value,
      }),
    )?;
    Ok(())
  }
}

pub struct SearchInstantIndexImpl {
  owner: HyperSearchOwner,
  state: Weak<RwLock<DocumentTantivyState>>,
  consume_history: DashMap<Uuid, String>,
  folder_manager: Weak<FolderManager>,
  #[allow(dead_code)]
  folder_observer: FolderViewObserverImpl,
  logged_user: Weak<dyn LoggedUser>,
}
impl SearchInstantIndexImpl {
  pub async fn new(
    owner: HyperSearchOwner,
    state: Weak<RwLock<DocumentTantivyState>>,
    folder_manager: Weak<FolderManager>,
    logged_user: Weak<dyn LoggedUser>,
  ) -> FlowyResult<Self> {
    let folder_observer = FolderViewObserverImpl::new(owner.clone(), state.clone());
    if let Some(folder) = folder_manager.upgrade() {
      if let Some(Ok(rx)) = owner
        .run_if_current(folder.subscribe_folder_change_rx())
        .await
      {
        folder_observer.set_observer_rx(rx).await;
      }
    }
    Ok(Self {
      owner,
      state,
      consume_history: Default::default(),
      folder_manager,
      folder_observer,
      logged_user,
    })
  }

  fn source_current(&self) -> bool {
    self.owner.is_current()
      && self.logged_user.upgrade().is_some_and(|user| {
        user.user_id().ok() == Some(self.owner.uid())
          && user.workspace_id().ok() == Some(self.owner.workspace_id())
      })
  }

  pub fn refresh_search_index(&self) {
    let owner = self.owner.clone();
    let guard = owner.clone();
    let state = self.state.clone();
    let folder = self.folder_manager.clone();
    let user = self.logged_user.clone();
    tokio::spawn(async move {
      let operation = async {
        if !user.upgrade().is_some_and(|user| {
          user.user_id().ok() == Some(owner.uid())
            && user.workspace_id().ok() == Some(owner.workspace_id())
        }) {
          return Ok(());
        }
        let (Some(folder), Some(state)) = (folder.upgrade(), state.upgrade()) else {
          return Ok(());
        };
        let changes = folder.consumer_recent_workspace_changes().await?;
        let views = index_views_from_folder(&folder)
          .await?
          .into_iter()
          .map(|view| (view.id.clone(), view))
          .collect::<std::collections::HashMap<_, _>>();
        for change in changes {
          let mut state = state.write().await;
          if !owner.is_current() {
            return Ok(());
          }
          match change {
            FolderViewChange::Inserted { view_id } | FolderViewChange::Updated { view_id } => {
              if let Some(view) = views.get(&view_id) {
                state.add_document_metadata(
                  &view.id,
                  Some(view.name.clone()),
                  view.icon.clone().map(|icon| ViewIcon {
                    ty: IconType::from(icon.ty as u8),
                    value: icon.value,
                  }),
                )?;
              }
            },
            FolderViewChange::Deleted { view_ids } => state
              .delete_documents(&view_ids.iter().map(ToString::to_string).collect::<Vec<_>>())?,
          }
        }
        Ok::<_, FlowyError>(())
      };
      if let Some(Err(error)) = guard.run_if_current(operation).await {
        error!("[Indexing] Metadata refresh failed: {}", error);
      }
    });
  }
}
#[async_trait]
impl InstantIndexedDataConsumer for SearchInstantIndexImpl {
  fn consumer_id(&self) -> String {
    "search_instant_index_consumer".into()
  }
  async fn consume_collab(
    &self,
    workspace_id: &Uuid,
    data: Option<UnindexedData>,
    object_id: &Uuid,
    _collab_type: CollabType,
  ) -> FlowyResult<bool> {
    if !self.source_current() || self.owner.workspace_id() != *workspace_id {
      return Ok(false);
    }
    let Some(state) = self.state.upgrade() else {
      return Ok(false);
    };
    let folder = self
      .folder_manager
      .upgrade()
      .ok_or_else(FlowyError::ref_drop)?;
    let Some(view) = self
      .owner
      .run_if_current(folder.get_view(&object_id.to_string()))
      .await
    else {
      return Ok(false);
    };
    let view = view?;
    if !self.source_current() {
      return Ok(false);
    }
    let content_hash = data
      .as_ref()
      .map_or_else(String::new, |data| data.content_hash());
    let name_hash = format!("{}:{}", content_hash, view.name);
    let hash = view.icon.as_ref().map_or_else(
      || name_hash.clone(),
      |icon| format!("{}:{}:{}", name_hash, icon.ty.clone() as u8, icon.value),
    );
    if self
      .consume_history
      .get(object_id)
      .is_some_and(|value| value.value() == &hash)
    {
      return Ok(false);
    }
    let Some(mut state) = self.owner.run_if_current(state.write()).await else {
      return Ok(false);
    };
    if !self.source_current() {
      return Ok(false);
    }
    state.add_document(
      &object_id.to_string(),
      data.map(|data| data.into_string()),
      Some(view.name.clone()),
      view.icon.clone().map(|icon| ViewIcon {
        ty: IconType::from(icon.ty as u8),
        value: icon.value,
      }),
    )?;
    self.consume_history.insert(*object_id, hash);
    Ok(true)
  }
  async fn did_delete_collab(&self, workspace_id: &Uuid, object_id: &Uuid) -> FlowyResult<()> {
    if !self.source_current() || self.owner.workspace_id() != *workspace_id {
      return Ok(());
    }
    let Some(state) = self.state.upgrade() else {
      return Ok(());
    };
    let Some(mut state) = self.owner.run_if_current(state.write()).await else {
      return Ok(());
    };
    if self.source_current() {
      state.delete_document(&object_id.to_string())?;
    }
    Ok(())
  }
}

pub(crate) async fn index_views_from_folder(
  folder_manager: &FolderManager,
) -> FlowyResult<Vec<Arc<View>>> {
  Ok(
    folder_manager
      .get_all_views()
      .await?
      .into_iter()
      .filter(|v| v.space_info().is_none() && v.layout.is_document())
      .collect::<Vec<_>>(),
  )
}

#[cfg(test)]
#[path = "hyper_index_consumers_tests.rs"]
mod hyper_index_consumers_tests;
