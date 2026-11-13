//! Bind a copied database's upload to its actual object, rather than its view ID.
use collab::core::{collab::DataSource, origin::CollabOrigin};
use collab::preclude::*;
use collab_entity::define::{DATABASE, DATABASE_ID};
use collab_entity::{CollabType, EncodedCollab};
use flowy_error::{FlowyError, FlowyResult, internal_error};
use flowy_folder_pub::cloud::FolderCollabParams;
use uuid::Uuid;

fn invalid() -> FlowyError {
  FlowyError::invalid_data().with_context(
    "The copied database has an inconsistent object or view binding. Its local data was kept without uploading it.",
  )
}

fn map<T: ReadTxn>(parent: &MapRef, txn: &T, key: &str) -> FlowyResult<MapRef> {
  parent
    .get(txn, key)
    .and_then(|value| value.cast().ok())
    .ok_or_else(invalid)
}

fn string<T: ReadTxn>(parent: &MapRef, txn: &T, key: &str) -> FlowyResult<String> {
  parent
    .get(txn, key)
    .and_then(|value| value.cast().ok())
    .ok_or_else(invalid)
}

pub(crate) fn hyper_duplicate_collab_params(
  view_id: Uuid,
  collab_type: CollabType,
  encoded_collab: EncodedCollab,
) -> FlowyResult<Option<FolderCollabParams>> {
  let object_id = match collab_type {
    CollabType::Document => view_id,
    CollabType::Database => {
      let collab = Collab::new_with_source(
        CollabOrigin::Empty,
        &view_id.to_string(),
        DataSource::DocStateV1(encoded_collab.doc_state.to_vec()),
        vec![],
        false,
      )
      .map_err(internal_error)?;
      CollabType::Database
        .validate_require_data(&collab)
        .map_err(internal_error)?;
      let txn = collab.transact();
      let database = map(&collab.data, &txn, DATABASE)?;
      let id = string(&database, &txn, DATABASE_ID)?;
      Uuid::parse_str(&id).map_err(|_| invalid())?;
      let views = map(&database, &txn, "views")?;
      let view = map(&views, &txn, &view_id.to_string())?;
      if string(&view, &txn, "id")? != view_id.to_string()
        || string(&view, &txn, "database_id")? != id
      {
        return Err(invalid());
      }
      // Database copy publication uses current committed instances, including
      // rows and bodies. Never re-upload a root snapshot collected earlier in
      // a recursive folder copy, even if a handler returns one.
      return Ok(None);
    },
    _ => return Err(FlowyError::not_support()),
  };
  Ok(Some(FolderCollabParams {
    object_id,
    collab_type,
    encoded_collab_v1: encoded_collab.encode_to_bytes().map_err(internal_error)?,
  }))
}

#[cfg(test)]
mod tests {
  use super::*;
  use collab_entity::define::{DATABASE_INLINE_VIEW, DATABASE_METAS};

  fn source(view_id: Uuid, database_id: Uuid) -> Collab {
    let mut collab =
      Collab::new_with_origin(CollabOrigin::Empty, &database_id.to_string(), vec![], false);
    {
      let mut txn = collab.context.transact_mut();
      let database = collab.data.insert(&mut txn, DATABASE, MapPrelim::default());
      database.insert(&mut txn, DATABASE_ID, database_id.to_string());
      database.insert(
        &mut txn,
        DATABASE_METAS,
        MapPrelim::from([(DATABASE_INLINE_VIEW, view_id.to_string())]),
      );
      let views = database.insert(&mut txn, "views", MapPrelim::default());
      views.insert(
        &mut txn,
        view_id.to_string(),
        MapPrelim::from([
          ("id", view_id.to_string()),
          ("database_id", database_id.to_string()),
        ]),
      );
      collab.data.insert(
        &mut txn,
        "future_root",
        MapPrelim::from([("retained", true)]),
      );
    }
    collab
  }

  fn encoded(collab: &Collab) -> EncodedCollab {
    collab
      .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
      .unwrap()
  }

  #[test]
  fn hyper_duplicate_registration_never_schedules_database_snapshot_http_replay() {
    let view_id = Uuid::new_v4();
    let database_id = Uuid::new_v4();
    let source = source(view_id, database_id);
    let before = encoded(&source).encode_to_bytes().unwrap();
    let params =
      hyper_duplicate_collab_params(view_id, CollabType::Database, encoded(&source)).unwrap();
    assert!(params.is_none());
    assert_eq!(encoded(&source).encode_to_bytes().unwrap(), before);
  }

  #[test]
  fn hyper_duplicate_registration_rejects_unsafe_database_bindings_and_malformed_state() {
    let view_id = Uuid::new_v4();
    for failure in [
      "missing_view",
      "foreign_view",
      "foreign_database",
      "invalid_id",
      "missing_meta",
    ] {
      let mut source = source(view_id, Uuid::new_v4());
      {
        let mut txn = source.context.transact_mut();
        let database = map(&source.data, &txn, DATABASE).unwrap();
        let views = map(&database, &txn, "views").unwrap();
        let view = map(&views, &txn, &view_id.to_string()).unwrap();
        match failure {
          "missing_view" => {
            views.remove(&mut txn, &view_id.to_string());
          },
          "foreign_view" => {
            view.insert(&mut txn, "id", Uuid::new_v4().to_string());
          },
          "foreign_database" => {
            view.insert(&mut txn, "database_id", Uuid::new_v4().to_string());
          },
          "invalid_id" => {
            database.insert(&mut txn, DATABASE_ID, "not-a-uuid");
          },
          "missing_meta" => {
            database.remove(&mut txn, DATABASE_METAS);
          },
          _ => unreachable!(),
        }
      }
      let before = encoded(&source).encode_to_bytes().unwrap();
      assert!(
        hyper_duplicate_collab_params(view_id, CollabType::Database, encoded(&source)).is_err(),
        "{} must not produce upload parameters",
        failure
      );
      assert_eq!(encoded(&source).encode_to_bytes().unwrap(), before);
    }
    let mut malformed = encoded(&source(view_id, Uuid::new_v4()));
    malformed.doc_state = vec![0xff].into();
    assert!(hyper_duplicate_collab_params(view_id, CollabType::Database, malformed).is_err());
  }

  #[test]
  fn hyper_duplicate_registration_keeps_document_object_id_and_internal_page_data() {
    let view_id = Uuid::new_v4();
    let mut source =
      Collab::new_with_origin(CollabOrigin::Empty, &view_id.to_string(), vec![], false);
    source.data.insert(
      &mut source.context.transact_mut(),
      "document",
      MapPrelim::from([("page_id", Uuid::new_v4().to_string())]),
    );
    let before = encoded(&source).encode_to_bytes().unwrap();
    let params = hyper_duplicate_collab_params(view_id, CollabType::Document, encoded(&source))
      .unwrap()
      .unwrap();
    assert_eq!(params.object_id, view_id);
    assert_eq!(params.collab_type, CollabType::Document);
    assert_eq!(params.encoded_collab_v1, before);
    assert_eq!(encoded(&source).encode_to_bytes().unwrap(), before);
  }
}
