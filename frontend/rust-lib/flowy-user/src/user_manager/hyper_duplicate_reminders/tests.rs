use super::*;

fn source() -> UserAwareness {
  let mut value = UserAwareness::create(
    Collab::new_with_origin(CollabOrigin::Empty, "awareness", vec![], false),
    None,
  )
  .unwrap();
  let collab: &mut Collab = value.borrow_mut();
  let mut txn = collab.context.transact_mut();
  let root = map(&collab.data, &txn, USER_AWARENESS).unwrap();
  let reminders: ArrayRef = root.get(&txn, "reminders").unwrap().cast().unwrap();
  let source = reminders.push_back(
    &mut txn,
    MapPrelim::from([("id", "source"), ("object_id", "view")]),
  );
  source.insert(&mut txn, "ty", Any::BigInt(2));
  source.insert(&mut txn, "scheduled_at", Any::BigInt(1935741903));
  source.insert(&mut txn, "future", MapPrelim::from([("keep", true)]));
  source.insert(
    &mut txn,
    "meta",
    MapPrelim::from([("row_id", "row"), ("unknown", "kept")]),
  );
  drop(txn);
  value
}
fn binding() -> HyperDuplicateReminderBinding {
  HyperDuplicateReminderBinding {
    source_id: "source".into(),
    target_id: "target".into(),
    source_object_ids: vec!["view".into()],
    source_row_id: "row".into(),
    source_block_id: None,
    source_document_id: None,
    target_object_id: "copy-view".into(),
    target_row_id: "copy-row".into(),
  }
}
#[test]
fn hyper_duplicate_timers_preserve_unknown_state_type_schedule_and_source() {
  let source = source();
  let copied = clone_awareness(&source, &[binding()]).unwrap();
  let txn = copied.transact();
  let root = map(&copied.data, &txn, USER_AWARENESS).unwrap();
  let reminders: ArrayRef = root.get(&txn, "reminders").unwrap().cast().unwrap();
  assert_eq!(reminders.len(&txn), 2);
  let target: MapRef = reminders.get(&txn, 1).unwrap().cast().unwrap();
  assert_eq!(target.get(&txn, "ty"), Some(YrsValue::Any(Any::BigInt(2))));
  assert_eq!(
    target.get(&txn, "scheduled_at"),
    Some(YrsValue::Any(Any::BigInt(1935741903)))
  );
  assert_eq!(
    map(&target, &txn, "future").unwrap().get(&txn, "keep"),
    Some(YrsValue::Any(Any::Bool(true)))
  );
  assert_eq!(
    map(&target, &txn, "meta")
      .unwrap()
      .get(&txn, "unknown")
      .unwrap()
      .cast::<String>()
      .unwrap(),
    "kept"
  );
  assert_eq!(
    map(&target, &txn, "meta")
      .unwrap()
      .get(&txn, "row_id")
      .unwrap()
      .cast::<String>()
      .unwrap(),
    "copy-row"
  );
  let txn = source.transact();
  let root = map(&source.data, &txn, USER_AWARENESS).unwrap();
  let reminders: ArrayRef = root.get(&txn, "reminders").unwrap().cast().unwrap();
  assert_eq!(reminders.len(&txn), 1);
}
#[test]
fn hyper_duplicate_timers_reject_conflicting_and_missing_source_bindings() {
  let source = source();
  let mut wrong = binding();
  wrong.source_row_id = "other".into();
  assert!(clone_awareness(&source, &[wrong]).is_err());
  let mut missing = binding();
  missing.source_id = "missing".into();
  assert!(clone_awareness(&source, &[missing]).is_err());
  let copied = clone_awareness(&source, &[binding()]).unwrap();
  let copied = UserAwareness::open(copied, None).unwrap();
  assert!(clone_awareness(&copied, &[binding()]).is_err());
}

#[test]
fn hyper_duplicate_timers_support_the_upstream_any_map_metadata_without_normalizing_it() {
  let mut source = source();
  {
    let collab: &mut Collab = source.borrow_mut();
    let mut txn = collab.context.transact_mut();
    let root = map(&collab.data, &txn, USER_AWARENESS).unwrap();
    let reminders: ArrayRef = root.get(&txn, "reminders").unwrap().cast().unwrap();
    let timer: MapRef = reminders.get(&txn, 0).unwrap().cast().unwrap();
    timer.insert(
      &mut txn,
      "meta",
      Any::Map(Arc::new(std::collections::HashMap::from([
        ("row_id".into(), Any::String("row".into())),
        ("future".into(), Any::BigInt(i64::MAX)),
      ]))),
    );
  }
  let copied = clone_awareness(&source, &[binding()]).unwrap();
  let txn = copied.transact();
  let root = map(&copied.data, &txn, USER_AWARENESS).unwrap();
  let reminders: ArrayRef = root.get(&txn, "reminders").unwrap().cast().unwrap();
  let timer: MapRef = reminders.get(&txn, 1).unwrap().cast().unwrap();
  let YrsValue::Any(Any::Map(meta)) = timer.get(&txn, "meta").unwrap() else {
    panic!("must retain Any-map metadata");
  };
  assert_eq!(meta["row_id"], Any::String("copy-row".into()));
  assert_eq!(meta["future"], Any::BigInt(i64::MAX));
}

#[test]
fn hyper_duplicate_storage_rolls_back_all_new_collabs_on_conflict_or_owner_change() {
  let dir = tempfile::tempdir().unwrap();
  let db = CollabKVDB::open(dir.path()).unwrap();
  let workspace = Uuid::new_v4();
  let object = |id: &str| {
    let mut collab = Collab::new_with_origin(CollabOrigin::Empty, id, vec![], false);
    collab
      .data
      .insert(&mut collab.context.transact_mut(), "retained", id);
    EncodedCollabInfo {
      object_id: id.into(),
      collab_type: CollabType::Document,
      encoded_collab: collab
        .encode_collab_v1(|_| Ok::<_, FlowyError>(()))
        .unwrap(),
    }
  };
  hyper_persist_duplicate_collabs(
    &db,
    1,
    &workspace,
    &[object("existing")],
    &HashSet::new(),
    &|| true,
  )
  .unwrap();
  assert!(
    hyper_persist_duplicate_collabs(
      &db,
      1,
      &workspace,
      &[object("new"), object("existing")],
      &HashSet::new(),
      &|| true
    )
    .is_err()
  );
  assert!(!db.read_txn().is_exist(1, &workspace.to_string(), "new"));
  assert!(
    db.read_txn()
      .is_exist(1, &workspace.to_string(), "existing")
  );
  let calls = std::sync::atomic::AtomicUsize::new(0);
  assert!(
    hyper_persist_duplicate_collabs(
      &db,
      1,
      &workspace,
      &[object("new")],
      &HashSet::new(),
      &|| calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0
    )
    .is_err()
  );
  assert!(!db.read_txn().is_exist(1, &workspace.to_string(), "new"));
}
