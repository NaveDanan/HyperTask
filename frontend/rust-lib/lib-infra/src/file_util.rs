use anyhow::Context;
use std::cmp::Ordering;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::{fs, io};
use tempfile::tempdir;
use walkdir::WalkDir;
use zip::ZipWriter;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive};

const COMPLETED_BACKUP_COMMENT: &str = "HyperTask backup complete v1";

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
  for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
    let path = entry.path();
    let relative_path = path.strip_prefix(src).unwrap();
    let target_path = dst.join(relative_path);

    if path.is_dir() {
      fs::create_dir_all(&target_path)?;
    } else {
      fs::copy(path, target_path)?;
    }
  }
  Ok(())
}

pub fn find_and_sort_folders_at<P>(path: &str, pat: P, order: Ordering) -> Vec<PathBuf>
where
  P: Fn(&str) -> bool,
{
  let mut folders = Vec::new();

  for entry in WalkDir::new(path)
    .min_depth(1)
    .max_depth(1)
    .into_iter()
    .filter_map(|e| e.ok())
  {
    let entry_path = entry.path().to_path_buf();

    if entry_path.is_dir()
      && entry_path
        .file_name()
        .unwrap_or_default()
        .to_str()
        .map(&pat)
        .unwrap_or(false)
    {
      let metadata = fs::metadata(&entry_path).ok();
      let modified_time = metadata
        .and_then(|m| m.modified().ok())
        .unwrap_or(SystemTime::UNIX_EPOCH);

      folders.push((entry_path, modified_time));
    }
  }

  // Sort folders based on the specified order
  folders.sort_by(|a, b| match order {
    Ordering::Less => a.1.cmp(&b.1),
    Ordering::Greater => b.1.cmp(&a.1),
    _ => a.1.cmp(&b.1), // Default case
  });

  // Extract just the PathBufs, discarding the modification times
  folders.into_iter().map(|(path, _)| path).collect()
}

pub fn zip_folder(src_path: impl AsRef<Path>, dest_path: &Path) -> io::Result<()> {
  zip_folder_with_opener(src_path.as_ref(), dest_path, |path| File::open(path))
}

fn zip_folder_with_opener(
  src_path: &Path,
  dest_path: &Path,
  mut open_source: impl FnMut(&Path) -> io::Result<File>,
) -> io::Result<()> {
  // Check if source path exists
  if !src_path.exists() {
    return Err(io::Error::new(
      io::ErrorKind::NotFound,
      "Source path not found",
    ));
  }

  // Check if source and destination paths are the same
  if src_path == dest_path {
    return Err(io::Error::new(
      io::ErrorKind::InvalidInput,
      "Source and destination paths cannot be the same",
    ));
  }

  let parent = dest_path
    .parent()
    .filter(|parent| !parent.as_os_str().is_empty())
    .unwrap_or_else(|| Path::new("."));
  let canonical_source = fs::canonicalize(src_path)?;
  if fs::canonicalize(parent)?.starts_with(&canonical_source) {
    return Err(io::Error::new(
      io::ErrorKind::InvalidInput,
      "The ZIP destination must be outside the source directory",
    ));
  }
  // Keep the old archive intact until traversal, compression and file sync finish.
  // NamedTempFile removes a failed attempt, including a ZIP finalized during Drop.
  let mut temporary = tempfile::Builder::new()
    .prefix(".HyperTask-backup-")
    .suffix(".partial")
    .tempfile_in(parent)?;
  let mut zip = ZipWriter::new(temporary.as_file_mut());

  // Traverse through the source directory recursively
  for entry in WalkDir::new(src_path) {
    let entry = entry.map_err(io::Error::from)?;
    let path = entry.path();
    let name = path
      .strip_prefix(src_path)
      .map_err(|_| io::Error::new(io::ErrorKind::Other, "Invalid path"))?;

    // If the entry is a file, add it to the ZIP archive
    let metadata = fs::metadata(path)?;
    if metadata.is_file() {
      let file_name = name
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "Invalid file name"))?;
      zip.start_file::<_, ()>(
        file_name,
        FileOptions::default().compression_method(CompressionMethod::Deflated),
      )?;

      // Instead of loading the entire file into memory, use `copy` for efficient writing
      let mut f = open_source(path)?;
      io::copy(&mut f, &mut zip)?;

      // If the entry is a directory, add it to the ZIP archive
    } else if metadata.is_dir() {
      let dir_name = name
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "Invalid directory name"))?;
      if !dir_name.is_empty() {
        zip.add_directory::<_, ()>(
          dir_name,
          FileOptions::default().compression_method(CompressionMethod::Deflated),
        )?;
      }
    } else {
      return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "The backup source contains an unsupported file type",
      ));
    }
  }

  // Finish the ZIP archive
  // Old failed jobs could leave a parseable ZIP behind. This marker is published
  // only with the fully copied archive, never with an incomplete temporary file.
  zip.set_comment(COMPLETED_BACKUP_COMMENT);
  zip.finish()?.sync_all()?;
  temporary.persist(dest_path).map_err(|error| error.error)?;
  #[cfg(unix)]
  File::open(parent)?.sync_all()?;
  Ok(())
}

pub fn is_completed_zip_backup(path: impl AsRef<Path>) -> io::Result<bool> {
  let file = File::open(path)?;
  let mut archive = match ZipArchive::new(file) {
    Ok(archive) => archive,
    Err(_) => return Ok(false),
  };
  if archive.comment() != COMPLETED_BACKUP_COMMENT.as_bytes() {
    return Ok(false);
  }
  for index in 0..archive.len() {
    let mut entry = match archive.by_index(index) {
      Ok(entry) => entry,
      Err(_) => return Ok(false),
    };
    // Reading every member verifies its compressed data and CRC, not just the
    // central directory. A marked archive with damaged payload is not complete.
    if io::copy(&mut entry, &mut io::sink()).is_err() {
      return Ok(false);
    }
  }
  Ok(true)
}

pub fn unzip_and_replace(
  zip_path: impl AsRef<Path>,
  target_folder: &Path,
) -> Result<(), anyhow::Error> {
  // Create a temporary directory for unzipping
  let temp_dir = tempdir()?;

  // Unzip the file
  let file = File::open(zip_path.as_ref())
    .with_context(|| format!("Can't find the zip file: {:?}", zip_path.as_ref()))?;
  let mut archive = ZipArchive::new(file).context("Unzip file fail")?;

  for i in 0..archive.len() {
    let mut file = archive.by_index(i)?;
    let outpath = temp_dir.path().join(file.mangled_name());

    if file.name().ends_with('/') {
      fs::create_dir_all(&outpath)?;
    } else {
      if let Some(p) = outpath.parent() {
        if !p.exists() {
          fs::create_dir_all(p)?;
        }
      }
      let mut outfile = File::create(&outpath)?;
      io::copy(&mut file, &mut outfile)?;
    }
  }

  // Replace the contents of the target folder
  if target_folder.exists() {
    fs::remove_dir_all(target_folder)
      .with_context(|| format!("Remove all files in {:?}", target_folder))?;
  }

  fs::create_dir_all(target_folder)?;
  for entry in fs::read_dir(temp_dir.path())? {
    let entry = entry?;
    let target_file = target_folder.join(entry.file_name());

    // Use a copy and delete approach instead of fs::rename
    if entry.path().is_dir() {
      // Recursively copy directory contents
      copy_dir_all(entry.path(), &target_file)?;
    } else {
      fs::copy(entry.path(), &target_file)?;
    }
    // Remove the original file/directory after copying
    if entry.path().is_dir() {
      fs::remove_dir_all(entry.path())?;
    } else {
      fs::remove_file(entry.path())?;
    }
  }

  Ok(())
}

// Helper function for recursively copying directories
fn copy_dir_all(src: PathBuf, dst: &Path) -> io::Result<()> {
  fs::create_dir_all(dst)?;
  for entry in fs::read_dir(src)? {
    let entry = entry?;
    let ty = entry.file_type()?;
    if ty.is_dir() {
      copy_dir_all(entry.path(), &dst.join(entry.file_name()))?;
    } else {
      fs::copy(entry.path(), dst.join(entry.file_name()))?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod hyper_backup_tests {
  use super::*;
  use std::io::Read;

  #[test]
  fn hyper_backup_zip_keeps_previous_daily_archive_when_a_source_file_disappears() {
    let fixture = tempdir().unwrap();
    let source = fixture.path().join("collab_db");
    fs::create_dir(&source).unwrap();
    let source_file = source.join("live.sst");
    let saved_content = b"Previously saved workspace content";
    fs::write(&source_file, saved_content).unwrap();
    let daily_zip = fixture.path().join("2026-11-11.zip");

    // Create and verify a real previous backup using the public production path.
    zip_folder(&source, &daily_zip).unwrap();
    let previous_zip = fs::read(&daily_zip).unwrap();
    let mut previous_archive = ZipArchive::new(File::open(&daily_zip).unwrap()).unwrap();
    let mut previous_content = Vec::new();
    previous_archive
      .by_name("live.sst")
      .unwrap()
      .read_to_end(&mut previous_content)
      .unwrap();
    assert_eq!(previous_content, saved_content);
    drop(previous_archive);

    let mut removed = false;
    let error = zip_folder_with_opener(&source, &daily_zip, |path| {
      assert_eq!(path, source_file);
      assert!(path.is_file());
      fs::remove_file(path)?;
      removed = true;
      // This is a genuine File::open ENOENT after zip_folder's is_file check,
      // not a fabricated error or an unrelated implementation of ZIP writing.
      File::open(path)
    })
    .unwrap_err();
    assert!(removed);
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    let failed_zip = fs::read(&daily_zip).unwrap();
    let partial_member_bytes = ZipArchive::new(File::open(&daily_zip).unwrap())
      .ok()
      .and_then(|mut archive| {
        let mut content = Vec::new();
        archive
          .by_name("live.sst")
          .ok()?
          .read_to_end(&mut content)
          .ok()?;
        Some(content.len())
      });
    assert!(
      failed_zip == previous_zip,
      "A failed backup replaced the previous good daily ZIP; the source open returned {:?} and the leftover ZIP contains {:?} source bytes instead of {}",
      error.kind(),
      partial_member_bytes,
      saved_content.len()
    );
    assert_eq!(partial_member_bytes, Some(saved_content.len()));
    assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 2);
  }

  #[test]
  fn hyper_backup_zip_failed_first_attempt_leaves_no_archive_or_partial_file() {
    let fixture = tempdir().unwrap();
    let source = fixture.path().join("collab_db");
    fs::create_dir(&source).unwrap();
    let source_file = source.join("live.sst");
    fs::write(&source_file, b"workspace data").unwrap();
    let daily_zip = fixture.path().join("daily.zip");
    let error = zip_folder_with_opener(&source, &daily_zip, |path| {
      fs::remove_file(path)?;
      File::open(path)
    })
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    assert!(!daily_zip.exists());
    assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 1);
  }

  #[test]
  fn hyper_backup_zip_publishes_only_a_complete_successful_replacement() {
    let fixture = tempdir().unwrap();
    let source = fixture.path().join("collab_db");
    fs::create_dir(&source).unwrap();
    let source_file = source.join("live.sst");
    fs::write(&source_file, b"old state").unwrap();
    let daily_zip = fixture.path().join("daily.zip");
    zip_folder(&source, &daily_zip).unwrap();
    fs::write(&source_file, b"new complete workspace state").unwrap();
    zip_folder(&source, &daily_zip).unwrap();
    let mut archive = ZipArchive::new(File::open(&daily_zip).unwrap()).unwrap();
    let mut content = Vec::new();
    archive
      .by_name("live.sst")
      .unwrap()
      .read_to_end(&mut content)
      .unwrap();
    assert_eq!(content, b"new complete workspace state");
    assert!(is_completed_zip_backup(&daily_zip).unwrap());
    assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 2);
  }

  #[cfg(unix)]
  #[test]
  fn hyper_backup_zip_propagates_directory_traversal_errors_without_publishing() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = tempdir().unwrap();
    let source = fixture.path().join("collab_db");
    let restricted = source.join("restricted");
    fs::create_dir_all(&restricted).unwrap();
    fs::write(restricted.join("saved.sst"), b"must not be omitted").unwrap();
    fs::set_permissions(&restricted, fs::Permissions::from_mode(0)).unwrap();
    let denied = fs::read_dir(&restricted).is_err();
    let daily_zip = fixture.path().join("daily.zip");
    let result = zip_folder(&source, &daily_zip);
    fs::set_permissions(&restricted, fs::Permissions::from_mode(0o700)).unwrap();
    if !denied {
      return;
    } // A root test runner can read mode-000 directories.
    assert!(result.is_err());
    assert!(!daily_zip.exists());
    assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 1);
  }

  #[test]
  fn hyper_backup_zip_rejects_a_destination_inside_its_source() {
    let fixture = tempdir().unwrap();
    fs::write(fixture.path().join("source.sst"), b"workspace data").unwrap();
    let destination = fixture.path().join("backup.zip");
    assert_eq!(
      zip_folder(fixture.path(), &destination).unwrap_err().kind(),
      io::ErrorKind::InvalidInput
    );
    assert!(!destination.exists());
    assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 1);
  }

  #[test]
  fn hyper_backup_zip_does_not_trust_unmarked_or_invalid_existing_archives() {
    let fixture = tempdir().unwrap();
    let daily_zip = fixture.path().join("daily.zip");
    let mut legacy = ZipWriter::new(File::create(&daily_zip).unwrap());
    legacy
      .start_file::<_, ()>("empty.sst", FileOptions::default())
      .unwrap();
    legacy.finish().unwrap();
    assert!(ZipArchive::new(File::open(&daily_zip).unwrap()).is_ok());
    assert!(!is_completed_zip_backup(&daily_zip).unwrap());
    fs::write(&daily_zip, b"incomplete ZIP").unwrap();
    assert!(!is_completed_zip_backup(&daily_zip).unwrap());
  }

  #[test]
  fn hyper_backup_zip_completion_check_rejects_corrupt_payload_and_truncation() {
    let fixture = tempdir().unwrap();
    let source = fixture.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("saved.sst"), b"Complete saved workspace bytes").unwrap();
    let daily_zip = fixture.path().join("daily.zip");
    zip_folder(&source, &daily_zip).unwrap();
    let good = fs::read(&daily_zip).unwrap();
    let mut archive = ZipArchive::new(File::open(&daily_zip).unwrap()).unwrap();
    let offset = archive.by_name("saved.sst").unwrap().data_start() as usize;
    drop(archive);
    let mut corrupt = good.clone();
    corrupt[offset] ^= 0xff;
    fs::write(&daily_zip, corrupt).unwrap();
    assert!(ZipArchive::new(File::open(&daily_zip).unwrap()).is_ok());
    assert!(!is_completed_zip_backup(&daily_zip).unwrap());
    fs::write(&daily_zip, &good[..good.len() - 1]).unwrap();
    assert!(!is_completed_zip_backup(&daily_zip).unwrap());
  }
}
