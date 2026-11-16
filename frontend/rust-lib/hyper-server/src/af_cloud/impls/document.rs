#![allow(unused_variables)]
use client_api::entity::{CreateCollabParams, QueryCollab, QueryCollabParams};
use collab::core::collab::DataSource;
use collab::core::origin::CollabOrigin;
use collab::entity::EncodedCollab;
use collab::preclude::Collab;
use collab_document::document::Document;
use collab_entity::CollabType;
use hyper_document_pub::cloud::*;
use hyper_error::HyperError;
use lib_infra::async_trait::async_trait;
use std::sync::Weak;
use tracing::instrument;
use uuid::Uuid;

use crate::af_cloud::AFServer;
use crate::af_cloud::define::LoggedUser;
use crate::af_cloud::impls::util::check_request_workspace_id_is_match;

pub(crate) struct AFCloudDocumentCloudServiceImpl<T> {
  pub inner: T,
  pub logged_user: Weak<dyn LoggedUser>,
}

#[async_trait]
impl<T> DocumentCloudService for AFCloudDocumentCloudServiceImpl<T>
where
  T: AFServer,
{
  #[instrument(level = "debug", skip_all, fields(document_id = %document_id))]
  async fn get_document_doc_state(
    &self,
    document_id: &Uuid,
    workspace_id: &Uuid,
  ) -> Result<Vec<u8>, HyperError> {
    let params = QueryCollabParams {
      workspace_id: *workspace_id,
      inner: QueryCollab::new(*document_id, CollabType::Document),
    };
    let doc_state = self
      .inner
      .try_get_client()?
      .get_collab(params)
      .await
      .map_err(HyperError::from)?
      .encode_collab
      .doc_state
      .to_vec();

    check_request_workspace_id_is_match(
      workspace_id,
      &self.logged_user,
      format!("get document doc state:{}", document_id),
    )?;

    Ok(doc_state)
  }

  async fn get_document_snapshots(
    &self,
    document_id: &Uuid,
    limit: usize,
    workspace_id: &str,
  ) -> Result<Vec<DocumentSnapshot>, HyperError> {
    Ok(vec![])
  }

  #[instrument(level = "debug", skip_all)]
  async fn get_document_data(
    &self,
    document_id: &Uuid,
    workspace_id: &Uuid,
  ) -> Result<Option<DocumentData>, HyperError> {
    let params = QueryCollabParams {
      workspace_id: *workspace_id,
      inner: QueryCollab::new(*document_id, CollabType::Document),
    };
    let doc_state = self
      .inner
      .try_get_client()?
      .get_collab(params)
      .await?
      .encode_collab
      .doc_state
      .to_vec();
    check_request_workspace_id_is_match(
      workspace_id,
      &self.logged_user,
      format!("Get {} document", document_id),
    )?;
    let collab = Collab::new_with_source(
      CollabOrigin::Empty,
      document_id.to_string().as_str(),
      DataSource::DocStateV1(doc_state),
      vec![],
      false,
    )?;
    let document = Document::open(collab)?;
    Ok(document.get_document_data().ok())
  }

  async fn create_document_collab(
    &self,
    workspace_id: &Uuid,
    document_id: &Uuid,
    encoded_collab: EncodedCollab,
  ) -> Result<(), HyperError> {
    let params = CreateCollabParams {
      workspace_id: *workspace_id,
      object_id: *document_id,
      encoded_collab_v1: encoded_collab
        .encode_to_bytes()
        .map_err(|err| HyperError::internal().with_context(err))?,
      collab_type: CollabType::Document,
    };
    self.inner.try_get_client()?.create_collab(params).await?;
    Ok(())
  }
}
