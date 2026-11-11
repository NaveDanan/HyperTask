use super::HyperHistorySyncPlugin;
use collab::core::awareness::{AwarenessUpdate, Event};
use collab::core::collab::DataSource;
use collab::core::collab_plugin::{CollabPlugin, CollabPluginType};
use collab::core::origin::{CollabClient, CollabOrigin};
use collab::preclude::updates::decoder::Decode;
use collab::preclude::{Collab, Doc, Map, Origin, Transact, TransactionMut, Update};
use collab_document::blocks::DocumentData;
use collab_document::document::Document;
use collab_document::document_data::default_document_data;
use collab_entity::CollabType;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Recorded {
  local: Vec<(CollabOrigin, String, Vec<u8>)>,
  raw: Vec<Option<Origin>>,
  init: usize,
  did_init: usize,
  after: usize,
  awareness: usize,
  start: usize,
  destroy: usize,
}

struct Recorder(Arc<Mutex<Recorded>>);

impl CollabPlugin for Recorder {
  fn init(&self, _: &str, _: &CollabOrigin, _: &Doc) {
    self.0.lock().unwrap().init += 1;
  }
  fn did_init(&self, _: &Collab, _: &str) {
    self.0.lock().unwrap().did_init += 1;
  }
  fn receive_update(&self, _: &str, txn: &TransactionMut, _: &[u8]) {
    self.0.lock().unwrap().raw.push(txn.origin().cloned());
  }
  fn receive_local_update(&self, origin: &CollabOrigin, id: &str, update: &[u8]) {
    self
      .0
      .lock()
      .unwrap()
      .local
      .push((origin.clone(), id.to_owned(), update.to_vec()));
  }
  fn receive_local_state(&self, _: &CollabOrigin, _: &str, _: &Event, _: &AwarenessUpdate) {
    self.0.lock().unwrap().awareness += 1;
  }
  fn after_transaction(&self, _: &str, _: &mut TransactionMut) {
    self.0.lock().unwrap().after += 1;
  }
  fn plugin_type(&self) -> CollabPluginType {
    CollabPluginType::CloudStorage
  }
  fn start_init_sync(&self) {
    self.0.lock().unwrap().start += 1;
  }
  fn destroy(&self) {
    self.0.lock().unwrap().destroy += 1;
  }
}

fn origin(device: &str) -> CollabOrigin {
  CollabOrigin::Client(CollabClient::new(71, device))
}

fn plugin(recorded: &Arc<Mutex<Recorded>>, wrapped: bool) -> Box<dyn CollabPlugin> {
  let inner: Box<dyn CollabPlugin> = Box::new(Recorder(recorded.clone()));
  if wrapped {
    Box::new(HyperHistorySyncPlugin::new(inner))
  } else {
    inner
  }
}

fn create(
  id: &str,
  device: &str,
  data: DocumentData,
  plugins: Vec<Box<dyn CollabPlugin>>,
) -> Document {
  let mut collab = Collab::new_with_origin(origin(device), id, plugins, false);
  // Match the production builder: enable history before constructing the Document,
  // then initialize plugins after the document and its undo manager exist.
  collab.enable_undo_redo();
  let mut document = Document::create_with_data(collab, data).unwrap();
  document.undo_manager_mut().unwrap().clear();
  document.initialize();
  document
}

fn reopen(
  id: &str,
  device: &str,
  source: DataSource,
  plugins: Vec<Box<dyn CollabPlugin>>,
) -> Document {
  let collab = Collab::new_with_source(origin(device), id, source, plugins, false).unwrap();
  let mut document = Document::open(collab).unwrap();
  document.initialize();
  document
}

fn replica(source: &Document, recorded: &Arc<Mutex<Recorded>>) -> Document {
  reopen(
    source.object_id(),
    "replica-b",
    DataSource::DocStateV1(source.encode_collab().unwrap().doc_state.to_vec()),
    vec![plugin(recorded, true)],
  )
}

fn card_data(id: &str) -> (DocumentData, String) {
  let mut data = default_document_data(id);
  let card_id = data
    .blocks
    .keys()
    .find(|key| **key != data.page_id)
    .unwrap()
    .clone();
  let card = data.blocks.get_mut(&card_id).unwrap();
  card.ty = "link_preview".to_owned();
  card.data = HashMap::from([
    ("url".to_owned(), json!("https://example.invalid/card")),
    (
      "hyper_bookmark".to_owned(),
      json!({
        "version": 1, "title": "Exact title", "description": "Exact body 🌍",
        "thumbnail": {"source": "cloud", "url": "https://example.invalid/api/file_storage/fake.png", "width": 2, "height": 3}
      }),
    ),
  ]);
  (data, card_id)
}

fn remove_thumbnail(document: &mut Document, id: &str) {
  let mut data = document.get_block(id).unwrap().data;
  data.get_mut("hyper_bookmark").unwrap()["thumbnail"] = Value::Null;
  document.update_block(id, data).unwrap();
}

fn relay(recorded: &Arc<Mutex<Recorded>>, target: &mut Document, expected_origin: &CollabOrigin) {
  let updates = std::mem::take(&mut recorded.lock().unwrap().local);
  assert_eq!(
    updates.len(),
    1,
    "each local edit/history transaction must be sent exactly once"
  );
  for (sent_origin, id, bytes) in updates {
    assert_eq!(&sent_origin, expected_origin);
    assert_eq!(id, target.object_id());
    // The receiving sync path applies remote bytes without the target's local origin.
    target
      .context
      .doc()
      .transact_mut()
      .apply_update(Update::decode_v1(&bytes).unwrap())
      .unwrap();
  }
}

#[test]
fn hyper_history_sync_legacy_control_persists_undo_without_a_local_cloud_callback() {
  let id = uuid::Uuid::new_v4().to_string();
  let (data, card) = card_data(&id);
  let recorded = Arc::new(Mutex::new(Recorded::default()));
  let remote = Arc::new(Mutex::new(Recorded::default()));
  let mut a = create(&id, "a", data, vec![plugin(&recorded, false)]);
  let mut b = replica(&a, &remote);
  remove_thumbnail(&mut a, &card);
  relay(&recorded, &mut b, &origin("a"));
  assert!(a.undo());
  assert!(!a.get_block(&card).unwrap().data["hyper_bookmark"]["thumbnail"].is_null());
  assert!(b.get_block(&card).unwrap().data["hyper_bookmark"]["thumbnail"].is_null());
  let records = recorded.lock().unwrap();
  assert!(records.local.is_empty());
  let undo_origin = records.raw.last().unwrap().as_ref().unwrap();
  assert_eq!(undo_origin, &a.undo_manager().unwrap().as_origin());
  assert_eq!(CollabOrigin::from(undo_origin), CollabOrigin::Empty);
}

#[test]
fn hyper_history_sync_document_thumbnail_undo_redo_reaches_replica_once() {
  let id = uuid::Uuid::new_v4().to_string();
  let (data, card) = card_data(&id);
  let recorded = Arc::new(Mutex::new(Recorded::default()));
  let remote = Arc::new(Mutex::new(Recorded::default()));
  let mut a = create(&id, "a", data, vec![plugin(&recorded, true)]);
  let mut b = replica(&a, &remote);
  let original = a.get_block(&card).unwrap().data;
  remove_thumbnail(&mut a, &card);
  relay(&recorded, &mut b, &origin("a"));
  assert!(b.get_block(&card).unwrap().data["hyper_bookmark"]["thumbnail"].is_null());
  assert!(a.undo());
  relay(&recorded, &mut b, &origin("a"));
  assert_eq!(a.get_block(&card).unwrap().data, original);
  assert_eq!(b.get_block(&card).unwrap().data, original);
  assert!(a.redo());
  relay(&recorded, &mut b, &origin("a"));
  assert!(b.get_block(&card).unwrap().data["hyper_bookmark"]["thumbnail"].is_null());
  assert!(a.undo());
  relay(&recorded, &mut b, &origin("a"));
  assert_eq!(b.get_block(&card).unwrap().data, original);
  assert!(
    remote.lock().unwrap().local.is_empty(),
    "remote history must not echo back"
  );
}

#[test]
fn hyper_history_sync_plain_text_and_row_body_document_history_reaches_replica() {
  // Row bodies use the same native Document and CollabType::Document sync construction.
  for _ in 0..2 {
    let id = uuid::Uuid::new_v4().to_string();
    let data = default_document_data(&id);
    let text_id = data
      .blocks
      .values()
      .find_map(|block| block.external_id.clone())
      .unwrap();
    let recorded = Arc::new(Mutex::new(Recorded::default()));
    let remote = Arc::new(Mutex::new(Recorded::default()));
    let mut a = create(&id, "a", data, vec![plugin(&recorded, true)]);
    let mut b = replica(&a, &remote);
    a.apply_text_delta(&text_id, r#"[{"insert":"Ordinary text 🌍"}]"#.to_owned());
    relay(&recorded, &mut b, &origin("a"));
    assert_eq!(a.paragraphs(), b.paragraphs());
    assert!(b.paragraphs().join("").contains("Ordinary text 🌍"));
    assert!(a.undo());
    relay(&recorded, &mut b, &origin("a"));
    assert!(!b.paragraphs().join("").contains("Ordinary text"));
    assert!(a.redo());
    relay(&recorded, &mut b, &origin("a"));
    assert_eq!(a.paragraphs(), b.paragraphs());
    assert!(remote.lock().unwrap().local.is_empty());
  }
}

#[test]
fn hyper_history_sync_excludes_remote_empty_unknown_and_other_manager_origins() {
  let id = uuid::Uuid::new_v4().to_string();
  let recorded = Arc::new(Mutex::new(Recorded::default()));
  let mut a = create(
    &id,
    "a",
    default_document_data(&id),
    vec![plugin(&recorded, true)],
  );
  let foreign_id = uuid::Uuid::new_v4().to_string();
  let foreign = create(
    &foreign_id,
    "foreign",
    default_document_data(&foreign_id),
    vec![],
  );
  let origins = [
    None,
    Some(CollabOrigin::Empty.into()),
    Some(CollabOrigin::Server.into()),
    Some(origin("remote").into()),
    Some(foreign.undo_manager().unwrap().as_origin()),
    Some(Origin::from("unknown future origin")),
  ];
  for (index, incoming_origin) in origins.into_iter().enumerate() {
    let source = Doc::new();
    let map = source.get_or_insert_map("data");
    let bytes = {
      let mut txn = source.transact_mut();
      map.insert(&mut txn, format!("remote-{index}"), "remote value");
      txn.encode_update_v1()
    };
    let doc = a.context.doc();
    let mut txn = match incoming_origin {
      Some(value) => doc.transact_mut_with(value),
      None => doc.transact_mut(),
    };
    txn
      .apply_update(Update::decode_v1(&bytes).unwrap())
      .unwrap();
  }
  assert_eq!(recorded.lock().unwrap().raw.len(), 6);
  assert!(recorded.lock().unwrap().local.is_empty());
  // Remote transactions must not enter the local native history stack either.
  assert!(!a.can_undo());
  let page_id = a.get_page_id().unwrap();
  a.update_block(
    &page_id,
    HashMap::from([("title".to_owned(), json!("local"))]),
  )
  .unwrap();
  assert_eq!(recorded.lock().unwrap().local.len(), 1);
}

#[test]
fn hyper_history_sync_forwards_plugin_lifecycle_awareness_and_clears_destroyed_identity() {
  let id = uuid::Uuid::new_v4().to_string();
  let recorded = Arc::new(Mutex::new(Recorded::default()));
  let wrapped = Arc::new(HyperHistorySyncPlugin::new(Box::new(Recorder(
    recorded.clone(),
  ))));
  // CollabPlugin has no blanket Arc implementation, so keep the decorator for the
  // explicit destroyed-identity assertion and delegate through a small test handle.
  struct Handle(Arc<HyperHistorySyncPlugin>);
  impl CollabPlugin for Handle {
    fn init(&self, id: &str, origin: &CollabOrigin, doc: &Doc) {
      self.0.init(id, origin, doc);
    }
    fn did_init(&self, collab: &Collab, id: &str) {
      self.0.did_init(collab, id);
    }
    fn receive_update(&self, id: &str, txn: &TransactionMut, bytes: &[u8]) {
      self.0.receive_update(id, txn, bytes);
    }
    fn receive_local_update(&self, origin: &CollabOrigin, id: &str, bytes: &[u8]) {
      self.0.receive_local_update(origin, id, bytes);
    }
    fn receive_local_state(
      &self,
      origin: &CollabOrigin,
      id: &str,
      event: &Event,
      update: &AwarenessUpdate,
    ) {
      self.0.receive_local_state(origin, id, event, update);
    }
    fn after_transaction(&self, id: &str, txn: &mut TransactionMut) {
      self.0.after_transaction(id, txn);
    }
    fn plugin_type(&self) -> CollabPluginType {
      self.0.plugin_type()
    }
    fn start_init_sync(&self) {
      self.0.start_init_sync();
    }
    fn destroy(&self) {
      self.0.destroy();
    }
  }
  let mut a = create(
    &id,
    "a",
    default_document_data(&id),
    vec![Box::new(Handle(wrapped.clone()))],
  );
  assert!(a.has_cloud_plugin());
  a.get_awareness()
    .set_local_state(json!({"test": true}))
    .unwrap();
  a.start_init_sync();
  let page_id = a.get_page_id().unwrap();
  a.update_block(
    &page_id,
    HashMap::from([("title".to_owned(), json!("local"))]),
  )
  .unwrap();
  recorded.lock().unwrap().local.clear();
  a.remove_all_plugins();
  // An already removed decorator must not revive the native-history route.
  assert!(wrapped.identity.load_full().is_none());
  assert!(a.undo());
  let records = recorded.lock().unwrap();
  assert_eq!(records.init, 1);
  assert_eq!(records.did_init, 1);
  assert!(records.after > 0);
  assert_eq!(records.awareness, 1);
  assert_eq!(records.start, 1);
  assert_eq!(records.destroy, 1);
  assert!(records.local.is_empty());
}

#[test]
fn hyper_history_sync_undo_redo_persists_in_rocksdb_and_reopens_with_fresh_history_identity() {
  use collab_plugins::CollabKVDB;
  use collab_plugins::local_storage::rocksdb::rocksdb_plugin::RocksdbDiskPlugin;
  use collab_plugins::local_storage::rocksdb::util::KVDBCollabPersistenceImpl;
  struct Directory(std::path::PathBuf);
  impl Drop for Directory {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }
  let directory =
    Directory(std::env::temp_dir().join(format!("hyper-history-sync-{}", uuid::Uuid::new_v4())));
  std::fs::create_dir(&directory.0).unwrap();
  let id = uuid::Uuid::new_v4().to_string();
  let workspace = uuid::Uuid::new_v4().to_string();
  let (data, card) = card_data(&id);
  let original = data.blocks[&card].data.clone();
  {
    let db = Arc::new(CollabKVDB::open(&directory.0).unwrap());
    let recorded = Arc::new(Mutex::new(Recorded::default()));
    let disk = RocksdbDiskPlugin::new(
      71,
      workspace.clone(),
      id.clone(),
      CollabType::Document,
      Arc::downgrade(&db),
    );
    let mut a = create(
      &id,
      "a",
      data,
      vec![Box::new(disk), plugin(&recorded, true)],
    );
    remove_thumbnail(&mut a, &card);
    assert!(a.undo());
    assert_eq!(a.get_block(&card).unwrap().data, original);
    assert_eq!(recorded.lock().unwrap().local.len(), 2);
  }
  {
    let db = Arc::new(CollabKVDB::open(&directory.0).unwrap());
    let recorded = Arc::new(Mutex::new(Recorded::default()));
    let source =
      KVDBCollabPersistenceImpl::new(Arc::downgrade(&db), 71, workspace.clone()).into_data_source();
    let disk = RocksdbDiskPlugin::new(
      71,
      workspace,
      id.clone(),
      CollabType::Document,
      Arc::downgrade(&db),
    );
    let mut reopened = reopen(
      &id,
      "a-reopened",
      source,
      vec![Box::new(disk), plugin(&recorded, true)],
    );
    assert_eq!(reopened.get_block(&card).unwrap().data, original);
    assert!(!reopened.can_undo());
    let remote = Arc::new(Mutex::new(Recorded::default()));
    let mut b = replica(&reopened, &remote);
    remove_thumbnail(&mut reopened, &card);
    relay(&recorded, &mut b, &origin("a-reopened"));
    assert!(reopened.undo());
    relay(&recorded, &mut b, &origin("a-reopened"));
    assert_eq!(b.get_block(&card).unwrap().data, original);
    assert!(reopened.redo());
    relay(&recorded, &mut b, &origin("a-reopened"));
    assert!(b.get_block(&card).unwrap().data["hyper_bookmark"]["thumbnail"].is_null());
    assert!(remote.lock().unwrap().local.is_empty());
  }
}
