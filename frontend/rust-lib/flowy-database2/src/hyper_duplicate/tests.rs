use super::*;
use collab_database::rows::{Cells, Row, default_database_row_data};

fn row(source: Uuid, database: &str) -> Collab {
  let value = Row {
    id: source.to_string().into(),
    database_id: database.into(),
    cells: Cells::new(),
    height: 73,
    visibility: true,
    created_at: 1,
    modified_at: 2,
  };
  hyper_duplicate_encoded(
    &default_database_row_data(&source.to_string().into(), value),
    &source.to_string(),
  )
  .unwrap()
}

#[test]
fn hyper_duplicate_raw_row_preserves_future_metadata_and_remaps_only_known_ids_and_timer() {
  let source = Uuid::new_v4();
  let target = Uuid::new_v4();
  let mut original = row(source, "database");
  {
    let mut txn = original.context.transact_mut();
    let meta = map(&original.data, &txn, "meta").unwrap();
    meta.insert(
      &mut txn,
      "future_metadata",
      MapPrelim::from([("keep", "exact")]),
    );
    meta.insert(
      &mut txn,
      meta_id_from_row_id(&source, RowMetaKey::IsDocumentEmpty),
      false,
    );
    meta.insert(
      &mut txn,
      meta_id_from_row_id(&source, RowMetaKey::AttachmentCount),
      Any::BigInt(7),
    );
    let data = map(&original.data, &txn, "data").unwrap();
    let cells = map(&data, &txn, "cells").unwrap();
    let cell = cells.insert(&mut txn, "date", MapPrelim::default());
    cell.insert(&mut txn, "field_type", Any::BigInt(2));
    cell.insert(&mut txn, "data", "1935741900");
    cell.insert(&mut txn, "reminder_id", "source-timer");
    cell.insert(&mut txn, "unknown", MapPrelim::from([("keep", true)]));
  }
  let (copied, has_body, reminders) =
    remap_row(&original, &source, &target, "database", "copy").unwrap();
  assert!(has_body);
  assert_eq!(reminders.len(), 1);
  let txn = copied.transact();
  let meta = map(&copied.data, &txn, "meta").unwrap();
  assert_eq!(
    string(&map(&meta, &txn, "future_metadata").unwrap(), &txn, "keep").unwrap(),
    "exact"
  );
  assert!(
    meta
      .get(
        &txn,
        &meta_id_from_row_id(&source, RowMetaKey::AttachmentCount)
      )
      .is_none()
  );
  assert_eq!(
    meta.get(
      &txn,
      &meta_id_from_row_id(&target, RowMetaKey::AttachmentCount)
    ),
    Some(YrsValue::Any(Any::BigInt(7)))
  );
  let data = map(&copied.data, &txn, "data").unwrap();
  let cells = map(&data, &txn, "cells").unwrap();
  let date = map(&cells, &txn, "date").unwrap();
  assert_eq!(string(&date, &txn, "data").unwrap(), "1935741900");
  assert_ne!(string(&date, &txn, "reminder_id").unwrap(), "source-timer");
  assert_eq!(
    map(&date, &txn, "unknown").unwrap().get(&txn, "keep"),
    Some(YrsValue::Any(Any::Bool(true)))
  );
  let txn = original.transact();
  let data = map(&original.data, &txn, "data").unwrap();
  assert_eq!(
    string(
      &map(&map(&data, &txn, "cells").unwrap(), &txn, "date").unwrap(),
      &txn,
      "reminder_id"
    )
    .unwrap(),
    "source-timer"
  );
}

#[test]
fn hyper_duplicate_rejects_inconsistent_row_and_future_document_metadata_before_any_write() {
  let source = Uuid::new_v4();
  let mut original = row(source, "database");
  let before = original
    .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
    .unwrap()
    .doc_state;
  assert!(
    remap_row(
      &original,
      &Uuid::new_v4(),
      &Uuid::new_v4(),
      "database",
      "copy"
    )
    .is_err()
  );
  assert_eq!(
    original
      .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
      .unwrap()
      .doc_state,
    before
  );
  let mut txn = original.context.transact_mut();
  let meta = map(&original.data, &txn, "meta").unwrap();
  meta.insert(
    &mut txn,
    meta_id_from_row_id(&source, RowMetaKey::IsDocumentEmpty),
    "future",
  );
  drop(txn);
  assert!(remap_row(&original, &source, &Uuid::new_v4(), "database", "copy").is_err());
}

#[test]
fn hyper_duplicate_database_maps_native_rows_and_keeps_each_views_order_and_future_fields() {
  let source_view = Uuid::new_v4();
  let other_view = Uuid::new_v4();
  let target_view = Uuid::new_v4();
  let one = Uuid::new_v4().to_string();
  let two = Uuid::new_v4().to_string();
  let mut source = Collab::new_with_origin(CollabOrigin::Empty, "source-db", vec![], false);
  {
    let mut txn = source.context.transact_mut();
    let root = source.data.insert(&mut txn, DATABASE, MapPrelim::default());
    root.insert(&mut txn, "id", "source-db");
    root.insert(
      &mut txn,
      "metas",
      MapPrelim::from([("iid", source_view.to_string())]),
    );
    let views = root.insert(&mut txn, "views", MapPrelim::default());
    for (id, order) in [(source_view, [&two, &one]), (other_view, [&one, &two])] {
      let view = views.insert(
        &mut txn,
        id.to_string(),
        MapPrelim::from([
          ("id", id.to_string()),
          ("database_id", "source-db".into()),
          ("future", "retained".into()),
        ]),
      );
      let array = view.insert(&mut txn, "row_orders", ArrayPrelim::default());
      for row in order {
        array.push_back(
          &mut txn,
          Any::Map(Arc::new(HashMap::from([
            ("id".into(), Any::String(row.clone().into())),
            ("height".into(), Any::BigInt(71)),
            ("future_order".into(), Any::Bool(true)),
          ]))),
        );
      }
    }
  }
  let mapping = HashMap::from([
    (one.clone(), Uuid::new_v4().to_string()),
    (two.clone(), Uuid::new_v4().to_string()),
  ]);
  assert_eq!(database_row_ids(&source).unwrap().len(), 2);
  let (copied, views) = remap_database(
    &source,
    "copy-db",
    &source_view.to_string(),
    &target_view,
    &mapping,
  )
  .unwrap();
  let txn = copied.transact();
  let root = map(&copied.data, &txn, DATABASE).unwrap();
  let data = map(&root, &txn, "views").unwrap();
  for (id, expected) in [(source_view, [&two, &one]), (other_view, [&one, &two])] {
    let view = map(&data, &txn, &views[&id.to_string()]).unwrap();
    assert_eq!(string(&view, &txn, "future").unwrap(), "retained");
    assert!(data.get(&txn, &id.to_string()).is_none());
    let orders: ArrayRef = view.get(&txn, "row_orders").unwrap().cast().unwrap();
    for (index, source_id) in expected.into_iter().enumerate() {
      let YrsValue::Any(Any::Map(order)) = orders.get(&txn, index as u32).unwrap() else {
        panic!("row order must remain Any map");
      };
      assert_eq!(order["id"], Any::String(mapping[source_id].clone().into()));
      assert_eq!(order["future_order"], Any::Bool(true));
    }
  }
  let txn = source.transact();
  let root = map(&source.data, &txn, DATABASE).unwrap();
  assert_eq!(string(&root, &txn, "id").unwrap(), "source-db");
}

#[tokio::test]
async fn hyper_duplicate_owner_change_cancels_pending_source_reads_and_aba_never_revives_them() {
  let directory = std::env::temp_dir().join(format!("hyper-copy-scope-{}", Uuid::new_v4()));
  std::fs::create_dir(&directory).unwrap();
  let db = Arc::new(CollabKVDB::open(&directory).unwrap());
  let (changes, _) = tokio::sync::watch::channel(0);
  let observed = changes.clone();
  let scope = HyperDatabaseDuplicateScope {
    uid: 1,
    workspace_id: Uuid::new_v4(),
    db: db.clone(),
    current: Arc::new(move || *observed.borrow() == 0),
    cloud: None,
    context: None,
    changes: Some(changes.clone()),
  };
  let started = Arc::new(tokio::sync::Notify::new());
  let pending_started = started.clone();
  let task = tokio::spawn(async move {
    scope
      .run_if_current(async {
        pending_started.notify_one();
        std::future::pending::<()>().await
      })
      .await
  });
  started.notified().await;
  changes.send_replace(1);
  changes.send_replace(2);
  assert!(
    tokio::time::timeout(std::time::Duration::from_secs(1), task)
      .await
      .unwrap()
      .unwrap()
      .is_err()
  );
  drop(db);
  let reopened = CollabKVDB::open(&directory).unwrap();
  drop(reopened);
  std::fs::remove_dir_all(directory).unwrap();
}
