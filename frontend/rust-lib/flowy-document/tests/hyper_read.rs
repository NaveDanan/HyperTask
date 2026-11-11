#[path = "document/util.rs"]
mod util;

use collab::preclude::*;
use collab_integrate::CollabKVAction;
use collab_plugins::local_storage::kv::KVTransactionDB;
use uuid::Uuid;

#[tokio::test]
async fn hyper_read_copy_checks_live_text_attributes_before_snapshot_encoding() {
  use collab_document::document_data::default_document_data;
  let manager = util::DocumentTest::new();
  let uid = manager.user_service.user_id().unwrap();
  let workspace = manager.user_service.workspace_id().unwrap();
  let db = manager
    .user_service
    .collab_db(uid)
    .unwrap()
    .upgrade()
    .unwrap();
  let id = Uuid::new_v4();
  let mut data = default_document_data(&id.to_string());
  let block = data
    .blocks
    .values_mut()
    .find(|block| block.ty == "paragraph")
    .unwrap();
  block.external_id = Some("text".into());
  block.external_type = Some("text".into());
  data
    .meta
    .text_map
    .get_or_insert_with(Default::default)
    .insert("text".into(), "[{\"insert\":\"kept\"}]".into());
  manager.create_document(uid, &id, Some(data)).await.unwrap();
  manager.open_document(&id).await.unwrap();
  let live = manager.editable_document(&id).await.unwrap();
  {
    let mut document = live.write().await;
    let collab: &mut Collab = std::borrow::BorrowMut::borrow_mut(&mut *document);
    let mut txn = collab.context.transact_mut();
    let root: MapRef = collab.data.get(&txn, "document").unwrap().cast().unwrap();
    let meta: MapRef = root.get(&txn, "meta").unwrap().cast().unwrap();
    let texts: MapRef = meta.get(&txn, "text_map").unwrap().cast().unwrap();
    let text: TextRef = texts.get(&txn, "text").unwrap().cast().unwrap();
    text.format(
      &mut txn,
      0,
      4,
      Attrs::from([("future_integer".into(), Any::BigInt(i64::MAX - 1))]),
    );
  }
  let error = manager
    .snapshot_for_duplicate(uid, workspace, &db, &id, true)
    .await
    .unwrap_err();
  assert!(error.msg.contains("cannot be copied exactly"));
  let document = live.read().await;
  let txn = document.transact();
  let root: MapRef = document.data.get(&txn, "document").unwrap().cast().unwrap();
  let meta: MapRef = root.get(&txn, "meta").unwrap().cast().unwrap();
  let texts: MapRef = meta.get(&txn, "text_map").unwrap().cast().unwrap();
  let text: TextRef = texts.get(&txn, "text").unwrap().cast().unwrap();
  assert_eq!(
    text.diff(&txn, |_| ())[0].attributes.as_ref().unwrap()["future_integer"],
    Any::BigInt(i64::MAX - 1)
  );
}

#[tokio::test]
async fn hyper_read_invalid_document_never_deletes_or_replaces_its_persisted_source() {
  let manager = util::DocumentTest::new();
  let uid = manager.user_service.user_id().unwrap();
  let workspace = manager.user_service.workspace_id().unwrap().to_string();
  let db = manager
    .user_service
    .collab_db(uid)
    .unwrap()
    .upgrade()
    .unwrap();
  let id = Uuid::new_v4();
  let mut original = Collab::new_with_origin(
    collab::core::origin::CollabOrigin::Empty,
    &id.to_string(),
    vec![],
    false,
  );
  original.data.insert(
    &mut original.context.transact_mut(),
    "future_document",
    "retained data",
  );
  let write = db.write_txn();
  write
    .create_new_doc(uid, &workspace, &id.to_string(), &original.transact())
    .unwrap();
  write.commit_transaction().unwrap();
  for _ in 0..2 {
    assert!(manager.get_document_data(&id).await.is_err());
    let read = db.read_txn();
    assert!(
      read.is_exist(uid, &workspace, &id.to_string()),
      "failed reads must preserve the source object"
    );
    let mut reloaded = Collab::new_with_origin(
      collab::core::origin::CollabOrigin::Empty,
      &id.to_string(),
      vec![],
      false,
    );
    read
      .load_doc_with_txn(
        uid,
        &workspace,
        &id.to_string(),
        &mut reloaded.transact_mut(),
      )
      .unwrap();
    assert_eq!(
      reloaded
        .data
        .get(&reloaded.transact(), "future_document")
        .unwrap()
        .cast::<String>()
        .unwrap(),
      "retained data"
    );
  }
  let missing = Uuid::new_v4();
  assert!(manager.get_document_data(&missing).await.is_err());
  assert!(
    !db
      .read_txn()
      .is_exist(uid, &workspace, &missing.to_string())
  );
}

#[tokio::test]
async fn hyper_read_copy_rejects_real_embedded_content_without_changing_saved_source_bytes() {
  use collab_document::{document::Document, document_data::default_document_data};
  let manager = util::DocumentTest::new();
  let uid = manager.user_service.user_id().unwrap();
  let workspace = manager.user_service.workspace_id().unwrap();
  let db = manager
    .user_service
    .collab_db(uid)
    .unwrap()
    .upgrade()
    .unwrap();
  let id = Uuid::new_v4();
  let mut data = default_document_data(&id.to_string());
  let block = data
    .blocks
    .values_mut()
    .find(|block| block.ty == "paragraph")
    .unwrap();
  block.external_id = Some("text".into());
  block.external_type = Some("text".into());
  data
    .meta
    .text_map
    .get_or_insert_with(Default::default)
    .insert("text".into(), "[]".into());
  let mut document = Document::create(&id.to_string(), data).unwrap();
  {
    let collab: &mut Collab = std::borrow::BorrowMut::borrow_mut(&mut document);
    let mut txn = collab.context.transact_mut();
    let root: MapRef = collab.data.get(&txn, "document").unwrap().cast().unwrap();
    let meta: MapRef = root.get(&txn, "meta").unwrap().cast().unwrap();
    let texts: MapRef = meta.get(&txn, "text_map").unwrap().cast().unwrap();
    let text: TextRef = texts.get(&txn, "text").unwrap().cast().unwrap();
    text.insert(&mut txn, 0, "AB");
    text.insert_embed(
      &mut txn,
      1,
      Any::from_json("{\"legacy_image\":\"retained\"}").unwrap(),
    );
  }
  let before = document
    .encode_collab_v1(|_| Ok::<_, flowy_error::FlowyError>(()))
    .unwrap();
  let write = db.write_txn();
  write
    .create_new_doc(
      uid,
      &workspace.to_string(),
      &id.to_string(),
      &document.transact(),
    )
    .unwrap();
  write.commit_transaction().unwrap();
  let published = manager.get_document_data(&id).await;
  if let Ok(data) = &published {
    let runs: serde_json::Value =
      serde_json::from_str(&data.meta.text_map.as_ref().unwrap()["text"]).unwrap();
    let displayed_units: usize = runs
      .as_array()
      .unwrap()
      .iter()
      .map(|run| run["insert"].as_str().unwrap().encode_utf16().count())
      .sum();
    let mut replica = Document::open(
      Collab::new_with_source(
        collab::core::origin::CollabOrigin::Empty,
        "detached-offset-proof",
        collab::core::collab::DataSource::DocStateV1(before.doc_state.to_vec()),
        vec![],
        false,
      )
      .unwrap(),
    )
    .unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
      replica.apply_text_delta(
        "text",
        serde_json::json!([{ "retain":displayed_units - 1 }, { "insert":"C" }]).to_string(),
      )
    }));
    println!(
      "hyper raw embed occupies one unit; typed snapshot reported {displayed_units} units for three native units; detached edit panicked={}",
      result.is_err()
    );
    if result.is_ok() {
      let raw = replica.get_document_data().unwrap();
      println!(
        "hyper detached edit using published offsets produced {}",
        raw.meta.text_map.as_ref().unwrap()["text"]
      );
    }
  }
  assert!(
    published.is_err(),
    "an unsupported native embed must produce an explicit read error, never an editable snapshot with different text offsets"
  );
  assert!(published.unwrap_err().msg.contains("embedded"));
  assert!(manager.get_document_data_for_duplicate(&id).await.is_err());
  let saved = manager
    .snapshot_for_duplicate(uid, workspace, &db, &id, true)
    .await
    .unwrap()
    .unwrap();
  assert_eq!(saved.doc_state, before.doc_state);
}

#[tokio::test]
async fn hyper_read_supported_text_keeps_unknown_root_fields_readable_and_preserves_them_on_disk() {
  use collab_document::{document::Document, document_data::default_document_data};
  let manager = util::DocumentTest::new();
  let uid = manager.user_service.user_id().unwrap();
  let workspace = manager.user_service.workspace_id().unwrap();
  let db = manager
    .user_service
    .collab_db(uid)
    .unwrap()
    .upgrade()
    .unwrap();
  let id = Uuid::new_v4();
  let mut document =
    Document::create(&id.to_string(), default_document_data(&id.to_string())).unwrap();
  {
    let collab: &mut Collab = std::borrow::BorrowMut::borrow_mut(&mut document);
    collab.data.insert(
      &mut collab.context.transact_mut(),
      "future_root",
      MapPrelim::from([("retained", true)]),
    );
  }
  let before = document
    .encode_collab_v1(|_| Ok::<_, flowy_error::FlowyError>(()))
    .unwrap();
  let write = db.write_txn();
  write
    .create_new_doc(
      uid,
      &workspace.to_string(),
      &id.to_string(),
      &document.transact(),
    )
    .unwrap();
  write.commit_transaction().unwrap();
  assert!(manager.get_document_data(&id).await.is_ok());
  // The typed legacy copy payload cannot retain this root field, so copying fails closed.
  assert!(manager.get_document_data_for_duplicate(&id).await.is_err());
  assert_eq!(
    manager
      .snapshot_for_duplicate(uid, workspace, &db, &id, true)
      .await
      .unwrap()
      .unwrap()
      .doc_state,
    before.doc_state
  );
}
