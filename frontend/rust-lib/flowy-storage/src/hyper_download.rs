use crate::manager::StorageUserService;
use flowy_error::{FlowyError, FlowyResult};
use flowy_storage_pub::cloud::{ObjectValue, StorageCloudService};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::watch;
use uuid::Uuid;

const LIMIT: usize = 32 * 1024 * 1024;

fn failed(message: &str) -> FlowyError {
  FlowyError::internal().with_context(message)
}

struct HyperDownloadOwner {
  user: Arc<dyn StorageUserService>,
  generations: watch::Sender<u64>,
  generation: u64,
  uid: i64,
  workspace: Uuid,
  root: PathBuf,
  cancelled: Arc<AtomicBool>,
}

impl HyperDownloadOwner {
  fn check(&self) -> FlowyResult<()> {
    if self.cancelled.load(Ordering::Acquire)
      || *self.generations.borrow() != self.generation
      || self.user.user_id()? != self.uid
      || self.user.workspace_id()? != self.workspace
      || std::fs::canonicalize(self.user.get_application_root_dir())? != self.root
    {
      return Err(failed("The attachment workspace or account changed"));
    }
    Ok(())
  }
}

struct HyperDownloadCancellation(Arc<AtomicBool>);
impl Drop for HyperDownloadCancellation {
  fn drop(&mut self) {
    self.0.store(true, Ordering::Release);
  }
}

struct HyperDownloadTemporary(PathBuf);
impl Drop for HyperDownloadTemporary {
  fn drop(&mut self) {
    let _ = std::fs::remove_file(&self.0);
  }
}

fn write_complete(owner: &HyperDownloadOwner, target: &Path, bytes: &[u8]) -> FlowyResult<()> {
  owner.check()?;
  if !target.is_absolute() || bytes.is_empty() || bytes.len() > LIMIT {
    return Err(failed("Invalid completed attachment download"));
  }
  let parent = std::fs::canonicalize(
    target
      .parent()
      .ok_or_else(|| failed("Invalid attachment destination"))?,
  )?;
  let name = target
    .file_name()
    .ok_or_else(|| failed("Invalid attachment destination"))?;
  let target = parent.join(name);
  if target.try_exists()? || std::fs::symlink_metadata(&target).is_ok() {
    return Err(failed("The attachment destination already exists"));
  }
  let temporary =
    HyperDownloadTemporary(parent.join(format!(".HyperTask-download-{}.partial", Uuid::new_v4())));
  let mut options = OpenOptions::new();
  options.write(true).create_new(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options.open(&temporary.0)?;
  for chunk in bytes.chunks(1024 * 1024) {
    owner.check()?;
    file.write_all(chunk)?;
  }
  file.sync_all()?;
  drop(file);
  owner.check()?;
  if std::fs::canonicalize(&parent)? != parent {
    return Err(failed("The attachment destination changed"));
  }
  {
    // Keep owner invalidation outside synchronous publication. Never replace an
    // existing destination, even if it appeared while the download was running.
    let generation = owner.generations.borrow();
    if *generation != owner.generation || owner.cancelled.load(Ordering::Acquire) {
      return Err(failed("The attachment request was cancelled"));
    }
    std::fs::hard_link(&temporary.0, &target)?;
    #[cfg(unix)]
    File::open(&parent)?.sync_all()?;
  }
  // A completed file is retained if a late owner change makes the reply uncertain.
  // Private preview callers dispose their own staging directory after the request.
  owner.check()
}

pub(crate) async fn hyper_download_complete(
  cloud: Arc<dyn StorageCloudService>,
  user: Arc<dyn StorageUserService>,
  generations: watch::Sender<u64>,
  url: String,
  target: String,
) -> FlowyResult<()> {
  let mut changed = generations.subscribe();
  let cancelled = Arc::new(AtomicBool::new(false));
  let _cancellation = HyperDownloadCancellation(cancelled.clone());
  let generation = *generations.borrow();
  let owner = Arc::new(HyperDownloadOwner {
    uid: user.user_id()?,
    workspace: user.workspace_id()?,
    root: std::fs::canonicalize(user.get_application_root_dir())?,
    user,
    generations,
    generation,
    cancelled,
  });
  owner.check()?;
  let operation = async {
    let object: ObjectValue = cloud
      .get_object_bounded(url, owner.workspace, LIMIT)
      .await?;
    owner.check()?;
    let writer = owner.clone();
    tokio::task::spawn_blocking(move || write_complete(&writer, Path::new(&target), &object.raw))
      .await
      .map_err(|_| failed("The attachment could not be saved"))?
  };
  tokio::select! {
    biased;
    _ = changed.changed() => Err(failed("The attachment workspace or account changed")),
    value = tokio::time::timeout(Duration::from_secs(30), operation) =>
      value.map_err(|_| failed("The attachment download timed out"))?,
  }
}

#[cfg(test)]
mod hyper_download_tests {
  use super::*;
  use flowy_sqlite::DBConnection;
  use std::sync::atomic::AtomicIsize;

  struct Root(PathBuf);
  impl Drop for Root {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }
  struct User {
    root: String,
    workspace: Uuid,
    checks: AtomicIsize,
  }
  impl StorageUserService for User {
    fn user_id(&self) -> FlowyResult<i64> {
      if self.checks.load(Ordering::SeqCst) >= 0 && self.checks.fetch_sub(1, Ordering::SeqCst) == 0
      {
        return Err(failed("The test account was closed"));
      }
      Ok(7)
    }
    fn workspace_id(&self) -> FlowyResult<Uuid> {
      Ok(self.workspace)
    }
    fn sqlite_connection(&self, _uid: i64) -> FlowyResult<DBConnection> {
      Err(failed("No database is needed for download tests"))
    }
    fn get_application_root_dir(&self) -> &str {
      &self.root
    }
  }
  fn fixture() -> (Root, Arc<User>, HyperDownloadOwner) {
    let root =
      Root(std::env::temp_dir().join(format!("hyper-completed-download-{}", Uuid::new_v4())));
    std::fs::create_dir(&root.0).unwrap();
    let user = Arc::new(User {
      root: root.0.to_str().unwrap().to_string(),
      workspace: Uuid::new_v4(),
      checks: AtomicIsize::new(-1),
    });
    let (generations, _) = watch::channel(0);
    let owner = HyperDownloadOwner {
      user: user.clone(),
      generations,
      generation: 0,
      uid: 7,
      workspace: user.workspace,
      root: std::fs::canonicalize(&root.0).unwrap(),
      cancelled: Arc::new(AtomicBool::new(false)),
    };
    (root, user, owner)
  }

  #[test]
  fn hyper_download_publishes_all_bytes_and_retains_an_existing_destination() {
    let (root, _, owner) = fixture();
    let target = root.0.join("complete.bin");
    let bytes = vec![0x9a; 2 * 1024 * 1024 + 17];
    write_complete(&owner, &target, &bytes).unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), bytes);
    assert!(write_complete(&owner, &target, b"replacement").is_err());
    assert_eq!(std::fs::read(&target).unwrap(), bytes);
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 1);
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      assert_eq!(
        std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o600
      );
    }
  }

  #[test]
  fn hyper_download_rejects_owner_aba_and_cancelled_publication() {
    let (root, _, owner) = fixture();
    owner.generations.send_replace(1);
    owner.generations.send_replace(2);
    assert!(write_complete(&owner, &root.0.join("aba"), b"private").is_err());
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 0);
    let (other, _, current) = fixture();
    current.cancelled.store(true, Ordering::Release);
    assert!(write_complete(&current, &other.0.join("cancelled"), b"private").is_err());
    assert_eq!(std::fs::read_dir(&other.0).unwrap().count(), 0);
  }

  #[test]
  fn hyper_download_removes_staging_after_account_failure_during_a_large_write() {
    let (root, user, owner) = fixture();
    user.checks.store(2, Ordering::SeqCst);
    assert!(
      write_complete(
        &owner,
        &root.0.join("unfinished"),
        &vec![1; 3 * 1024 * 1024]
      )
      .is_err()
    );
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 0);
  }

  #[cfg(unix)]
  #[test]
  fn hyper_download_never_follows_or_replaces_a_destination_symlink() {
    use std::os::unix::fs::symlink;
    let (root, _, owner) = fixture();
    let original = root.0.join("original");
    let link = root.0.join("link");
    std::fs::write(&original, b"keep").unwrap();
    symlink(&original, &link).unwrap();
    assert!(write_complete(&owner, &link, b"replace").is_err());
    assert_eq!(std::fs::read(&original).unwrap(), b"keep");
    assert!(
      std::fs::symlink_metadata(link)
        .unwrap()
        .file_type()
        .is_symlink()
    );
  }
}
