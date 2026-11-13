//! Copy initialization runs before the new document is created, outside its undo history.
use std::collections::HashMap;

use flowy_document::entities::DocumentDataPB;
use flowy_error::FlowyError;
use serde_json::{Value, json};
use uuid::Uuid;

fn invalid(message: &str) -> FlowyError {
  FlowyError::invalid_data().with_context(message)
}

fn reminder_id(run: &Value) -> Option<&str> {
  let inserted = run.get("insert")?.as_str()?;
  let mention = run.get("attributes")?.get("mention")?;
  if inserted.is_empty()
    || !inserted.chars().all(|c| c == '$')
    || !matches!(mention.get("type")?.as_str()?, "date" | "reminder")
    || !mention.get("date")?.is_string()
  {
    return None;
  }
  mention
    .get("reminder_id")?
    .as_str()
    .filter(|id| !id.is_empty())
}

fn text_runs(value: &Value) -> Result<&Vec<Value>, FlowyError> {
  let runs = value
    .as_array()
    .ok_or_else(|| invalid("Invalid copied text"))?;
  for run in runs {
    if !run.is_object()
      || !run.get("insert").is_some_and(Value::is_string)
      || run.get("retain").is_some()
      || run.get("delete").is_some()
      || run.get("attributes").is_some_and(|a| !a.is_object())
    {
      return Err(invalid("Embedded or invalid text cannot be copied safely"));
    }
  }
  Ok(runs)
}

pub(super) fn hyper_duplicate_reminder_id(
  document_id: &Uuid,
  block_id: &str,
  offset: usize,
  old_id: &str,
) -> Result<String, FlowyError> {
  let name = serde_json::to_string(&json!([
    "HyperTask:document-reminder-copy:v1",
    block_id,
    offset,
    old_id
  ]))
  .map_err(|_| invalid("Invalid copied reminder ID"))?;
  Ok(Uuid::new_v5(document_id, name.as_bytes()).to_string())
}

fn remap_text(value: &Value, document_id: &Uuid, block_id: &str) -> Result<Value, FlowyError> {
  let mut result = Vec::new();
  let mut offset = 0usize;
  for run in text_runs(value)? {
    let inserted = run["insert"].as_str().unwrap();
    if let Some(old_id) = reminder_id(run) {
      for _ in inserted.chars() {
        let mut atom = run.clone();
        atom["insert"] = json!("$");
        atom["attributes"]["mention"]["reminder_id"] = json!(hyper_duplicate_reminder_id(
          document_id,
          block_id,
          offset,
          old_id
        )?);
        result.push(atom);
        offset += 1;
      }
    } else {
      offset += inserted.encode_utf16().count();
      result.push(run.clone());
    }
  }
  Ok(Value::Array(result))
}

pub(super) fn hyper_remap_document_reminders(
  mut data: DocumentDataPB,
  document_id: &Uuid,
) -> Result<DocumentDataPB, FlowyError> {
  if !data.blocks.contains_key(&data.page_id) {
    return Err(invalid("The copied page has no root block"));
  }
  let mut owners = HashMap::new();
  for (key, block) in &mut data.blocks {
    if key != &block.id {
      return Err(invalid("The copied page has inconsistent block IDs"));
    }
    let mut block_data: Value = serde_json::from_str(if block.data.is_empty() {
      "{}"
    } else {
      &block.data
    })
    .map_err(|_| invalid("The copied page has invalid block data"))?;
    if !block_data.is_object() {
      return Err(invalid("The copied page has invalid block data"));
    }
    if let Some(delta) = block_data.get("delta") {
      let remapped = remap_text(delta, document_id, &block.id)?;
      block_data["delta"] = remapped;
    }
    block.data = serde_json::to_string(&block_data)
      .map_err(|_| invalid("The copied page has invalid block data"))?;
    if let Some(text_id) = &block.external_id {
      if let Some(text) = data.meta.text_map.get(text_id) {
        let value: Value =
          serde_json::from_str(text).map_err(|_| invalid("The copied page has invalid text"))?;
        if owners.insert(text_id.clone(), block.id.clone()).is_some()
          && text_runs(&value)?
            .iter()
            .any(|run| reminder_id(run).is_some())
        {
          return Err(invalid("A copied reminder text belongs to multiple blocks"));
        }
      }
    }
  }
  for (text_id, text) in &mut data.meta.text_map {
    let value: Value =
      serde_json::from_str(text).map_err(|_| invalid("The copied page has invalid text"))?;
    let fallback = format!("text:{}", text_id);
    let block_id = owners.get(text_id).unwrap_or(&fallback);
    *text = serde_json::to_string(&remap_text(&value, document_id, block_id)?)
      .map_err(|_| invalid("The copied page has invalid text"))?;
  }
  Ok(data)
}

#[cfg(test)]
mod tests {
  use super::*;
  use flowy_document::entities::{BlockPB, ChildrenPB, MetaPB};

  fn source(delta: Value) -> DocumentDataPB {
    DocumentDataPB {
      page_id: "block".into(),
      blocks: HashMap::from([(
        "block".into(),
        BlockPB {
          id: "block".into(),
          ty: "paragraph".into(),
          data: "{\"unknown\":true}".into(),
          children_id: "children".into(),
          external_id: Some("text".into()),
          external_type: Some("text".into()),
          ..Default::default()
        },
      )]),
      meta: MetaPB {
        children_map: HashMap::from([("children".into(), ChildrenPB::default())]),
        text_map: HashMap::from([("text".into(), delta.to_string())]),
      },
    }
  }
  #[test]
  fn copied_date_ids_are_deterministic_per_utf16_atom_and_keep_unknown_metadata() {
    let document_id = Uuid::parse_str("91444e6d-f9ec-40b9-94c0-420f29128fc9").unwrap();
    let input = json!([
      {"insert":"😀x"},
      {"insert":"$$", "unknown_run":true,"attributes":{"bold":true,"hyper_reminder":{"version":1,"custom_scheduled_at_seconds":"1935741900","unknown":true},"mention":{"type":"reminder","date":"2031-05-06T10:30:00.000","reminder_id":"original","unknown":"keep"}}}
    ]);
    let copied = hyper_remap_document_reminders(source(input.clone()), &document_id).unwrap();
    let runs: Value = serde_json::from_str(&copied.meta.text_map["text"]).unwrap();
    assert_eq!(runs[0], input[0]);
    assert_eq!(runs.as_array().unwrap().len(), 3);
    for (index, offset) in [(1, 3), (2, 4)] {
      let name = json!([
        "HyperTask:document-reminder-copy:v1",
        "block",
        offset,
        "original"
      ])
      .to_string();
      assert_eq!(
        runs[index]["attributes"]["mention"]["reminder_id"],
        Uuid::new_v5(&document_id, name.as_bytes()).to_string()
      );
      if offset == 3 {
        assert_eq!(
          runs[index]["attributes"]["mention"]["reminder_id"],
          "f104cd8e-c75a-5eb8-9bf0-6a08455b3e17"
        );
      }
      let mut expected = input[1].clone();
      expected["insert"] = json!("$");
      expected["attributes"]["mention"]["reminder_id"] =
        runs[index]["attributes"]["mention"]["reminder_id"].clone();
      assert_eq!(runs[index], expected);
    }
    let another = hyper_remap_document_reminders(source(input.clone()), &Uuid::new_v4()).unwrap();
    assert_ne!(copied.meta.text_map["text"], another.meta.text_map["text"]);
    assert_eq!(input[1]["attributes"]["mention"]["reminder_id"], "original");
  }
  #[test]
  fn embedded_and_invalid_text_are_rejected_before_copy_creation() {
    for delta in [
      json!([{"insert":{"image":"keep"}}]),
      json!([{"insert":"x","attributes":null}]),
      json!({"insert":"x"}),
    ] {
      assert!(hyper_remap_document_reminders(source(delta), &Uuid::new_v4()).is_err());
    }
    let mut inline = source(json!([]));
    inline.blocks.get_mut("block").unwrap().data =
      json!({"delta":[{"insert":{"legacy":"keep"}}]}).to_string();
    assert!(hyper_remap_document_reminders(inline, &Uuid::new_v4()).is_err());
  }
  #[test]
  fn duplicate_text_owners_are_rejected_for_reminders() {
    let mut data = source(
      json!([{"insert":"$","attributes":{"mention":{"type":"date","date":"2030-01-01","reminder_id":"source"}}}]),
    );
    let mut second = data.blocks["block"].clone();
    second.id = "second".into();
    data.blocks.insert("second".into(), second);
    assert!(hyper_remap_document_reminders(data, &Uuid::new_v4()).is_err());
  }
}
