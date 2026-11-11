use super::*;
use collab_document::document_data::default_document_data;

#[test]
fn hyper_duplicate_row_body_rejects_text_attributes_the_native_wire_cannot_retain() {
  let source_id = Uuid::new_v4();
  let mut data = default_document_data(&source_id.to_string());
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
  let mut document = Document::create(&source_id.to_string(), data).unwrap();
  {
    let collab: &mut Collab = std::borrow::BorrowMut::borrow_mut(&mut document);
    let mut txn = collab.context.transact_mut();
    let root = map(&collab.data, &txn, DOCUMENT_ROOT).unwrap();
    let meta = map(&root, &txn, "meta").unwrap();
    let texts = map(&meta, &txn, "text_map").unwrap();
    let text: TextRef = texts.get(&txn, "text").unwrap().cast().unwrap();
    text.format(
      &mut txn,
      0,
      4,
      Attrs::from([("future_integer".into(), Any::BigInt(i64::MAX - 1))]),
    );
  }
  let before = document
    .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
    .unwrap();
  let result = remap_body(&document, &Uuid::new_v4());
  assert!(result
    .err()
    .unwrap()
    .to_string()
    .contains("cannot be copied exactly"));
  assert_eq!(
    document
      .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
      .unwrap()
      .doc_state,
    before.doc_state
  );
  let txn = document.transact();
  let root = map(&document.data, &txn, DOCUMENT_ROOT).unwrap();
  let meta = map(&root, &txn, "meta").unwrap();
  let texts = map(&meta, &txn, "text_map").unwrap();
  let text: TextRef = texts.get(&txn, "text").unwrap().cast().unwrap();
  assert_eq!(
    text.diff(&txn, |_| ())[0].attributes.as_ref().unwrap()["future_integer"],
    Any::BigInt(i64::MAX - 1)
  );
}

#[test]
fn hyper_duplicate_row_body_retains_unknown_crdt_fields_and_remaps_utf16_timer_atoms() {
  let source_id = Uuid::new_v4();
  let target_id = Uuid::new_v4();
  let mut document = Document::create(
    &source_id.to_string(),
    default_document_data(&source_id.to_string()),
  )
  .unwrap();
  let mut data = document.get_document_data().unwrap();
  let block = data
    .blocks
    .values_mut()
    .find(|block| block.ty == "paragraph")
    .unwrap();
  let block_id = block.id.clone();
  let text_id = "body-text";
  block.external_id = Some(text_id.into());
  block.external_type = Some("text".into());
  data.meta.text_map.get_or_insert_with(Default::default).insert(text_id.into(), json!([{ "insert":"😀x" }, { "insert":"$", "attributes": { "bold":true, "future_attr":{"keep":true}, "mention":{"type":"date","date":"2031-05-06","reminder_id":"original","unknown":"retained"} }}]).to_string());
  document = Document::create(&source_id.to_string(), data).unwrap();
  {
    let collab: &mut Collab = std::borrow::BorrowMut::borrow_mut(&mut document);
    let mut txn = collab.context.transact_mut();
    collab.data.insert(
      &mut txn,
      "future_root",
      MapPrelim::from([("kept", "exact")]),
    );
    let root = map(&collab.data, &txn, DOCUMENT_ROOT).unwrap();
    let blocks = map(&root, &txn, "blocks").unwrap();
    let block = map(&blocks, &txn, &block_id).unwrap();
    block.insert(&mut txn, "future_block", true);
    let meta = map(&root, &txn, "meta").unwrap();
    let texts = map(&meta, &txn, "text_map").unwrap();
    let text: TextRef = texts.get(&txn, text_id).unwrap().cast().unwrap();
    let delta = text
      .diff(&txn, |_| ())
      .into_iter()
      .find(|delta| {
        delta
          .attributes
          .as_ref()
          .is_some_and(|attrs| attrs.contains_key("mention"))
      })
      .unwrap();
    let attributes = delta.attributes.unwrap();
    let Any::Map(mention) = &attributes["mention"] else {
      panic!("expected raw mention map");
    };
    let mut mention = (**mention).clone();
    mention.insert("future_integer".into(), Any::BigInt(1 << 60));
    text.format(
      &mut txn,
      3,
      1,
      Attrs::from([("mention".into(), Any::Map(std::sync::Arc::new(mention)))]),
    );
  }
  let (copied, timers) = remap_body(&document, &target_id).unwrap();
  assert_eq!(timers.len(), 1);
  assert_eq!(timers[0].offset, 3);
  let expected = super::super::hyper_document_duplicate::hyper_duplicate_reminder_id(
    &target_id, &block_id, 3, "original",
  )
  .unwrap();
  assert_eq!(timers[0].target_id, expected);
  let txn = copied.transact();
  assert_eq!(
    map(&copied.data, &txn, "future_root")
      .unwrap()
      .get(&txn, "kept")
      .unwrap()
      .cast::<String>()
      .unwrap(),
    "exact"
  );
  let root = map(&copied.data, &txn, DOCUMENT_ROOT).unwrap();
  let blocks = map(&root, &txn, "blocks").unwrap();
  let meta = map(&root, &txn, "meta").unwrap();
  let texts = map(&meta, &txn, "text_map").unwrap();
  let text: TextRef = texts.get(&txn, text_id).unwrap().cast().unwrap();
  let delta = text
    .diff(&txn, |_| ())
    .into_iter()
    .find(|delta| {
      delta
        .attributes
        .as_ref()
        .is_some_and(|attrs| attrs.contains_key("mention"))
    })
    .unwrap();
  let attributes = delta.attributes.unwrap();
  let Any::Map(mention) = &attributes["mention"] else {
    panic!("expected copied raw mention map");
  };
  assert_eq!(mention["future_integer"], Any::BigInt(1 << 60));
  assert_eq!(
    map(&blocks, &txn, &block_id)
      .unwrap()
      .get(&txn, "future_block"),
    Some(YrsValue::Any(Any::Bool(true)))
  );
  drop(txn);
  let copied = Document::open(copied).unwrap().get_document_data().unwrap();
  let runs: Value = serde_json::from_str(&copied.meta.text_map.as_ref().unwrap()[text_id]).unwrap();
  assert_eq!(runs[1]["attributes"]["mention"]["reminder_id"], expected);
  assert_eq!(runs[1]["attributes"]["future_attr"]["keep"], true);
  let source = document.get_document_data().unwrap();
  assert!(source.meta.text_map.as_ref().unwrap()[text_id].contains("original"));
}

#[test]
fn hyper_duplicate_row_body_remaps_legacy_inline_dates_without_rewriting_other_block_data() {
  let source_id = Uuid::new_v4();
  let target_id = Uuid::new_v4();
  let mut data = default_document_data(&source_id.to_string());
  let block = data
    .blocks
    .values_mut()
    .find(|block| block.ty == "paragraph")
    .unwrap();
  let id = block.id.clone();
  block.data.insert("future".into(), json!({"kept":true}));
  block.data.insert("delta".into(), json!([{ "insert":"x$" }, { "insert":"$", "attributes":{"mention":{"type":"reminder","date":"2031-05-06","reminder_id":"source"},"unknown":true} }]));
  let document = Document::create(&source_id.to_string(), data).unwrap();
  let (copied, timers) = remap_body(&document, &target_id).unwrap();
  assert_eq!(timers.len(), 1);
  assert_eq!(timers[0].offset, 2);
  let copied = Document::open(copied).unwrap().get_document_data().unwrap();
  assert_eq!(copied.blocks[&id].data["future"]["kept"], true);
  assert_eq!(
    copied.blocks[&id].data["delta"][1]["attributes"]["mention"]["reminder_id"],
    timers[0].target_id
  );
  assert_eq!(
    document.get_document_data().unwrap().blocks[&id].data["delta"][1]["attributes"]["mention"]
      ["reminder_id"],
    "source"
  );
}

#[test]
fn hyper_duplicate_row_body_rejects_existing_object_embeds_without_mutating_the_source() {
  let source_id = Uuid::new_v4();
  let mut data = default_document_data(&source_id.to_string());
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
  let mut document = Document::create(&source_id.to_string(), data).unwrap();
  {
    let collab: &mut Collab = std::borrow::BorrowMut::borrow_mut(&mut document);
    let mut txn = collab.context.transact_mut();
    let root = map(&collab.data, &txn, DOCUMENT_ROOT).unwrap();
    let meta = map(&root, &txn, "meta").unwrap();
    let text_map = map(&meta, &txn, "text_map").unwrap();
    let text: TextRef = text_map.get(&txn, "text").unwrap().cast().unwrap();
    text.insert_embed(
      &mut txn,
      0,
      Any::from_json("{\"future_image\":\"kept\"}").unwrap(),
    );
  }
  let before = document
    .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
    .unwrap()
    .doc_state;
  assert!(remap_body(&document, &Uuid::new_v4()).is_err());
  assert_eq!(
    document
      .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
      .unwrap()
      .doc_state,
    before
  );
}
