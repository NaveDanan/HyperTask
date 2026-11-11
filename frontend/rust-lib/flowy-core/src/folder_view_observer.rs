use collab::core::collab::{IndexContent, IndexContentReceiver};
use collab_folder::ViewIndexContent;
use flowy_search::services::manager::HyperSearchOwner;
use flowy_search_pub::entities::FolderViewObserver;
use flowy_search_pub::tantivy_state::DocumentTantivyState;
use lib_infra::async_trait::async_trait;
use std::sync::Weak;
use tokio::sync::RwLock;
use tracing::error;

pub struct FolderViewObserverImpl {
  state: Weak<RwLock<DocumentTantivyState>>,
  owner: HyperSearchOwner,
}

impl FolderViewObserverImpl {
  pub fn new(owner: HyperSearchOwner, state: Weak<RwLock<DocumentTantivyState>>) -> Self {
    Self { state, owner }
  }
}

#[async_trait]
impl FolderViewObserver for FolderViewObserverImpl {
  async fn set_observer_rx(&self, mut rx: IndexContentReceiver) {
    let state = self.state.clone();
    let owner = self.owner.clone();
    tokio::spawn(async move {
      while let Some(Ok(msg)) = owner.run_if_current(rx.recv()).await {
        let state = match state.upgrade() {
          Some(state) => state,
          None => {
            return;
          },
        };
        let Some(mut state) = owner.run_if_current(state.write()).await else {
          return;
        };
        if !owner.is_current() {
          return;
        }

        match msg {
          IndexContent::Create(value) => match serde_json::from_value::<ViewIndexContent>(value) {
            Ok(view) => {
              let _ =
                state.add_document_metadata(&view.id, Some(view.name.clone()), view.icon.clone());
            },
            Err(err) => error!("FolderIndexManager error deserialize (create): {:?}", err),
          },
          IndexContent::Update(value) => match serde_json::from_value::<ViewIndexContent>(value) {
            Ok(view) => {
              let _ =
                state.add_document_metadata(&view.id, Some(view.name.clone()), view.icon.clone());
            },
            Err(err) => error!("FolderIndexManager error deserialize (update): {:?}", err),
          },
          IndexContent::Delete(ids) => {
            let _ = state.delete_documents(&ids);
          },
        }
      }
    });
  }
}
