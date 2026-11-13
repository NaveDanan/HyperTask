use chrono::{Days, Local};
use collab_integrate::{CollabKVAction, CollabKVDB, PersistenceError};
use collab_plugins::local_storage::kv::KVTransactionDB;
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use flowy_error::FlowyError;
use flowy_sqlite::ConnectionPool;
use flowy_sqlite::{DBConnection, Database};
use flowy_user_pub::entities::UserProfile;
use flowy_user_pub::sql::select_user_profile;
use lib_infra::file_util::{is_completed_zip_backup, unzip_and_replace, zip_folder};
use std::path::{Path, PathBuf};
use std::sync::Weak;
use std::{fs, io, sync::Arc};
use tracing::{error, event, info, instrument};

pub trait UserDBPath: Send + Sync + 'static {
  fn sqlite_db_path(&self, uid: i64) -> PathBuf;
  fn collab_db_path(&self, uid: i64) -> PathBuf;
  fn collab_db_history(&self, uid: i64, create_if_not_exist: bool) -> std::io::Result<PathBuf>;
}

pub struct UserDB {
  paths: Box<dyn UserDBPath>,
  sqlite_map: DashMap<i64, Database>,
  collab_db_map: DashMap<i64, Arc<CollabKVDB>>,
}

impl UserDB {
  pub fn new(paths: impl UserDBPath) -> Self {
    Self {
      paths: Box::new(paths),
      sqlite_map: Default::default(),
      collab_db_map: Default::default(),
    }
  }

  /// Performs a conditional backup or restoration of the collaboration database (CollabDB) for a specific user.
  #[instrument(level = "debug", skip_all)]
  pub fn backup(&self, uid: i64, workspace_id: &str) {
    // Obtain the path for the collaboration database.
    let collab_db_path = self.paths.collab_db_path(uid);

    // Obtain the history folder path, proceed if successful.
    if let Ok(history_folder) = self.paths.collab_db_history(uid, true) {
      // Initialize the backup utility for the collaboration database.
      let zip_backup = CollabDBZipBackup::new(collab_db_path.clone(), history_folder);
      if collab_db_path.exists() {
        // Validate the existing collaboration database.
        let db = match self.open_collab_db(collab_db_path, uid) {
          Ok(db) => db,
          Err(err) => {
            error!("Open collab db for backup failed: {:?}", err);
            return;
          },
        };
        let is_ok = validate_collab_db(Ok(db.clone()), uid, workspace_id);
        if is_ok {
          // If database is valid, update the shared map and initiate backup.
          // Asynchronous backup operation.
          tokio::spawn(async move {
            if let Err(err) = run_collab_backup(move || zip_backup.backup(&db)).await {
              error!("Backup of collab db failed: {:?}", err);
            }
          });
        }
      }
    }
  }

  #[cfg(debug_assertions)]
  pub fn get_collab_backup_list(&self, uid: i64) -> Vec<String> {
    let collab_db_path = self.paths.collab_db_path(uid);
    if let Ok(history_folder) = self.paths.collab_db_history(uid, true) {
      return CollabDBZipBackup::new(collab_db_path.clone(), history_folder)
        .get_backup_list()
        .unwrap_or_default();
    }
    vec![]
  }

  /// Close the database connection for the user.
  pub(crate) fn close(&self, user_id: i64) -> Result<(), FlowyError> {
    if self.sqlite_map.remove(&user_id).is_some() {
      tracing::trace!("close sqlite db for user {}", user_id);
    }

    if let Some((_, db)) = self.collab_db_map.remove(&user_id) {
      tracing::trace!("close collab db for user {}", user_id);
      let _ = db.flush();
      drop(db);
    }
    Ok(())
  }

  pub(crate) fn get_connection(&self, user_id: i64) -> Result<DBConnection, FlowyError> {
    let conn = self.get_pool(user_id)?.get()?;
    Ok(conn)
  }

  pub(crate) fn get_pool(&self, user_id: i64) -> Result<Arc<ConnectionPool>, FlowyError> {
    let pool = self.open_sqlite_db(self.paths.sqlite_db_path(user_id), user_id)?;
    Ok(pool)
  }

  pub(crate) fn get_collab_db(&self, user_id: i64) -> Result<Weak<CollabKVDB>, FlowyError> {
    let collab_db = self.open_collab_db(self.paths.collab_db_path(user_id), user_id)?;
    Ok(Arc::downgrade(&collab_db))
  }

  pub fn open_sqlite_db(
    &self,
    db_path: impl AsRef<Path>,
    user_id: i64,
  ) -> Result<Arc<ConnectionPool>, FlowyError> {
    match self.sqlite_map.entry(user_id) {
      Entry::Occupied(e) => Ok(e.get().get_pool()),
      Entry::Vacant(e) => {
        tracing::debug!("open sqlite db {} at path: {:?}", user_id, db_path.as_ref());
        let db = flowy_sqlite::init(&db_path).map_err(|e| {
          FlowyError::internal().with_context(format!("open user db failed, {:?}", e))
        })?;
        let pool = db.get_pool();
        e.insert(db);
        Ok(pool)
      },
    }
  }

  pub fn get_user_profile(
    &self,
    pool: &Arc<ConnectionPool>,
    uid: i64,
    workspace_id: &str,
  ) -> Result<UserProfile, FlowyError> {
    let mut conn = pool.get()?;
    let profile = select_user_profile(uid, workspace_id, &mut conn)?;
    Ok(profile)
  }

  /// Open a collab db for the user. If the db is already opened, return the opened db.
  ///
  fn open_collab_db(
    &self,
    collab_db_path: impl AsRef<Path>,
    uid: i64,
  ) -> Result<Arc<CollabKVDB>, PersistenceError> {
    match self.collab_db_map.entry(uid) {
      Entry::Occupied(e) => Ok(e.get().clone()),
      Entry::Vacant(e) => {
        info!(
          "open collab db for user {} at path: {:?}",
          uid,
          collab_db_path.as_ref()
        );
        let db = match CollabKVDB::open(&collab_db_path) {
          Ok(db) => Ok(db),
          Err(err) => {
            error!("open collab db error, {:?}", err);
            Err(err)
          },
        }?;

        let db = Arc::new(db);
        e.insert(db.clone());
        Ok(db)
      },
    }
  }
}

async fn run_collab_backup(
  operation: impl FnOnce() -> io::Result<()> + Send + 'static,
) -> io::Result<()> {
  // Observe both a failed blocking task and the operation's own io::Result.
  tokio::task::spawn_blocking(operation)
    .await
    .map_err(|error| io::Error::new(io::ErrorKind::Other, format!("Backup task failed: {error}")))?
}

pub struct CollabDBZipBackup {
  collab_db_path: PathBuf,
  history_folder: PathBuf,
}

impl CollabDBZipBackup {
  fn new(collab_db_path: PathBuf, history_folder: PathBuf) -> Self {
    Self {
      collab_db_path,
      history_folder,
    }
  }

  #[instrument(name = "backup_collab_db", skip_all, err)]
  pub fn backup(&self, db: &CollabKVDB) -> io::Result<()> {
    let file_name = match std::env::var("APP_VERSION") {
      Ok(version_num) => {
        format!("collab_db_{}_{}.zip", version_num, today_zip_timestamp())
      },
      Err(_) => {
        format!("collab_db_{}.zip", today_zip_timestamp())
      },
    };

    let today_zip_file = self.history_folder.join(file_name);

    self.backup_to(db, &today_zip_file, |source, destination| {
      zip_folder(source, destination)
    })
  }

  fn backup_to(
    &self,
    db: &CollabKVDB,
    today_zip_file: &Path,
    archive: impl FnOnce(&Path, &Path) -> io::Result<()>,
  ) -> io::Result<()> {
    // Existence alone is not success: older failures could leave a valid-looking
    // partial ZIP. Preserve it until a new, fully completed replacement is ready.
    if !is_completed_zip_backup(today_zip_file).unwrap_or(false) {
      event!(
        tracing::Level::INFO,
        "Backup collab db to {:?}",
        today_zip_file
      );
      let staging = tempfile::Builder::new()
        .prefix(".HyperTask-collab-checkpoint-")
        .tempdir_in(&self.history_folder)?;
      let checkpoint = staging.path().join("collab_db");
      db.create_logical_checkpoint(&checkpoint)
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
      archive(&checkpoint, today_zip_file)?;
      if !is_completed_zip_backup(today_zip_file)? {
        return Err(io::Error::new(
          io::ErrorKind::InvalidData,
          "The backup ZIP did not complete.",
        ));
      }
    }

    // Clean up old backups
    if let Err(err) = self.clean_old_backups() {
      error!("Clean up old backups failed: {:?}", err);
    }

    Ok(())
  }

  #[cfg(debug_assertions)]
  pub fn get_backup_list(&self) -> io::Result<Vec<String>> {
    let mut backups = Vec::new();
    for entry in fs::read_dir(&self.history_folder)? {
      let entry = entry?;
      let path = entry.path();
      if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("zip") {
        if let Some(file_name) = path.file_stem().and_then(|s| s.to_str()) {
          backups.push(file_name.to_string());
        }
      }
    }
    backups.sort();
    Ok(backups)
  }

  #[deprecated(note = "This function is deprecated", since = "0.7.1")]
  #[allow(dead_code)]
  fn restore_latest_backup(&self) -> io::Result<()> {
    let mut latest_zip: Option<(String, PathBuf)> = None;
    // When the history folder does not exist, there is no backup to restore
    if !self.history_folder.exists() {
      return Ok(());
    }

    for entry in fs::read_dir(&self.history_folder)? {
      let entry = entry?;
      let path = entry.path();
      if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("zip") {
        if let Some(file_name) = path.file_stem().and_then(|s| s.to_str()) {
          if let Some(timestamp_str) = file_name.split('_').last() {
            match latest_zip {
              Some((latest_timestamp, _)) if timestamp_str > latest_timestamp.as_str() => {
                latest_zip = Some((timestamp_str.to_string(), path));
              },
              None => latest_zip = Some((timestamp_str.to_string(), path)),
              _ => {},
            }
          }
        }
      }
    }

    if latest_zip.is_none() {
      return Ok(());
    }

    let restore_path = latest_zip
      .map(|(_, path)| path)
      .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "No backup folder found"))?;

    unzip_and_replace(&restore_path, &self.collab_db_path)
      .map_err(|err| io::Error::new(io::ErrorKind::Other, err))?;
    info!("Restore collab db from {:?}", restore_path);
    Ok(())
  }

  fn clean_old_backups(&self) -> io::Result<()> {
    let mut backups = Vec::new();
    let now = Local::now();
    match now.checked_sub_days(Days::new(10)) {
      None => {
        error!("Failed to calculate threshold date");
      },
      Some(threshold_date) => {
        // Collect all backup files
        for entry in fs::read_dir(&self.history_folder)? {
          let entry = entry?;
          let path = entry.path();
          if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("zip") {
            let filename = path
              .file_stem()
              .and_then(|s| s.to_str())
              .unwrap_or_default();
            let date_str = filename.split('_').last().unwrap_or("");
            backups.push((date_str.to_string(), path));
          }
        }

        // Sort backups by date (oldest first)
        backups.sort_by(|a, b| a.0.cmp(&b.0));

        // Remove backups older than 10 days
        let threshold_str = threshold_date.format(zip_time_format()).to_string();

        info!("Current backup: {:?}", backups.len());
        // If there are more than 10 backups, remove the oldest ones
        while backups.len() > 10 {
          if let Some((date_str, path)) = backups.first() {
            if date_str < &threshold_str {
              info!("Remove old backup file: {:?}", path);
              fs::remove_file(path)?;
              backups.remove(0);
            } else {
              break;
            }
          }
        }
      },
    }

    Ok(())
  }
}

fn today_zip_timestamp() -> String {
  Local::now().format(zip_time_format()).to_string()
}

fn zip_time_format() -> &'static str {
  "%Y%m%d"
}

#[cfg(test)]
mod hyper_backup_tests {
  use super::*;
  use collab_plugins::local_storage::kv::KVStore;
  use std::io::Write;
  use zip::ZipWriter;
  use zip::write::FileOptions;

  fn source_and_backup() -> (tempfile::TempDir, CollabKVDB, CollabDBZipBackup, PathBuf) {
    let fixture = tempfile::tempdir().unwrap();
    let source = fixture.path().join("collab_db");
    let db = CollabKVDB::open(&source).unwrap();
    db.with_write_txn(|txn| txn.insert(b"saved-key", b"before-checkpoint"))
      .unwrap();
    let history = fixture.path().join("history");
    fs::create_dir(&history).unwrap();
    let daily = history.join("collab_db_test_20261111.zip");
    (fixture, db, CollabDBZipBackup::new(source, history), daily)
  }

  fn write_legacy_zip(path: &Path) {
    let mut zip = ZipWriter::new(fs::File::create(path).unwrap());
    zip
      .start_file::<_, ()>("previous-backup", FileOptions::default())
      .unwrap();
    zip
      .write_all(b"preserve the previous archive until replacement succeeds")
      .unwrap();
    zip.finish().unwrap();
  }

  #[test]
  fn hyper_backup_uses_a_closed_checkpoint_while_source_writes_continue() {
    let (fixture, db, backup, daily) = source_and_backup();
    write_legacy_zip(&daily);
    assert!(!is_completed_zip_backup(&daily).unwrap());
    let mut archived = false;
    backup
      .backup_to(&db, &daily, |checkpoint, target| {
        archived = true;
        // Opening here proves the snapshot API has released every target DB handle.
        let closed = CollabKVDB::open(checkpoint).unwrap();
        assert_eq!(
          closed.read_txn().get(b"saved-key").unwrap(),
          Some(b"before-checkpoint".to_vec())
        );
        db.with_write_txn(|txn| txn.insert(b"saved-key", b"after-checkpoint"))
          .unwrap();
        assert_eq!(
          closed.read_txn().get(b"saved-key").unwrap(),
          Some(b"before-checkpoint".to_vec())
        );
        drop(closed);
        zip_folder(checkpoint, target)
      })
      .unwrap();
    assert!(archived);
    assert!(is_completed_zip_backup(&daily).unwrap());
    let restored_path = fixture.path().join("restored");
    unzip_and_replace(&daily, &restored_path).unwrap();
    let restored = CollabKVDB::open(&restored_path).unwrap();
    assert_eq!(
      restored.read_txn().get(b"saved-key").unwrap(),
      Some(b"before-checkpoint".to_vec())
    );
    assert_eq!(
      db.read_txn().get(b"saved-key").unwrap(),
      Some(b"after-checkpoint".to_vec())
    );
    assert_eq!(fs::read_dir(&backup.history_folder).unwrap().count(), 1);
    backup
      .backup_to(&db, &daily, |_, _| {
        panic!("A completed daily backup should be reused.")
      })
      .unwrap();
  }

  #[test]
  fn hyper_backup_failed_zip_preserves_previous_unmarked_archive_and_cleans_checkpoint() {
    let (_fixture, db, backup, daily) = source_and_backup();
    write_legacy_zip(&daily);
    let previous = fs::read(&daily).unwrap();
    let mut attempted = false;
    let error = backup
      .backup_to(&db, &daily, |checkpoint, target| {
        attempted = true;
        fs::remove_dir_all(checkpoint)?;
        zip_folder(checkpoint, target)
      })
      .unwrap_err();
    assert!(
      attempted,
      "An old unmarked ZIP must not count as today's completed job."
    );
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    assert_eq!(fs::read(&daily).unwrap(), previous);
    assert!(!is_completed_zip_backup(&daily).unwrap());
    assert_eq!(fs::read_dir(&backup.history_folder).unwrap().count(), 1);
    assert_eq!(
      db.read_txn().get(b"saved-key").unwrap(),
      Some(b"before-checkpoint".to_vec())
    );
    backup
      .backup_to(&db, &daily, |checkpoint, target| {
        zip_folder(checkpoint, target)
      })
      .unwrap();
    assert!(is_completed_zip_backup(&daily).unwrap());
  }

  #[test]
  fn hyper_backup_failed_first_zip_leaves_no_completed_archive_or_staging_directory() {
    let (_fixture, db, backup, daily) = source_and_backup();
    let error = backup
      .backup_to(&db, &daily, |checkpoint, target| {
        fs::remove_dir_all(checkpoint)?;
        zip_folder(checkpoint, target)
      })
      .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    assert!(!daily.exists());
    assert_eq!(fs::read_dir(&backup.history_folder).unwrap().count(), 0);
  }

  #[test]
  fn hyper_backup_observes_inner_io_failures_and_panicked_blocking_tasks() {
    let runtime = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();
    let inner = runtime
      .block_on(run_collab_backup(|| {
        Err(io::Error::new(
          io::ErrorKind::NotFound,
          "snapshot source disappeared",
        ))
      }))
      .unwrap_err();
    assert_eq!(inner.kind(), io::ErrorKind::NotFound);
    let joined = runtime
      .block_on(run_collab_backup(|| panic!("isolated backup task panic")))
      .unwrap_err();
    assert_eq!(joined.kind(), io::ErrorKind::Other);
    assert!(joined.to_string().contains("Backup task failed"));
  }
}

pub(crate) fn validate_collab_db(
  result: Result<Arc<CollabKVDB>, PersistenceError>,
  uid: i64,
  workspace_id: &str,
) -> bool {
  // Attempt to open the collaboration database using the workspace_id. The workspace_id must already
  // exist in the collab database. If it does not, it may be indicative of corruption in the collab database
  // due to other factors.
  info!(
    "open collab db to validate data integration for user {}",
    uid,
  );

  match result {
    Ok(db) => {
      let read_txn = db.read_txn();
      read_txn.is_exist(uid, workspace_id, workspace_id)
    },
    Err(err) => {
      error!("open collab db error when validate collab, {:?}", err);
      !matches!(
        err,
        PersistenceError::RocksdbCorruption(_) | PersistenceError::RocksdbRepairFail(_)
      )
    },
  }
}
