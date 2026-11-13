use crate::tantivy_state::DocumentTantivyState;
use dashmap::DashMap;
use flowy_error::FlowyResult;
use once_cell::sync::Lazy;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};
use tokio::sync::RwLock;
use tracing::info;
use uuid::Uuid;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct HyperIndexKey {
  workspace_id: Uuid,
  directory: PathBuf,
}

// The active search context owns the writer. This cache does not keep an old
// actor/root alive, but permits draining requests to share one physical writer.
type DocIndexMap = DashMap<HyperIndexKey, Weak<RwLock<DocumentTantivyState>>>;
static SEARCH_INDEX: Lazy<DocIndexMap> = Lazy::new(DocIndexMap::new);

/// Returns a strong handle, creating it if needed.
pub fn get_or_init_document_tantivy_state(
  workspace_id: Uuid,
  data_path: PathBuf,
) -> FlowyResult<Arc<RwLock<DocumentTantivyState>>> {
  let directory = data_path.join(workspace_id.to_string()).join("documents");
  std::fs::create_dir_all(&directory)?;
  let directory = std::fs::canonicalize(directory)?;
  let key = HyperIndexKey {
    workspace_id,
    directory: directory.clone(),
  };
  SEARCH_INDEX.retain(|_, state| state.strong_count() > 0);
  let mut entry = SEARCH_INDEX.entry(key).or_default();
  if let Some(state) = entry.upgrade() {
    return Ok(state);
  }
  info!(
    "[Indexing] Creating scoped tantivy state for workspace: {}",
    workspace_id
  );
  let state = Arc::new(RwLock::new(DocumentTantivyState::new_at_index_path(
    &workspace_id,
    data_path,
    directory,
  )?));
  *entry = Arc::downgrade(&state);
  Ok(state)
}

/// Release only an expired captured writer. Live contexts/requests retain their
/// Arc and cache entry, so a new context never opens a second physical writer.
pub fn close_document_tantivy_state(
  workspace_id: &Uuid,
  expected: &Weak<RwLock<DocumentTantivyState>>,
) {
  SEARCH_INDEX.retain(|key, state| {
    key.workspace_id != *workspace_id || !Weak::ptr_eq(state, expected) || state.strong_count() > 0
  });
}

pub fn get_document_tantivy_state(
  workspace_id: &Uuid,
  data_path: &Path,
) -> Option<Weak<RwLock<DocumentTantivyState>>> {
  let directory =
    std::fs::canonicalize(data_path.join(workspace_id.to_string()).join("documents")).ok()?;
  let entry = SEARCH_INDEX.get(&HyperIndexKey {
    workspace_id: *workspace_id,
    directory,
  })?;
  (entry.strong_count() > 0).then(|| entry.clone())
}

#[cfg(test)]
#[path = "hyper_index_scope_tests.rs"]
mod hyper_scope_tests;
