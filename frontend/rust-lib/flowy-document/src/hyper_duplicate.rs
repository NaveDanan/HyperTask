//! Reject source data that the typed document exporter would stringify or omit.
use collab::core::{collab::DataSource, origin::CollabOrigin};
use collab::preclude::*;
use collab_entity::define::DOCUMENT_ROOT;
use flowy_error::{FlowyError, FlowyResult, internal_error};

fn invalid() -> FlowyError {
  FlowyError::invalid_data().with_context("This document contains embedded or unsupported data that cannot be copied safely. The source was kept.")
}
fn unsupported_text() -> FlowyError {
  FlowyError::invalid_data().with_context("This document contains embedded content that this editor cannot display safely. Its original data was kept.")
}
fn map<T: ReadTxn>(root: &MapRef, txn: &T, key: &str) -> FlowyResult<MapRef> {
  root
    .get(txn, key)
    .and_then(|value| value.cast().ok())
    .ok_or_else(invalid)
}

/// String-only deltas cannot faithfully expose native object/structural embeds.
/// Keep unrelated future fields readable; this guard checks only external text.
pub fn hyper_validate_document_text(collab: &Collab) -> FlowyResult<()> {
  let txn = collab.transact();
  let root = map(&collab.data, &txn, DOCUMENT_ROOT)?;
  let meta = map(&root, &txn, "meta")?;
  let Some(value) = meta.get(&txn, "text_map") else {
    return Ok(());
  };
  let texts: MapRef = value.cast().map_err(|_| unsupported_text())?;
  for (_, value) in texts.iter(&txn) {
    let text: TextRef = value.cast().map_err(|_| unsupported_text())?;
    if text
      .diff(&txn, |_| ())
      .iter()
      .any(|delta| !matches!(delta.insert, YrsValue::Any(Any::String(_))))
    {
      return Err(unsupported_text());
    }
  }
  Ok(())
}

/// Native v1 formatting attributes use JSON, which cannot roundtrip every Any.
/// Check before encoding a live snapshot so future values never change unnoticed.
pub fn hyper_validate_document_text_encoding(collab: &Collab) -> FlowyResult<()> {
  let before = collab.transact();
  let root = map(&collab.data, &before, DOCUMENT_ROOT)?;
  let meta = map(&root, &before, "meta")?;
  let Some(value) = meta.get(&before, "text_map") else {
    return Ok(());
  };
  let texts: MapRef = value.cast().map_err(|_| invalid())?;
  if texts.len(&before) == 0 {
    return Ok(());
  }
  let encoded = collab.encode_collab_v1(|_| Ok::<_, FlowyError>(()))?;
  let copied = Collab::new_with_source(
    CollabOrigin::Empty,
    collab.object_id(),
    DataSource::DocStateV1(encoded.doc_state.to_vec()),
    vec![],
    false,
  )
  .map_err(internal_error)?;
  let after = copied.transact();
  let root = map(&copied.data, &after, DOCUMENT_ROOT)?;
  let meta = map(&root, &after, "meta")?;
  let copied_texts = map(&meta, &after, "text_map")?;
  for (id, value) in texts.iter(&before) {
    let source_text: TextRef = value.cast().map_err(|_| invalid())?;
    let copied_text: TextRef = copied_texts
      .get(&after, id)
      .and_then(|value| value.cast().ok())
      .ok_or_else(invalid)?;
    if source_text.diff(&before, |_| ()) != copied_text.diff(&after, |_| ()) {
      return Err(FlowyError::invalid_data().with_context(
        "This document has text attributes that cannot be copied exactly. The source was kept.",
      ));
    }
  }
  Ok(())
}

pub fn hyper_validate_duplicate_document(collab: &Collab) -> FlowyResult<()> {
  hyper_validate_document_text(collab)?;
  hyper_validate_document_text_encoding(collab)?;
  let txn = collab.transact();
  let root = map(&collab.data, &txn, DOCUMENT_ROOT)?;
  let blocks = map(&root, &txn, "blocks")?;
  for (id, value) in blocks.iter(&txn) {
    let block: MapRef = value.cast().map_err(|_| invalid())?;
    for key in ["id", "ty", "parent", "children"] {
      let value: String = block
        .get(&txn, key)
        .and_then(|value| value.cast().ok())
        .ok_or_else(invalid)?;
      if key == "id" && value != id {
        return Err(invalid());
      }
    }
    let data: String = block
      .get(&txn, "data")
      .and_then(|value| value.cast().ok())
      .ok_or_else(invalid)?;
    let value: serde_json::Value = serde_json::from_str(&data).map_err(internal_error)?;
    if !value.is_object() {
      return Err(invalid());
    }
    if let Some(delta) = value.get("delta") {
      let runs = delta.as_array().ok_or_else(invalid)?;
      for run in runs {
        if !run.get("insert").is_some_and(serde_json::Value::is_string)
          || run.get("retain").is_some()
          || run.get("delete").is_some()
          || run
            .get("attributes")
            .is_some_and(|value| !value.is_object())
        {
          return Err(invalid());
        }
      }
    }
  }
  let meta = map(&root, &txn, "meta")?;
  let children = map(&meta, &txn, "children_map")?;
  for (_, value) in children.iter(&txn) {
    let value: ArrayRef = value.cast().map_err(|_| invalid())?;
    if value
      .iter(&txn)
      .any(|value| !matches!(value, YrsValue::Any(Any::String(_))))
    {
      return Err(invalid());
    }
  }
  Ok(())
}

/// The legacy page-copy payload is typed. Reject raw fields it cannot represent;
/// dataset copies instead retain the complete detached CRDT and need no such limit.
pub fn hyper_validate_document_pb_copy(collab: &Collab) -> FlowyResult<()> {
  hyper_validate_duplicate_document(collab)?;
  let txn = collab.transact();
  if collab.data.iter(&txn).any(|(key, _)| key != DOCUMENT_ROOT) {
    return Err(invalid());
  }
  let root = map(&collab.data, &txn, DOCUMENT_ROOT)?;
  if root
    .iter(&txn)
    .any(|(key, _)| !["page_id", "blocks", "meta"].contains(&key))
  {
    return Err(invalid());
  }
  let blocks = map(&root, &txn, "blocks")?;
  for (_, value) in blocks.iter(&txn) {
    let block: MapRef = value.cast().map_err(|_| invalid())?;
    if block.iter(&txn).any(|(key, _)| {
      ![
        "id",
        "ty",
        "parent",
        "children",
        "data",
        "external_id",
        "external_type",
      ]
      .contains(&key)
    }) {
      return Err(invalid());
    }
  }
  let meta = map(&root, &txn, "meta")?;
  if meta
    .iter(&txn)
    .any(|(key, _)| !["children_map", "text_map"].contains(&key))
  {
    return Err(invalid());
  }
  Ok(())
}
