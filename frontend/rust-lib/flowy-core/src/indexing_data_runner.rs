use crate::app_life_cycle::AppLifeCycleImpl;
use crate::full_indexed_data_provider::FullIndexedDataWriter;
use crate::indexed_data_consumer::{
  EmbeddingsInstantConsumerImpl, SearchFullIndexConsumer, SearchInstantIndexImpl,
};
use flowy_folder::manager::FolderManager;
use flowy_search::services::manager::HyperSearchOwner;
use flowy_search_pub::tantivy_state::DocumentTantivyState;
use flowy_search_pub::tantivy_state_init::get_or_init_document_tantivy_state;
use flowy_user::services::entities::{UserConfig, UserPaths};
use flowy_user_pub::entities::WorkspaceType;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::timeout;
use tracing::{error, warn};
use uuid::Uuid;

impl AppLifeCycleImpl {
  async fn wait_for_folder_ready(folder_manager: &Weak<FolderManager>) -> bool {
    let mut folder_ready_notify = match folder_manager.upgrade() {
      Some(folder) => folder.subscribe_folder_ready_notifier(),
      None => {
        warn!("[Indexing] No folder manager available, skipping indexed data provider");
        return false;
      },
    };

    // Check if the folder is already ready
    if *folder_ready_notify.borrow() {
      tokio::time::sleep(Duration::from_secs(5)).await;
      return true;
    }

    // Wait for the folder to become ready with timeout
    match timeout(Duration::from_secs(20), folder_ready_notify.changed()).await {
      Err(_) => {
        warn!("[Indexing] Timeout waiting for folder ready");
        false
      },
      Ok(_) => {
        let is_ready = *folder_ready_notify.borrow();
        if is_ready {
          // We don't want to start indexing immediately after the folder is ready
          tokio::time::sleep(Duration::from_secs(5)).await;
        }

        is_ready
      },
    }
  }

  pub(crate) async fn start_instant_indexed_data_provider(
    &self,
    user_id: i64,
    workspace_id: &Uuid,
    workspace_type: &WorkspaceType,
    _user_config: &UserConfig,
    _user_paths: &UserPaths,
    owner: HyperSearchOwner,
  ) {
    if !self.index_owner_current(&owner) || !owner.matches(user_id, workspace_id) {
      return;
    }
    let Some(writer) = self.instant_indexed_data_writer.clone() else {
      return;
    };
    let runtime = self.runtime.clone();
    let folder = self.folder_manager.clone();
    let search = self.search_manager.clone();
    let user = Arc::downgrade(&self.logged_user);
    let local = workspace_type.is_local();
    let gate = owner.clone();
    self.runtime.spawn(async move {
      let operation = async {
        if !Self::wait_for_folder_ready(&folder).await || !owner.wait_ready().await {
          return Ok(());
        }
        if !hyper_index_owner_current(&owner, &user) {
          return Ok(());
        }
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        if local {
          writer
            .register_consumer_when(
              Box::new(EmbeddingsInstantConsumerImpl::new(owner.clone())),
              || owner.is_current(),
            )
            .await;
        }
        if let Some(state) = search
          .upgrade()
          .and_then(|search| search.index_state(&owner))
        {
          let consumer =
            SearchInstantIndexImpl::new(owner.clone(), state, folder, user.clone()).await?;
          if !hyper_index_owner_current(&owner, &user) {
            return Ok(());
          }
          consumer.refresh_search_index();
          writer
            .register_consumer_when(Box::new(consumer), || owner.is_current())
            .await;
        }
        if hyper_index_owner_current(&owner, &user) && writer.num_consumers().await > 0 {
          writer
            .spawn_instant_indexed_provider(&runtime.inner)
            .await?;
        }
        Ok::<_, flowy_error::FlowyError>(())
      };
      if let Some(Err(error)) = gate.run_if_current(operation).await {
        error!("[Indexing] Instant startup failed: {}", error);
      }
    });
  }

  pub(crate) async fn create_tanvity_state_if_not_exists(
    &self,
    uid: i64,
    workspace_id: &Uuid,
    user_paths: &UserPaths,
    owner: &HyperSearchOwner,
  ) -> Option<Arc<RwLock<DocumentTantivyState>>> {
    if !owner.matches(uid, workspace_id) || !self.index_owner_current(owner) {
      return None;
    }
    let state =
      match get_or_init_document_tantivy_state(*workspace_id, user_paths.tanvity_index_path(uid)) {
        Ok(state) => state,
        Err(error) => {
          error!(
            "[Indexing] Current owner's local index could not open: {}",
            error
          );
          return None;
        },
      };
    (owner.is_current() && self.index_owner_current(owner)).then_some(state)
  }

  pub(crate) async fn start_full_indexed_data_provider(
    &self,
    uid: i64,
    workspace_id: &Uuid,
    workspace_type: &WorkspaceType,
    _user_config: &UserConfig,
    _user_paths: &UserPaths,
    owner: HyperSearchOwner,
  ) {
    if !self.index_owner_current(&owner) || !owner.matches(uid, workspace_id) {
      return;
    }
    let folder = self.folder_manager.clone();
    let user = Arc::downgrade(&self.logged_user);
    let search = self.search_manager.clone();
    let published = self.full_indexed_data_writer.clone();
    let local = workspace_type.is_local();
    let finished = self.full_indexed_finish_sender.clone();
    finished.send_replace(false);
    let gate = owner.clone();
    self.runtime.spawn(async move {
      let operation = async {
        if !Self::wait_for_folder_ready(&folder).await || !owner.wait_ready().await {
          return Ok(());
        }
        if !hyper_index_owner_current(&owner, &user) {
          return Ok(());
        }
        let writer = FullIndexedDataWriter::new(owner.clone(), folder, user.clone());
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        if local {
          writer
            .register_full_indexed_consumer(Box::new(
              crate::indexed_data_consumer::EmbeddingFullIndexConsumer(owner.clone()),
            ))
            .await;
        }
        if let Some(state) = search
          .upgrade()
          .and_then(|search| search.index_state(&owner))
        {
          writer
            .register_full_indexed_consumer(Box::new(SearchFullIndexConsumer::new(
              owner.clone(),
              state,
            )))
            .await;
        }
        if writer.num_consumers().await > 0 {
          if let Err(error) = writer.full_index_unindexed_documents().await {
            error!("[Indexing] Full index failed: {}", error);
          }
        }
        if !hyper_index_owner_current(&owner, &user) {
          return Ok(());
        }
        finished.send_replace(true);
        if let Some(published) = published.upgrade() {
          let mut current = published.write().await;
          if !hyper_index_owner_current(&owner, &user) {
            return Ok(());
          }
          if let Some(previous) = current.replace(writer) {
            previous.cancel_indexing();
          }
        }
        Ok::<_, flowy_error::FlowyError>(())
      };
      if let Some(Err(error)) = gate.run_if_current(operation).await {
        error!("[Indexing] Full startup failed: {}", error);
      }
    });
  }

  fn index_owner_current(&self, owner: &HyperSearchOwner) -> bool {
    owner.is_current()
      && self.logged_user.user_id().ok() == Some(owner.uid())
      && self.logged_user.workspace_id().ok() == Some(owner.workspace_id())
  }
}

fn hyper_index_owner_current(
  owner: &HyperSearchOwner,
  user: &Weak<dyn flowy_server::af_cloud::define::LoggedUser>,
) -> bool {
  user.upgrade().is_some_and(|user| {
    owner.is_current()
      && user.user_id().ok() == Some(owner.uid())
      && user.workspace_id().ok() == Some(owner.workspace_id())
  })
}
