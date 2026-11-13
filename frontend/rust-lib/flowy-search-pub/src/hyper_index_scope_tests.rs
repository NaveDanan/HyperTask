use super::*;
use std::fs;

struct Fixture {
  path: PathBuf,
  workspace: Uuid,
}
impl Fixture {
  fn new() -> Self {
    let workspace = Uuid::new_v4();
    let path = std::env::temp_dir().join(format!("hyper-search-scope-{workspace}"));
    fs::create_dir(&path).unwrap();
    Self { path, workspace }
  }
  fn root(&self, name: &str) -> PathBuf {
    self.path.join(name).join("1/indexes")
  }
}
impl Drop for Fixture {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.path);
  }
}
fn add(state: &Arc<RwLock<DocumentTantivyState>>, text: &str) {
  let mut state = state.try_write().unwrap();
  state
    .add_document("same-view", Some(text.into()), Some("Page".into()), None)
    .unwrap();
  state.reader.reload().unwrap();
}
fn hits(state: &Arc<RwLock<DocumentTantivyState>>, query: &str) -> usize {
  let state = state.try_read().unwrap();
  state
    .search(&state.workspace_id, query, None, 10, 0.0)
    .unwrap()
    .len()
}

#[test]
fn hyper_search_scope_same_uuid_uses_the_requested_physical_root() {
  let fixture = Fixture::new();
  let first = get_or_init_document_tantivy_state(fixture.workspace, fixture.root("a")).unwrap();
  let second = get_or_init_document_tantivy_state(fixture.workspace, fixture.root("b")).unwrap();
  assert!(
    !Arc::ptr_eq(&first, &second),
    "A second root reused the first root's index for the same workspace UUID"
  );
  add(&first, "primordialchessboardalpha");
  add(&second, "velocityturbinebeta");
  assert_eq!(hits(&first, "primordialchessboardalpha"), 1);
  assert_eq!(hits(&second, "primordialchessboardalpha"), 0);
  assert_eq!(hits(&second, "velocityturbinebeta"), 1);
  second
    .try_write()
    .unwrap()
    .delete_document("same-view")
    .unwrap();
  second.try_read().unwrap().reader.reload().unwrap();
  assert_eq!(hits(&first, "primordialchessboardalpha"), 1);
}

#[test]
fn hyper_search_scope_missing_lookup_never_creates_or_guesses_a_root() {
  let fixture = Fixture::new();
  let missing = fixture.root("missing");
  assert!(get_document_tantivy_state(&fixture.workspace, &missing).is_none());
  assert!(!missing.exists());
  let file = fixture.path.join("ordinary-file");
  fs::write(&file, b"preserve me").unwrap();
  assert!(get_or_init_document_tantivy_state(fixture.workspace, file.clone()).is_err());
  assert_eq!(fs::read(file).unwrap(), b"preserve me");
}

#[test]
fn hyper_search_scope_distinguishes_actor_paths_and_reuses_live_writers() {
  let fixture = Fixture::new();
  let first =
    get_or_init_document_tantivy_state(fixture.workspace, fixture.path.join("1/indexes")).unwrap();
  let second =
    get_or_init_document_tantivy_state(fixture.workspace, fixture.path.join("2/indexes")).unwrap();
  assert!(!Arc::ptr_eq(&first, &second));
  let expected = Arc::downgrade(&first);
  close_document_tantivy_state(&fixture.workspace, &expected);
  let retained =
    get_or_init_document_tantivy_state(fixture.workspace, fixture.path.join("1/indexes")).unwrap();
  assert!(Arc::ptr_eq(&first, &retained));
  drop(first);
  drop(retained);
  close_document_tantivy_state(&fixture.workspace, &expected);
  assert!(expected.upgrade().is_none());
  assert!(
    get_document_tantivy_state(&fixture.workspace, &fixture.path.join("2/indexes"))
      .unwrap()
      .upgrade()
      .is_some()
  );
}

#[cfg(unix)]
#[test]
fn hyper_search_scope_canonicalizes_root_and_nested_directory_aliases() {
  use std::os::unix::fs::symlink;
  let fixture = Fixture::new();
  let root = fixture.root("physical");
  let first = get_or_init_document_tantivy_state(fixture.workspace, root.clone()).unwrap();
  let alias = fixture.path.join("root-alias");
  symlink(&root, &alias).unwrap();
  let via_root = get_or_init_document_tantivy_state(fixture.workspace, alias).unwrap();
  assert!(Arc::ptr_eq(&first, &via_root));
  let nested = fixture.root("nested");
  fs::create_dir_all(nested.join(fixture.workspace.to_string())).unwrap();
  symlink(
    root.join(fixture.workspace.to_string()).join("documents"),
    nested.join(fixture.workspace.to_string()).join("documents"),
  )
  .unwrap();
  let via_nested = get_or_init_document_tantivy_state(fixture.workspace, nested).unwrap();
  assert!(Arc::ptr_eq(&first, &via_nested));
}

#[cfg(unix)]
#[test]
fn hyper_search_scope_captured_close_ignores_removed_and_retargeted_aliases() {
  use std::os::unix::fs::symlink;
  let fixture = Fixture::new();
  let a = fixture.root("a");
  let b = fixture.root("b");
  let first = get_or_init_document_tantivy_state(fixture.workspace, a.clone()).unwrap();
  let second = get_or_init_document_tantivy_state(fixture.workspace, b.clone()).unwrap();
  let alias = fixture.path.join("alias");
  symlink(&a, &alias).unwrap();
  let expected = Arc::downgrade(&first);
  drop(first);
  fs::remove_file(&alias).unwrap();
  symlink(&b, &alias).unwrap();
  fs::remove_dir_all(a).unwrap();
  close_document_tantivy_state(&fixture.workspace, &expected);
  let retained = get_or_init_document_tantivy_state(fixture.workspace, alias).unwrap();
  assert!(Arc::ptr_eq(&second, &retained));
  assert!(expected.upgrade().is_none());
}
