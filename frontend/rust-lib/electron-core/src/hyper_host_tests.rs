//! Actual runtime cancellation and RocksDB lifetime regressions for SDK replacement.
use super::*;
use collab_integrate::CollabKVDB;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

struct Root(PathBuf);
impl Root {
  fn new() -> Self {
    let root = std::env::temp_dir().join(format!(
      "hyper-host-retirement-{}-{}",
      std::process::id(),
      SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    Self(root)
  }
}
impl Drop for Root {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.0);
  }
}

#[test]
fn hyper_host_retirement_drops_old_local_requests_before_reopening_the_same_database() {
  let root = Root::new();
  let db = Arc::new(CollabKVDB::open(&root.0).unwrap());
  let old_db = Arc::downgrade(&db);
  let runtime = Arc::new(AFPluginRuntime::new().unwrap());
  let (sender, mut receiver) = mpsc::unbounded_channel::<Task>();
  let (ready, started) = std_mpsc::channel();
  let cloned_runtime = runtime.clone();
  let runner = std::thread::spawn(move || {
    let local = LocalSet::new();
    local.spawn_local(async move {
      let retained_database = db;
      ready.send(()).unwrap();
      std::future::pending::<()>().await;
      drop(retained_database);
    });
    cloned_runtime.block_on(local.run_until(async move {
      let _ = receiver.recv().await;
    }));
  });
  started.recv_timeout(Duration::from_secs(2)).unwrap();
  assert!(CollabKVDB::open(&root.0).is_err());
  let mut host = CoreHost {
    sender: Some(sender),
    runner: Some(runner),
    runtime: Some(runtime),
    ..Default::default()
  };
  assert!(host.retire(Duration::from_secs(2)));
  assert!(
    old_db.upgrade().is_none(),
    "cancelled requests must release their physical database"
  );
  let reopened = CollabKVDB::open(&root.0).unwrap();
  drop(reopened);
  assert!(host.runner.is_none() && host.runtime.is_none() && host.shutdown.is_none());
}

#[test]
fn hyper_host_retirement_keeps_a_busy_runtime_closed_until_its_last_owner_releases_it() {
  let runtime = Arc::new(AFPluginRuntime::new().unwrap());
  let retained = runtime.clone();
  let mut host = CoreHost {
    runtime: Some(runtime),
    ..Default::default()
  };
  assert!(!host.retire(Duration::from_millis(20)));
  assert!(host.runtime.is_some());
  assert!(host.core.is_none());
  drop(retained);
  assert!(host.retire(Duration::from_secs(2)));
  assert!(host.runtime.is_none());
}

#[test]
fn hyper_host_retirement_waits_for_blocking_database_holders_instead_of_exposing_a_new_owner() {
  let root = Root::new();
  let db = Arc::new(CollabKVDB::open(&root.0).unwrap());
  let old_db = Arc::downgrade(&db);
  let runtime = Arc::new(AFPluginRuntime::new().unwrap());
  let (ready, started) = std_mpsc::channel();
  let (release, released) = std_mpsc::channel();
  runtime.inner.spawn_blocking(move || {
    let retained_database = db;
    ready.send(()).unwrap();
    let _ = released.recv();
    drop(retained_database);
  });
  started.recv_timeout(Duration::from_secs(2)).unwrap();
  let mut host = CoreHost {
    runtime: Some(runtime),
    ..Default::default()
  };
  assert!(!host.retire(Duration::from_millis(20)));
  assert!(
    host.shutdown.is_some(),
    "the shutdown join handle must survive the failed init"
  );
  assert!(old_db.upgrade().is_some());
  assert!(CollabKVDB::open(&root.0).is_err());
  release.send(()).unwrap();
  assert!(host.retire(Duration::from_secs(2)));
  assert!(old_db.upgrade().is_none());
  drop(CollabKVDB::open(&root.0).unwrap());
}

#[test]
fn hyper_host_invalid_init_does_not_retire_the_existing_runtime() {
  let runtime = Arc::new(AFPluginRuntime::new().unwrap());
  let original = Arc::downgrade(&runtime);
  let mut host = CoreHost {
    runtime: Some(runtime),
    ..Default::default()
  };
  assert_eq!(host.init("{invalid"), -1);
  assert!(Arc::ptr_eq(
    host.runtime.as_ref().unwrap(),
    &original.upgrade().unwrap()
  ));
  assert!(host.retire(Duration::from_secs(2)));
}
