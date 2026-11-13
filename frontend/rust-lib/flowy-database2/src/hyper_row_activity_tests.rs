use super::*;
use crate::manager::hyper_creation_tests::Fixture;

async fn source(count: usize) -> (Fixture, Arc<DatabaseEditor>, String, Vec<RowId>, String) {
  let f = Fixture::new(false).await;
  let view = Uuid::new_v4().to_string();
  let mut params = crate::template::make_default_grid(&view, "Activity rows");
  let database = params.database_id.clone();
  params.rows = (0..count)
    .map(|_| {
      collab_database::rows::CreateRowParams::new(Uuid::new_v4().to_string(), database.clone())
    })
    .collect();
  let ids = params.rows.iter().map(|row| row.id.clone()).collect();
  f.manager.import_database(params).await.unwrap();
  let editor = f
    .manager
    .get_database_editor_with_view_id(&view)
    .await
    .unwrap();
  let context = editor
    .open_database_view(&view, None)
    .await
    .unwrap()
    .row_activity_context;
  (f, editor, view, ids, context)
}

fn request(
  view: &str,
  context: &str,
  id: Uuid,
  revision: u64,
  rows: &[RowId],
) -> HyperUpdateRowActivityPB {
  HyperUpdateRowActivityPB {
    view_id: view.into(),
    context_id: context.into(),
    activity_id: id.to_string(),
    revision,
    row_ids: rows.iter().map(ToString::to_string).collect(),
    close_activity: false,
  }
}

fn close_request(view: &str, context: &str, id: Uuid, revision: u64) -> HyperUpdateRowActivityPB {
  HyperUpdateRowActivityPB {
    close_activity: true,
    ..request(view, context, id, revision, &[])
  }
}

async fn drain(editor: &DatabaseEditor) {
  editor.finalized_rows.run_pending_tasks().await;
  tokio::time::timeout(Duration::from_secs(5), async {
    loop {
      let changed = editor.row_cleanup_finished.notified();
      if editor
        .row_cleanup_pending
        .load(std::sync::atomic::Ordering::SeqCst)
        == 0
      {
        break;
      }
      changed.await;
    }
  })
  .await
  .unwrap();
}

async fn row(editor: &DatabaseEditor, id: &RowId) -> Arc<RwLock<DatabaseRow>> {
  editor
    .database
    .read()
    .await
    .get_or_init_database_row(id)
    .await
    .unwrap()
}

async fn idle_row(editor: &DatabaseEditor, id: &RowId) -> Arc<RwLock<DatabaseRow>> {
  editor.init_database_row(id).await.unwrap();
  editor.finalized_rows.invalidate_all();
  drain(editor).await;
  let row = row(editor, id).await;
  assert!(!row.read().await.has_cloud_plugin());
  row
}

async fn desired_pin(editor: &DatabaseEditor, id: &RowId, row: &Arc<RwLock<DatabaseRow>>) {
  tokio::time::timeout(Duration::from_secs(2), async {
    while !editor
      .row_activities
      .pinned(id.as_str(), &Arc::downgrade(row))
    {
      tokio::task::yield_now().await;
    }
    tokio::task::yield_now().await;
  })
  .await
  .unwrap();
}

#[tokio::test]
async fn hyper_row_activity_held_reader_waits_then_initializes_exactly_once() {
  let (f, editor, view, ids, context) = source(1).await;
  let row = idle_row(&editor, &ids[0]).await;
  let reader = row.read().await;
  let activity = Uuid::new_v4();
  let payload = request(&view, &context, activity, 1, &ids);
  let e = editor.clone();
  let activating = tokio::spawn(async move { e.hyper_update_row_activity(payload).await });
  desired_pin(&editor, &ids[0], &row).await;
  assert!(
    !activating.is_finished(),
    "an ordinary row reader must not fail first activation"
  );
  assert_eq!(f.count(ids[0].as_str()), 1);
  drop(reader);
  assert_eq!(activating.await.unwrap().unwrap().revision, 1);
  assert!(row.read().await.has_cloud_plugin());
  assert_eq!(f.count(ids[0].as_str()), 2);
  f.manager
    .hyper_update_row_activity(request(&view, &context, activity, 1, &ids))
    .await
    .unwrap();
  assert_eq!(f.count(ids[0].as_str()), 2);
}

#[tokio::test]
async fn hyper_row_activity_release_while_waiting_for_row_reader_never_late_initializes() {
  let (f, editor, view, ids, context) = source(1).await;
  let row = idle_row(&editor, &ids[0]).await;
  let reader = row.read().await;
  let activity = Uuid::new_v4();
  let e = editor.clone();
  let payload = request(&view, &context, activity, 1, &ids);
  let activating = tokio::spawn(async move { e.hyper_update_row_activity(payload).await });
  desired_pin(&editor, &ids[0], &row).await;
  assert!(!activating.is_finished());
  let e = editor.clone();
  let payload = close_request(&view, &context, activity, 2);
  let releasing = tokio::spawn(async move { e.hyper_update_row_activity(payload).await });
  tokio::time::timeout(Duration::from_secs(2), async {
    while editor
      .row_activities
      .matches(&view, &Uuid::parse_str(&context).unwrap())
    {
      tokio::task::yield_now().await;
    }
  })
  .await
  .unwrap();
  drop(reader);
  assert_eq!(releasing.await.unwrap().unwrap().revision, 2);
  assert!(activating.await.unwrap().is_err());
  assert!(!row.read().await.has_cloud_plugin());
  assert_eq!(f.count(ids[0].as_str()), 1);
  assert!(
    !editor
      .row_activities
      .pinned(ids[0].as_str(), &Arc::downgrade(&row))
  );
}

#[tokio::test]
async fn hyper_row_activity_owner_loss_cancels_row_write_wait_without_late_initialization() {
  let (f, editor, view, ids, context) = source(1).await;
  let row = idle_row(&editor, &ids[0]).await;
  let reader = row.read().await;
  let activity = Uuid::new_v4();
  let e = editor.clone();
  let payload = request(&view, &context, activity, 1, &ids);
  let activating = tokio::spawn(async move { e.hyper_update_row_activity(payload).await });
  desired_pin(&editor, &ids[0], &row).await;
  assert!(!activating.is_finished());
  f.manager.invalidate_duplicate_operations();
  assert!(
    tokio::time::timeout(Duration::from_secs(2), activating)
      .await
      .unwrap()
      .unwrap()
      .is_err()
  );
  // Cancellation must not need the reader to release its guard first.
  assert!(!reader.has_cloud_plugin());
  drop(reader);
  tokio::task::yield_now().await;
  assert!(!row.read().await.has_cloud_plugin());
  assert_eq!(f.count(ids[0].as_str()), 1);
  assert!(
    !editor
      .row_activities
      .pinned(ids[0].as_str(), &Arc::downgrade(&row))
  );
}

#[tokio::test]
async fn hyper_row_activity_more_than_fifty_pins_survive_eviction_then_return_to_idle_limit() {
  let (f, editor, view, ids, context) = source(60).await;
  let activity = Uuid::new_v4();
  f.manager
    .hyper_update_row_activity(request(&view, &context, activity, 1, &ids))
    .await
    .unwrap();
  let old = editor.row_sync_state.lock().unwrap().current[ids[0].as_str()].clone();
  editor.finalized_rows.invalidate_all();
  drain(&editor).await;
  for id in &ids {
    assert!(row(&editor, id).await.read().await.has_cloud_plugin());
    assert_eq!(f.count(id.as_str()), 1);
  }
  f.manager
    .hyper_update_row_activity(request(&view, &context, activity, 2, &[]))
    .await
    .unwrap();
  drain(&editor).await;
  let mut retained = 0;
  let mut evicted = None;
  for id in &ids {
    if row(&editor, id).await.read().await.has_cloud_plugin() {
      retained += 1;
    } else {
      evicted = Some(id.clone());
    }
  }
  assert!(retained <= 50);
  let id = evicted.unwrap();
  f.manager
    .hyper_update_row_activity(request(
      &view,
      &context,
      activity,
      3,
      std::slice::from_ref(&id),
    ))
    .await
    .unwrap();
  let active = row(&editor, &id).await;
  // The already queued callback for this same instance must not remove a new pin.
  if id == ids[0] {
    cleanup_finalized_row(
      id.as_str(),
      old,
      moka::notification::RemovalCause::Explicit,
      &editor.row_initialization,
      &editor.row_sync_state,
      &editor.row_activities,
    )
    .await;
  }
  drain(&editor).await;
  assert!(active.read().await.has_cloud_plugin());
  assert_eq!(f.count(id.as_str()), 2);
}

#[tokio::test]
async fn hyper_row_activity_overlapping_linked_views_survive_close_reopen_and_old_release() {
  let (f, editor, view, ids, context) = source(60).await;
  let linked = Uuid::new_v4().to_string();
  f.manager
    .create_linked_view(
      "Linked".into(),
      DatabaseLayout::Grid,
      editor.database_id.to_string(),
      linked.clone(),
      view.clone(),
    )
    .await
    .unwrap();
  let (first, second) = tokio::join!(
    editor.open_database_view(&view, None),
    editor.open_database_view(&linked, None)
  );
  let first = first.unwrap();
  let second = second.unwrap();
  assert_eq!(first.row_activity_context, context);
  assert_ne!(first.row_activity_context, second.row_activity_context);
  let a = Uuid::new_v4();
  let b = Uuid::new_v4();
  f.manager
    .hyper_update_row_activity(request(&view, &context, a, 1, &ids[..40]))
    .await
    .unwrap();
  f.manager
    .hyper_update_row_activity(request(
      &linked,
      &second.row_activity_context,
      b,
      1,
      &ids[30..],
    ))
    .await
    .unwrap();
  let common = row(&editor, &ids[35]).await;
  let old = editor.row_sync_state.lock().unwrap().current[ids[35].as_str()].clone();
  editor.close_view(&view).await;
  let reopened = editor
    .open_database_view(&view, None)
    .await
    .unwrap()
    .row_activity_context;
  assert_ne!(reopened, context);
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, a, 2, &ids[..1]))
      .await
      .is_err()
  );
  f.manager
    .hyper_update_row_activity(close_request(&view, &context, a, 3))
    .await
    .unwrap();
  f.manager
    .hyper_update_row_activity(request(&view, &reopened, Uuid::new_v4(), 1, &ids[..40]))
    .await
    .unwrap();
  cleanup_finalized_row(
    ids[35].as_str(),
    old,
    moka::notification::RemovalCause::Explicit,
    &editor.row_initialization,
    &editor.row_sync_state,
    &editor.row_activities,
  )
  .await;
  drain(&editor).await;
  assert!(common.read().await.has_cloud_plugin());
  for id in &ids[30..] {
    assert!(row(&editor, id).await.read().await.has_cloud_plugin());
    assert_eq!(f.count(id.as_str()), 1);
  }
}

#[tokio::test]
async fn hyper_row_activity_release_reservation_cancels_older_queued_initialization() {
  let (f, editor, view, ids, context) = source(3).await;
  let id = Uuid::new_v4();
  let lock = editor.row_initialization.lock().await;
  let first = request(&view, &context, id, 1, &ids);
  let e = editor.clone();
  let older = tokio::spawn(async move { e.hyper_update_row_activity(first).await });
  tokio::task::yield_now().await;
  let release = request(&view, &context, id, 2, &[]);
  let e = editor.clone();
  let newer = tokio::spawn(async move { e.hyper_update_row_activity(release).await });
  tokio::task::yield_now().await;
  drop(lock);
  assert_eq!(newer.await.unwrap().unwrap().revision, 2);
  assert_eq!(older.await.unwrap().unwrap().revision, 2);
  for row_id in &ids {
    assert!(!editor.row_activities.pinned(
      row_id.as_str(),
      &Arc::downgrade(&row(&editor, row_id).await)
    ));
    assert_eq!(f.count(row_id.as_str()), 1);
  }
  assert_eq!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, id, 1, &ids))
      .await
      .unwrap()
      .revision,
    2
  );
}

#[tokio::test]
async fn hyper_row_activity_sync_invalidation_blocks_old_manager_and_preserves_new_row_arc() {
  let (f, old, view, ids, context) = source(3).await;
  let activity = Uuid::new_v4();
  f.manager
    .hyper_update_row_activity(request(&view, &context, activity, 1, &ids))
    .await
    .unwrap();
  let old_row = row(&old, &ids[0]).await;
  let lease = old.row_sync_state.lock().unwrap().current[ids[0].as_str()].clone();
  f.manager.invalidate_duplicate_operations();
  assert!(
    !old
      .row_activities
      .matches(&view, &Uuid::parse_str(&context).unwrap())
  );
  assert!(
    !old
      .row_activities
      .pinned(ids[0].as_str(), &Arc::downgrade(&old_row))
  );
  assert!(
    old
      .hyper_update_row_activity(request(&view, &context, activity, 2, &ids))
      .await
      .is_err()
  );
  f.manager.initialize(301, false).await.unwrap();
  let current = f
    .manager
    .get_database_editor_with_view_id(&view)
    .await
    .unwrap();
  let token = current
    .open_database_view(&view, None)
    .await
    .unwrap()
    .row_activity_context;
  f.manager
    .hyper_update_row_activity(request(&view, &token, Uuid::new_v4(), 1, &ids))
    .await
    .unwrap();
  let current_row = row(&current, &ids[0]).await;
  assert!(!Arc::ptr_eq(&current_row, &old_row));
  f.manager
    .hyper_update_row_activity(close_request(&view, &context, activity, 3))
    .await
    .unwrap();
  cleanup_finalized_row(
    ids[0].as_str(),
    lease,
    moka::notification::RemovalCause::Explicit,
    &old.row_initialization,
    &old.row_sync_state,
    &old.row_activities,
  )
  .await;
  assert!(current_row.read().await.has_cloud_plugin());
}

#[tokio::test]
async fn hyper_row_activity_invalid_member_and_revision_leave_existing_pins_unchanged() {
  let (f, editor, view, ids, context) = source(3).await;
  let activity = Uuid::new_v4();
  f.manager
    .hyper_update_row_activity(request(&view, &context, activity, 1, &ids[..1]))
    .await
    .unwrap();
  let foreign: RowId = Uuid::new_v4().to_string().into();
  assert!(
    editor
      .hyper_init_visible_row(&view, &foreign)
      .await
      .is_err()
  );
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, activity, 2, &[foreign]))
      .await
      .is_err()
  );
  assert!(editor.row_activities.pinned(
    ids[0].as_str(),
    &Arc::downgrade(&row(&editor, &ids[0]).await)
  ));
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, activity, 0, &[]))
      .await
      .is_err()
  );
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, activity, 1, &ids[..1]))
      .await
      .is_ok()
  );
  assert_eq!(f.count(ids[0].as_str()), 1);
}

#[tokio::test]
async fn hyper_row_activity_failed_initialization_keeps_desired_pins_until_release() {
  let (f, editor, view, ids, context) = source(3).await;
  let gate = f.manager.creation_gate.clone();
  assert!(
    std::thread::spawn(move || {
      let _guard = gate.lock().unwrap();
      panic!("fixture poison");
    })
    .join()
    .is_err()
  );
  let activity = Uuid::new_v4();
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, activity, 1, &ids))
      .await
      .is_err()
  );
  for id in &ids {
    assert!(
      editor
        .row_activities
        .pinned(id.as_str(), &Arc::downgrade(&row(&editor, id).await))
    );
  }
  f.manager
    .hyper_update_row_activity(request(&view, &context, activity, 2, &[]))
    .await
    .unwrap();
  for id in &ids {
    assert!(
      !editor
        .row_activities
        .pinned(id.as_str(), &Arc::downgrade(&row(&editor, id).await))
    );
  }
}

#[tokio::test]
async fn hyper_row_activity_inflight_get_database_cannot_reopen_retired_context() {
  let (_f, editor, view, _ids, context) = source(3).await;
  let pipeline = editor.open_pipeline.lock().await;
  let e = editor.clone();
  let old_view = view.clone();
  let pending = tokio::spawn(async move { e.open_database_view(&old_view, None).await });
  tokio::task::yield_now().await;
  editor.close_view(&view).await;
  drop(pipeline);
  assert!(pending.await.unwrap().is_err());
  assert_ne!(
    editor
      .open_database_view(&view, None)
      .await
      .unwrap()
      .row_activity_context,
    context
  );
}

#[tokio::test]
async fn hyper_copy_publication_initializes_all_actual_committed_rows_and_root_once() {
  let (f, editor, view, ids, _context) = source(3).await;
  let target = Uuid::new_v4().to_string();
  f.manager
    .hyper_duplicate_database(&view, &target)
    .await
    .unwrap();
  let copied = f
    .manager
    .get_database_editor_with_view_id(&target)
    .await
    .unwrap();
  let copied_rows = copied.get_row_ids().await;
  assert_eq!(copied_rows.len(), ids.len());
  assert_eq!(f.count(&copied.database_id.to_string()), 1);
  for id in &copied_rows {
    assert!(row(&copied, id).await.read().await.has_cloud_plugin());
    assert_eq!(f.count(id.as_str()), 1);
  }
  for id in &ids {
    assert_eq!(f.count(id.as_str()), 1);
  }
  assert!(
    f.manager
      .hyper_duplicate_database(&view, &target)
      .await
      .is_err()
  );
  assert_eq!(editor.get_row_ids().await, ids);
}

#[tokio::test]
async fn hyper_copy_publication_row_failure_retry_uses_existing_target_and_never_restores_deleted_row()
 {
  let (f, editor, view, ids, _context) = source(3).await;
  let operation = Uuid::new_v4().to_string();
  let gate = f.manager.creation_gate.clone();
  assert!(
    std::thread::spawn(move || {
      let _guard = gate.lock().unwrap();
      panic!("fixture publication failure");
    })
    .join()
    .is_err()
  );
  assert!(
    editor
      .duplicate_row_with_operation(&view, &ids[0], Some(&operation))
      .await
      .is_err()
  );
  let current = editor.get_row_ids().await;
  assert_eq!(current.len(), 4);
  let target = current.iter().find(|id| !ids.contains(id)).unwrap().clone();
  f.manager.creation_gate.clear_poison();
  let recovered = editor
    .duplicate_row_with_operation(&view, &ids[0], Some(&operation))
    .await
    .unwrap();
  assert_eq!(recovered.id, target.to_string());
  assert!(row(&editor, &target).await.read().await.has_cloud_plugin());
  assert_eq!(f.count(target.as_str()), 1);
  editor
    .duplicate_row_with_operation(&view, &ids[0], Some(&operation))
    .await
    .unwrap();
  assert_eq!(f.count(target.as_str()), 1);
  editor.delete_rows(std::slice::from_ref(&target)).await;
  assert!(
    editor
      .duplicate_row_with_operation(&view, &ids[0], Some(&operation))
      .await
      .is_err()
  );
  assert_eq!(editor.get_row_ids().await, ids);
}

#[tokio::test]
async fn hyper_row_activity_terminal_disposal_preserves_live_empty_and_linked_panes() {
  let (f, editor, view, ids, context) = source(3).await;
  let linked = Uuid::new_v4().to_string();
  f.manager
    .create_linked_view(
      "Linked".into(),
      DatabaseLayout::Grid,
      editor.database_id.to_string(),
      linked.clone(),
      view.clone(),
    )
    .await
    .unwrap();
  let linked_context = editor
    .open_database_view(&linked, None)
    .await
    .unwrap()
    .row_activity_context;
  let empty = Uuid::new_v4();
  let linked_activity = Uuid::new_v4();
  f.manager
    .hyper_update_row_activity(request(&view, &context, empty, 1, &[]))
    .await
    .unwrap();
  f.manager
    .hyper_update_row_activity(request(&linked, &linked_context, linked_activity, 1, &ids))
    .await
    .unwrap();
  for _ in 0..70 {
    let pane = Uuid::new_v4();
    f.manager
      .hyper_update_row_activity(request(&view, &context, pane, 1, &ids[..1]))
      .await
      .unwrap();
    f.manager
      .hyper_update_row_activity(close_request(&view, &context, pane, 2))
      .await
      .unwrap();
    assert!(
      f.manager
        .hyper_update_row_activity(request(&view, &context, pane, 3, &ids))
        .await
        .is_err()
    );
  }
  assert_eq!(
    editor
      .open_database_view(&view, None)
      .await
      .unwrap()
      .row_activity_context,
    context
  );
  f.manager
    .hyper_update_row_activity(close_request(&view, &context, empty, 2))
    .await
    .unwrap();
  let reopened = editor
    .open_database_view(&view, None)
    .await
    .unwrap()
    .row_activity_context;
  assert_ne!(reopened, context);
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, Uuid::new_v4(), 1, &[]))
      .await
      .is_err()
  );
  f.manager
    .hyper_update_row_activity(close_request(&view, &context, empty, 3))
    .await
    .unwrap();
  drain(&editor).await;
  for id in &ids {
    assert!(
      editor
        .row_activities
        .pinned(id.as_str(), &Arc::downgrade(&row(&editor, id).await))
    );
    assert_eq!(f.count(id.as_str()), 1);
  }
  assert_eq!(
    editor
      .open_database_view(&linked, None)
      .await
      .unwrap()
      .row_activity_context,
    linked_context
  );
}

#[tokio::test]
async fn hyper_row_activity_invalid_higher_revision_does_not_cancel_valid_pending_activation() {
  let (f, editor, view, ids, context) = source(3).await;
  let activity = Uuid::new_v4();
  let hold = editor.row_initialization.lock().await;
  let payload = request(&view, &context, activity, 1, &ids);
  let e = editor.clone();
  let valid = tokio::spawn(async move { e.hyper_update_row_activity(payload).await });
  tokio::task::yield_now().await;
  let foreign: RowId = Uuid::new_v4().to_string().into();
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, activity, 2, &[foreign]))
      .await
      .is_err()
  );
  drop(hold);
  assert_eq!(valid.await.unwrap().unwrap().revision, 1);
  for id in &ids {
    assert!(
      editor
        .row_activities
        .pinned(id.as_str(), &Arc::downgrade(&row(&editor, id).await))
    );
  }
}

#[tokio::test]
async fn hyper_row_activity_terminal_release_preempts_pending_activation_without_resurrection() {
  let (f, editor, view, ids, context) = source(3).await;
  let activity = Uuid::new_v4();
  let hold = editor.row_initialization.lock().await;
  let payload = request(&view, &context, activity, 1, &ids);
  let e = editor.clone();
  let valid = tokio::spawn(async move { e.hyper_update_row_activity(payload).await });
  tokio::task::yield_now().await;
  let payload = close_request(&view, &context, activity, 2);
  let e = editor.clone();
  let closed = tokio::spawn(async move { e.hyper_update_row_activity(payload).await });
  tokio::task::yield_now().await;
  drop(hold);
  assert_eq!(closed.await.unwrap().unwrap().revision, 2);
  assert!(valid.await.unwrap().is_err());
  assert!(
    f.manager
      .hyper_update_row_activity(request(&view, &context, activity, 3, &ids))
      .await
      .is_err()
  );
  for id in &ids {
    assert!(
      !editor
        .row_activities
        .pinned(id.as_str(), &Arc::downgrade(&row(&editor, id).await))
    );
  }
}
