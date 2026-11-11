use super::KVTransactionDBRocksdbImpl;
use crate::local_storage::kv::PersistenceError;
use rocksdb::{
  IteratorMode, Options, SingleThreaded, TransactionDB, TransactionDBOptions,
  WriteBatchWithTransaction, WriteOptions,
};
use std::path::{Path, PathBuf};
use std::{fs, io};

struct NewCheckpointDirectory {
  path: PathBuf,
  complete: bool,
}
impl Drop for NewCheckpointDirectory {
  fn drop(&mut self) {
    if !self.complete {
      let _ = fs::remove_dir_all(&self.path);
    }
  }
}
fn io_error(error: io::Error) -> PersistenceError {
  PersistenceError::Internal(error.into())
}

impl KVTransactionDBRocksdbImpl {
  /// Copy every raw key/value from one native snapshot into a NEW database.
  /// The target is closed before return, so callers may archive it without racing
  /// source compaction. Existing targets, including dangling symlinks, are rejected.
  pub fn create_logical_checkpoint(
    &self,
    target: impl AsRef<Path>,
  ) -> Result<(), PersistenceError> {
    self.create_logical_checkpoint_with_hook(target.as_ref(), |_| Ok(()))
  }

  fn create_logical_checkpoint_with_hook(
    &self,
    target: &Path,
    mut after_batch: impl FnMut(usize) -> Result<(), PersistenceError>,
  ) -> Result<(), PersistenceError> {
    // Exclusive creation rejects every existing path without following it. Keep
    // checkpoint contents private even when its caller's parent is shared.
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
      use std::os::unix::fs::DirBuilderExt;
      builder.mode(0o700);
    }
    builder.create(target).map_err(io_error)?;
    let mut directory = NewCheckpointDirectory {
      path: target.to_path_buf(),
      complete: false,
    };
    let mut options = Options::default();
    options.create_if_missing(true);
    options.set_compression_type(rocksdb::DBCompressionType::Zstd);
    options.set_write_buffer_size(2 * 1024 * 1024);
    options.set_max_write_buffer_number(2);
    options.set_max_open_files(50);
    let destination =
      TransactionDB::<SingleThreaded>::open(&options, &TransactionDBOptions::default(), target)?;
    let snapshot = self.db.snapshot();
    let mut writes = WriteOptions::default();
    writes.set_sync(true);
    let mut batch = WriteBatchWithTransaction::<true>::default();
    let mut bytes = 0usize;
    let mut entries = 0usize;
    let mut copied = 0usize;
    // Do not use KVStore::range: its iterator currently discards errors and its
    // unbounded end omits records. The native snapshot iterator exposes each error.
    for entry in snapshot.iterator(IteratorMode::Start) {
      let (key, value) = entry?;
      bytes = bytes.saturating_add(key.len()).saturating_add(value.len());
      batch.put(&key, &value);
      entries += 1;
      copied += 1;
      if entries >= 512 || bytes >= 4 * 1024 * 1024 {
        destination.write_opt(batch, &writes)?;
        after_batch(copied)?;
        batch = WriteBatchWithTransaction::<true>::default();
        entries = 0;
        bytes = 0;
      }
    }
    if entries > 0 {
      destination.write_opt(batch, &writes)?;
      after_batch(copied)?;
    }
    // Drop all target handles before callers can ZIP its files. Synchronous WAL
    // writes make the closed database recoverable even if memtables were not flushed.
    drop(destination);
    directory.complete = true;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::BTreeMap;
  use std::sync::Arc;
  use std::time::{Duration, Instant};

  fn raw(db: &KVTransactionDBRocksdbImpl) -> BTreeMap<Vec<u8>, Vec<u8>> {
    db.db
      .iterator(IteratorMode::Start)
      .map(|entry| {
        let (key, value) = entry.unwrap();
        (key.to_vec(), value.to_vec())
      })
      .collect()
  }

  #[test]
  fn hyper_checkpoint_preserves_one_snapshot_during_atomic_writes_and_compaction() {
    let fixture = tempfile::tempdir().unwrap();
    let source = fixture.path().join("source");
    let mut options = Options::default();
    options.create_if_missing(true);
    options.set_compression_type(rocksdb::DBCompressionType::Zstd);
    options.set_write_buffer_size(32 * 1024);
    options.set_max_write_buffer_number(2);
    options.set_level_zero_file_num_compaction_trigger(2);
    options.set_max_background_jobs(2);
    let db = KVTransactionDBRocksdbImpl {
      db: Arc::new(
        TransactionDB::<SingleThreaded>::open(&options, &TransactionDBOptions::default(), &source)
          .unwrap(),
      ),
    };
    db.db.put([], b"empty-key").unwrap();
    db.db.put([0, 0, 255], [255, 0, 128]).unwrap();
    db.db.put([255, 255, 255, 255], b"last-key").unwrap();
    db.db.put(b"pair/left", 0u64.to_be_bytes()).unwrap();
    db.db.put(b"pair/right", 0u64.to_be_bytes()).unwrap();
    for index in 0..1024 {
      db.db
        .put(format!("item/{index:04}"), vec![index as u8; 1024])
        .unwrap();
    }
    let expected = raw(&db);
    let target = fixture.path().join("checkpoint");
    let mut changed = false;
    db.create_logical_checkpoint_with_hook(&target, |copied| {
      if changed || copied < 512 {
        return Ok(());
      }
      changed = true;
      let log_path = source.join("LOG");
      let previous_log_bytes = fs::metadata(&log_path).unwrap().len() as usize;
      let writer = db.clone();
      std::thread::spawn(move || {
        for epoch in 1..256u64 {
          let mut batch = WriteBatchWithTransaction::<true>::default();
          batch.put(b"pair/left", epoch.to_be_bytes());
          batch.put(b"pair/right", epoch.to_be_bytes());
          batch.put(
            format!("item/{:04}", epoch as usize % 1024),
            vec![epoch as u8; 8192],
          );
          writer.db.write(batch).unwrap();
        }
      })
      .join()
      .unwrap();
      let deadline = Instant::now() + Duration::from_secs(5);
      loop {
        let log = fs::read_to_string(&log_path).unwrap();
        let compacted = log
          .get(previous_log_bytes..)
          .unwrap_or("")
          .contains("compaction_finished");
        if compacted {
          break;
        }
        assert!(
          Instant::now() < deadline,
          "The isolated database did not compact during the checkpoint probe."
        );
        std::thread::sleep(Duration::from_millis(10));
      }
      Ok(())
    })
    .unwrap();
    assert!(changed);
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o700
      );
    }
    assert_ne!(raw(&db), expected);
    let restored = KVTransactionDBRocksdbImpl::open(&target).unwrap();
    assert_eq!(raw(&restored), expected);
    assert_eq!(
      restored.db.get(b"pair/left").unwrap(),
      Some(0u64.to_be_bytes().to_vec())
    );
    assert_eq!(
      restored.db.get(b"pair/right").unwrap(),
      Some(0u64.to_be_bytes().to_vec())
    );
  }

  #[test]
  fn hyper_checkpoint_failed_attempt_removes_only_its_new_directory() {
    let fixture = tempfile::tempdir().unwrap();
    let db = KVTransactionDBRocksdbImpl::open(fixture.path().join("source")).unwrap();
    db.db.put(b"saved", b"value").unwrap();
    let target = fixture.path().join("failed");
    let error = db
      .create_logical_checkpoint_with_hook(&target, |_| {
        // A genuine filesystem failure after target writes exercises staged cleanup.
        fs::read(fixture.path().join("missing"))
          .map(|_| ())
          .map_err(io_error)
      })
      .unwrap_err();
    match error {
      PersistenceError::Internal(error) => assert_eq!(
        error.downcast_ref::<io::Error>().unwrap().kind(),
        io::ErrorKind::NotFound
      ),
      other => panic!("Expected a filesystem failure, got {other:?}"),
    }
    assert!(!target.exists());
    assert_eq!(db.db.get(b"saved").unwrap(), Some(b"value".to_vec()));
  }

  #[test]
  fn hyper_checkpoint_never_overwrites_an_existing_directory_or_symlink() {
    let fixture = tempfile::tempdir().unwrap();
    let db = KVTransactionDBRocksdbImpl::open(fixture.path().join("source")).unwrap();
    let target = fixture.path().join("existing");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep"), b"original").unwrap();
    assert!(db.create_logical_checkpoint(&target).is_err());
    assert_eq!(fs::read(target.join("keep")).unwrap(), b"original");
    #[cfg(unix)]
    {
      let alias = fixture.path().join("alias");
      std::os::unix::fs::symlink(fixture.path().join("missing"), &alias).unwrap();
      assert!(db.create_logical_checkpoint(&alias).is_err());
      assert!(
        fs::symlink_metadata(&alias)
          .unwrap()
          .file_type()
          .is_symlink()
      );
    }
  }
}
