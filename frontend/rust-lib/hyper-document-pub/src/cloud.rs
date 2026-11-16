use collab::entity::EncodedCollab;
pub use collab_document::blocks::DocumentData;
use hyper_error::HyperError;
use lib_infra::async_trait::async_trait;
use uuid::Uuid;

/// A trait for document cloud service.
/// Each kind of server should implement this trait. Check out the [HypertaskServerProvider] of
/// [hyper-server] crate for more information.
#[async_trait]
pub trait DocumentCloudService: Send + Sync + 'static {
  async fn get_document_doc_state(
    &self,
    document_id: &Uuid,
    workspace_id: &Uuid,
  ) -> Result<Vec<u8>, HyperError>;

  async fn get_document_snapshots(
    &self,
    document_id: &Uuid,
    limit: usize,
    workspace_id: &str,
  ) -> Result<Vec<DocumentSnapshot>, HyperError>;

  async fn get_document_data(
    &self,
    document_id: &Uuid,
    workspace_id: &Uuid,
  ) -> Result<Option<DocumentData>, HyperError>;

  async fn create_document_collab(
    &self,
    workspace_id: &Uuid,
    document_id: &Uuid,
    encoded_collab: EncodedCollab,
  ) -> Result<(), HyperError>;
}

pub struct DocumentSnapshot {
  pub snapshot_id: i64,
  pub document_id: String,
  pub data: Vec<u8>,
  pub created_at: i64,
}
