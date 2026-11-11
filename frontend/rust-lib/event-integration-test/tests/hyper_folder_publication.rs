use bytes::Bytes;
use collab_database::rows::RowId;
use collab_entity::EncodedCollab;
use collab_folder::ViewLayout;
use event_integration_test::EventIntegrationTest;
use event_integration_test::event_builder::EventBuilder;
use flowy_database2::entities::{FieldType, UpdateRowMetaParams};
use flowy_database2::services::field::StringCellData;
use flowy_document::manager::DocumentManager;
use flowy_error::FlowyError;
use flowy_folder::entities::{CreateViewParams, ViewLayoutPB};
use flowy_folder::entities::{DuplicateViewPayloadPB, ViewPB};
use flowy_folder::event_map::FolderEvent;
use flowy_folder::manager::FolderInitDataSource;
use flowy_folder::share::ImportType;
use flowy_folder::view_operation::{FolderOperationHandler, ImportedData, ViewData};
use lib_infra::async_trait::async_trait;
use lib_infra::box_any::BoxAny;
use std::sync::Arc;
use tokio::sync::Notify;
use uuid::Uuid;

struct HeldHandler {
  document: Arc<DocumentManager>,
  entered: Arc<Notify>,
  release: Arc<Notify>,
}

#[tokio::test]
async fn hyper_duplicate_sync_after_create_publishes_current_database_without_root_snapshot_upload()
{
  let fixture = EventIntegrationTest::new_anon().await;
  let core = &fixture.appflowy_core;
  let workspace = core.user_manager.workspace_id().unwrap();
  let source = fixture
    .create_view_with_layout(
      &workspace.to_string(),
      "Synced copy".into(),
      ViewLayoutPB::Grid,
    )
    .await;
  let original = core
    .database_manager
    .get_database_editor_with_view_id(&source.id)
    .await
    .unwrap();
  let rows = original.get_row_ids().await;
  // This is the real Folder DuplicateView path with its legacy batch option on.
  // The folder helper's separate regression proves database snapshots are never
  // returned for that upload branch; ordinary document/import behavior remains.
  let copied: ViewPB = EventBuilder::new(fixture.clone())
    .event(FolderEvent::DuplicateView)
    .payload(DuplicateViewPayloadPB {
      view_id: source.id.clone(),
      sync_after_create: true,
      ..Default::default()
    })
    .async_send()
    .await
    .parse_or_panic();
  let target = core
    .database_manager
    .get_database_editor_with_view_id(&copied.id)
    .await
    .unwrap();
  let data = target.open_database_view(&copied.id, None).await.unwrap();
  assert_eq!(data.rows.len(), rows.len());
  assert!(!data.rows.is_empty());
  for row in &data.rows {
    let id: RowId = row.id.clone().into();
    assert!(!rows.contains(&id));
    assert!(target.get_row_meta(&copied.id, &id).await.is_some());
  }
  assert_eq!(original.get_row_ids().await, rows);
}

#[tokio::test]
async fn hyper_row_metadata_first_write_survives_cell_edit_and_database_reopen() {
  let fixture = EventIntegrationTest::new_anon().await;
  let core = &fixture.appflowy_core;
  let uid = core.user_manager.user_id().unwrap();
  let workspace = core.user_manager.workspace_id().unwrap();
  let view = fixture
    .create_view_with_layout(
      &workspace.to_string(),
      "Metadata before cells".into(),
      ViewLayoutPB::Grid,
    )
    .await;
  let editor = core
    .database_manager
    .get_database_editor_with_view_id(&view.id)
    .await
    .unwrap();
  let initial = editor.open_database_view(&view.id, None).await.unwrap();
  let row: RowId = initial.rows[0].id.clone().into();
  let field = editor
    .get_fields(&view.id, None)
    .await
    .into_iter()
    .find(|field| field.field_type == FieldType::RichText as i64)
    .unwrap();
  // Match Add content: metadata is the first write, without a separate InitRow.
  editor
    .update_row_meta(
      &row,
      UpdateRowMetaParams {
        id: initial.rows[0].id.clone(),
        view_id: view.id.clone(),
        icon_url: Some("metadata retained".into()),
        is_document_empty: Some(false),
        attachment_count: Some(7),
        ..Default::default()
      },
    )
    .await
    .unwrap();
  editor
    .update_cell_with_changeset(
      &view.id,
      &row,
      &field.id,
      BoxAny::new("cell retained".to_string()),
    )
    .await
    .unwrap();
  // A fresh manager/context rereads storage instead of accepting the live row cache.
  core.database_manager.initialize(uid, true).await.unwrap();
  let reopened = core
    .database_manager
    .get_database_editor_with_view_id(&view.id)
    .await
    .unwrap();
  let data = reopened.open_database_view(&view.id, None).await.unwrap();
  assert_eq!(
    data.rows.iter().map(|row| &row.id).collect::<Vec<_>>(),
    initial.rows.iter().map(|row| &row.id).collect::<Vec<_>>()
  );
  let metadata = reopened.get_row_meta(&view.id, &row).await.unwrap();
  assert_eq!(metadata.icon.as_deref(), Some("metadata retained"));
  assert_eq!(metadata.is_document_empty, Some(false));
  assert_eq!(metadata.attachment_count, Some(7));
  assert_eq!(
    StringCellData::from(&reopened.get_cell(&field.id, &row).await.unwrap()).into_inner(),
    "cell retained"
  );
  assert!(
    editor
      .update_row_meta(
        &row,
        UpdateRowMetaParams {
          id: row.to_string(),
          view_id: view.id.clone(),
          icon_url: Some("stale write".into()),
          ..Default::default()
        }
      )
      .await
      .is_err()
  );
  assert_eq!(
    reopened
      .get_row_meta(&view.id, &row)
      .await
      .unwrap()
      .icon
      .as_deref(),
    Some("metadata retained")
  );
}

#[tokio::test]
async fn hyper_row_metadata_missing_row_returns_error_without_creating_or_replacing_rows() {
  let fixture = EventIntegrationTest::new_anon().await;
  let core = &fixture.appflowy_core;
  let workspace = core.user_manager.workspace_id().unwrap();
  let view = fixture
    .create_view_with_layout(
      &workspace.to_string(),
      "Missing metadata row".into(),
      ViewLayoutPB::Grid,
    )
    .await;
  let editor = core
    .database_manager
    .get_database_editor_with_view_id(&view.id)
    .await
    .unwrap();
  let initial = editor.open_database_view(&view.id, None).await.unwrap();
  let missing: RowId = Uuid::new_v4().to_string().into();
  assert!(
    editor
      .update_row_meta(
        &missing,
        UpdateRowMetaParams {
          id: missing.to_string(),
          view_id: view.id.clone(),
          is_document_empty: Some(false),
          ..Default::default()
        }
      )
      .await
      .is_err()
  );
  assert_eq!(
    editor
      .get_row_ids()
      .await
      .iter()
      .map(|id| id.as_str())
      .collect::<Vec<_>>(),
    initial
      .rows
      .iter()
      .map(|row| row.id.as_str())
      .collect::<Vec<_>>()
  );
}

#[tokio::test]
async fn hyper_duplicate_retry_does_not_resurrect_a_deleted_empty_row() {
  let fixture = EventIntegrationTest::new_anon().await;
  let core = &fixture.appflowy_core;
  let workspace = core.user_manager.workspace_id().unwrap();
  let view = fixture
    .create_view_with_layout(
      &workspace.to_string(),
      "Copy retry tombstone".into(),
      ViewLayoutPB::Grid,
    )
    .await;
  let editor = core
    .database_manager
    .get_database_editor_with_view_id(&view.id)
    .await
    .unwrap();
  let source = editor.get_row_ids().await[0].clone();
  let operation = Uuid::new_v4().to_string();
  let copied = editor
    .duplicate_row_with_operation(&view.id, &source, Some(&operation))
    .await
    .unwrap();
  assert_ne!(copied.id, source.to_string());
  editor.delete_rows(&[copied.id.clone().into()]).await;
  assert!(
    !editor
      .get_row_ids()
      .await
      .iter()
      .any(|id| id.as_str() == copied.id)
  );
  let repeated = editor
    .duplicate_row_with_operation(&view.id, &source, Some(&operation))
    .await;
  assert!(
    repeated.is_err(),
    "a completed operation must not recreate a row the user deleted"
  );
  assert!(
    !editor
      .get_row_ids()
      .await
      .iter()
      .any(|id| id.as_str() == copied.id)
  );
}
#[async_trait]
impl FolderOperationHandler for HeldHandler {
  fn name(&self) -> &str {
    "hyper held publication fixture"
  }
  async fn open_view(&self, _: &Uuid) -> Result<(), FlowyError> {
    Ok(())
  }
  async fn close_view(&self, _: &Uuid) -> Result<(), FlowyError> {
    Ok(())
  }
  async fn delete_view(&self, _: &Uuid) -> Result<(), FlowyError> {
    Err(FlowyError::not_support())
  }
  async fn duplicate_view(&self, _: &Uuid) -> Result<Bytes, FlowyError> {
    Err(FlowyError::not_support())
  }
  async fn create_view_with_view_data(
    &self,
    uid: i64,
    params: CreateViewParams,
  ) -> Result<Option<EncodedCollab>, FlowyError> {
    let encoded = self
      .document
      .create_document(uid, &params.view_id, None)
      .await?;
    self.entered.notify_one();
    self.release.notified().await;
    Ok(Some(encoded))
  }
  async fn create_default_view(
    &self,
    _: i64,
    _: &Uuid,
    _: &Uuid,
    _: &str,
    _: ViewLayout,
  ) -> Result<(), FlowyError> {
    Err(FlowyError::not_support())
  }
  async fn import_from_bytes(
    &self,
    _: i64,
    _: &Uuid,
    _: &str,
    _: ImportType,
    _: Vec<u8>,
  ) -> Result<Vec<ImportedData>, FlowyError> {
    Err(FlowyError::not_support())
  }
  async fn import_from_file_path(&self, _: &str, _: &str, _: String) -> Result<(), FlowyError> {
    Err(FlowyError::not_support())
  }
}

#[tokio::test]
async fn hyper_publication_owner_reinitialization_rejects_a_held_handler_and_retains_its_committed_collab()
 {
  let fixture = EventIntegrationTest::new_anon().await;
  let core = &fixture.appflowy_core;
  let folder = core.folder_manager.clone();
  let uid = core.user_manager.user_id().unwrap();
  let workspace = core.user_manager.workspace_id().unwrap();
  let id = Uuid::new_v4();
  let entered = Arc::new(Notify::new());
  let release = Arc::new(Notify::new());
  folder.register_operation_handler(
    ViewLayout::Document,
    Arc::new(HeldHandler {
      document: core.document_manager.clone(),
      entered: entered.clone(),
      release: release.clone(),
    }),
  );
  let creating = folder.clone();
  let task = tokio::spawn(async move {
    creating
      .create_view_with_params(
        CreateViewParams {
          parent_view_id: workspace,
          view_id: id,
          name: "Captured owner copy".into(),
          layout: ViewLayoutPB::Document,
          initial_data: ViewData::DuplicateData(Bytes::from_static(b"fixture")),
          meta: Default::default(),
          set_as_current: false,
          index: None,
          section: None,
          icon: None,
          extra: None,
        },
        true,
      )
      .await
  });
  entered.notified().await;
  folder
    .initialize_after_open_workspace(
      uid,
      FolderInitDataSource::LocalDisk {
        create_if_not_exist: false,
      },
    )
    .await
    .unwrap();
  release.notify_one();
  let result = tokio::time::timeout(std::time::Duration::from_secs(3), task)
    .await
    .unwrap()
    .unwrap();
  assert!(
    result.is_err(),
    "a successful backing handler must not publish into a replaced folder context"
  );
  assert!(result.unwrap_err().msg.contains("owner"));
  assert!(folder.get_view(&id.to_string()).await.is_err());
  let db = core
    .user_manager
    .get_collab_db(uid)
    .unwrap()
    .upgrade()
    .unwrap();
  assert!(
    core
      .document_manager
      .snapshot_for_duplicate(uid, workspace, &db, &id, true)
      .await
      .unwrap()
      .is_some(),
    "committed backing data must be retained for recovery"
  );
  folder
    .initialize_after_open_workspace(
      uid,
      FolderInitDataSource::LocalDisk {
        create_if_not_exist: false,
      },
    )
    .await
    .unwrap();
  assert!(folder.get_view(&id.to_string()).await.is_err());
}
