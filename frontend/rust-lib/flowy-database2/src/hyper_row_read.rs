//! Read live row groups when older compatible servers omit them from batch snapshots.
use std::collections::HashSet;
use std::sync::Arc;

use collab::core::collab::DataSource;
use collab::core::origin::CollabOrigin;
use collab::preclude::{Collab, MapExt, MapRef};
use collab_database::rows::ROW_DATABASE_ID;
use collab_entity::define::{DATABASE_ROW_DATA, DATABASE_ROW_ID};
use collab_entity::{CollabType, EncodedCollab};
use flowy_database_pub::cloud::{DatabaseCloudService, EncodeCollabByOid};
use flowy_error::{FlowyError, FlowyResult, internal_error};
use futures::{StreamExt, stream};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::hyper_creation::HyperDatabaseCreationOwner;

pub(crate) struct HyperRowReadFallback {
  // Shared by all batches for this captured workspace, including concurrent views.
  permits: Semaphore,
}

impl Default for HyperRowReadFallback {
  fn default() -> Self {
    Self {
      permits: Semaphore::new(4),
    }
  }
}

impl HyperRowReadFallback {
  pub async fn read(
    &self,
    owner: &HyperDatabaseCreationOwner,
    cloud: &Arc<dyn DatabaseCloudService>,
    object_ids: Vec<Uuid>,
    kind: CollabType,
  ) -> FlowyResult<EncodeCollabByOid> {
    owner
      .run_if_current(async {
        owner.check()?;
        let requested: HashSet<_> = object_ids.iter().copied().collect();
        let mut values = cloud
          .batch_get_database_encode_collab(object_ids, kind, &owner.workspace)
          .await?;
        owner.check()?;
        for (id, value) in &values {
          if !requested.contains(id) {
            return Err(invalid());
          }
          validate(*id, kind, value)?;
        }
        if kind != CollabType::DatabaseRow {
          return Ok(values);
        }

        let missing = requested
          .into_iter()
          .filter(|id| !values.contains_key(id))
          .collect::<Vec<_>>();
        let mut reads = stream::iter(missing.into_iter().map(|id| async move {
          owner.check()?;
          let _permit = self.permits.acquire().await.map_err(internal_error)?;
          // A queued read must never dispatch into another owner after waiting.
          owner.check()?;
          let value = cloud
            .get_database_encode_collab(&id, kind, &owner.workspace)
            .await?;
          owner.check()?;
          if let Some(value) = &value {
            validate(id, kind, value)?;
          }
          Ok::<_, FlowyError>((id, value))
        }))
        .buffer_unordered(4);
        while let Some(result) = reads.next().await {
          let (id, value) = result?;
          if let Some(value) = value {
            values.insert(id, value);
          }
        }
        owner.check()?;
        Ok(values)
      })
      .await
  }
}

fn invalid() -> FlowyError {
  FlowyError::invalid_data().with_context(
    "A dataset row response has invalid or mismatched data. Existing workspace data was kept.",
  )
}

fn validate(id: Uuid, kind: CollabType, encoded: &EncodedCollab) -> FlowyResult<()> {
  let collab = Collab::new_with_source(
    CollabOrigin::Empty,
    &id.to_string(),
    DataSource::from(encoded.clone()),
    vec![],
    false,
  )
  .map_err(|_| invalid())?;
  kind.validate_require_data(&collab).map_err(|_| invalid())?;
  if kind == CollabType::DatabaseRow {
    let txn = collab.transact();
    let row: MapRef = collab
      .data
      .get_with_path(&txn, [DATABASE_ROW_DATA])
      .ok_or_else(invalid)?;
    let actual: String = row
      .get_with_txn(&txn, DATABASE_ROW_ID)
      .ok_or_else(invalid)?;
    let database: String = row
      .get_with_txn(&txn, ROW_DATABASE_ID)
      .ok_or_else(invalid)?;
    if Uuid::parse_str(&actual).ok() != Some(id) || Uuid::parse_str(&database).is_err() {
      return Err(invalid());
    }
  }
  Ok(())
}
