use std::sync::{Arc, Weak};

use collab::core::collab::DataSource;
use collab::lock::RwLock;
use collab_entity::reminder::Reminder;
use collab_entity::CollabType;
use collab_integrate::collab_builder::{
  AppFlowyCollabBuilder, CollabBuilderConfig, CollabPersistenceImpl,
};
use collab_integrate::{CollabKVAction, CollabKVDB};
use collab_plugins::local_storage::kv::KVTransactionDB;
use collab_user::core::{UserAwareness, UserAwarenessNotifier};
use flowy_error::{internal_error, FlowyError, FlowyResult};
use flowy_user_pub::entities::{user_awareness_object_id, WorkspaceType};
use tracing::{error, instrument};
use uuid::Uuid;

use super::hyper_awareness_lifecycle::HyperAwarenessLifecycle;
use crate::entities::ReminderPB;
use crate::notification::{send_notification, UserNotification};
use crate::services::authenticate_user::AuthenticateUser;
use crate::user_manager::UserManager;

fn owner_changed() -> FlowyError {
  FlowyError::invalid_data()
    .with_context("The account or workspace changed while loading reminders.")
}

/// A weak physical DB identity prevents an old load from reopening or publishing into a new root.
#[derive(Clone)]
struct HyperAwarenessOwner {
  epoch: u64,
  uid: i64,
  user_uuid: Uuid,
  workspace: Uuid,
  authenticate_user: Weak<AuthenticateUser>,
  db: Weak<CollabKVDB>,
  lifecycle: Arc<HyperAwarenessLifecycle>,
}

impl HyperAwarenessOwner {
  fn check_identity(&self) -> FlowyResult<()> {
    let user = self.authenticate_user.upgrade().ok_or_else(owner_changed)?;
    let session = user.get_session()?;
    if session.user_id != self.uid
      || session.user_uuid != self.user_uuid
      || session.workspace_id != self.workspace.to_string()
    {
      return Err(owner_changed());
    }
    let expected = self.db.upgrade().ok_or_else(owner_changed)?;
    let current = user
      .get_collab_db(self.uid)?
      .upgrade()
      .ok_or_else(owner_changed)?;
    if !Arc::ptr_eq(&expected, &current) {
      return Err(owner_changed());
    }
    Ok(())
  }

  fn current<T>(&self, operation: impl FnOnce() -> FlowyResult<T>) -> FlowyResult<T> {
    self.lifecycle.current(self.epoch, || {
      self.check_identity()?;
      operation()
    })
  }

  fn check(&self) -> FlowyResult<()> {
    self.current(|| Ok(()))
  }
}

struct HyperCurrentAwareness {
  owner: HyperAwarenessOwner,
  awareness: Arc<RwLock<UserAwareness>>,
}

impl UserManager {
  /// Called before the first await of an owner transition, not from the later core callback.
  pub(crate) fn begin_awareness_owner(&self) -> u64 {
    self
      .awareness_lifecycle
      .begin(|| self.user_awareness_by_workspace.clear())
  }

  fn capture_awareness_owner(
    &self,
    uid: i64,
    user_uuid: Uuid,
    workspace: Uuid,
    epoch: u64,
  ) -> FlowyResult<HyperAwarenessOwner> {
    self.awareness_lifecycle.current(epoch, || {
      let session = self.authenticate_user.get_session()?;
      if session.user_id != uid
        || session.user_uuid != user_uuid
        || session.workspace_id != workspace.to_string()
      {
        return Err(owner_changed());
      }
      let owner = HyperAwarenessOwner {
        epoch,
        uid,
        user_uuid,
        workspace,
        authenticate_user: Arc::downgrade(&self.authenticate_user),
        db: self.get_collab_db(uid)?,
        lifecycle: self.awareness_lifecycle.clone(),
      };
      owner.check_identity()?;
      Ok(owner)
    })
  }

  fn current_awareness<T>(
    &self,
    captured: &HyperCurrentAwareness,
    operation: impl FnOnce() -> FlowyResult<T>,
  ) -> FlowyResult<T> {
    captured.owner.current(|| {
      if !self
        .user_awareness_by_workspace
        .get(&captured.owner.workspace)
        .is_some_and(|entry| Arc::ptr_eq(entry.value(), &captured.awareness))
      {
        return Err(owner_changed());
      }
      operation()
    })
  }

  pub async fn add_reminder(&self, reminder_pb: ReminderPB) -> FlowyResult<()> {
    let reminder = Reminder::from(reminder_pb);
    let current = self.get_awareness().await?;
    let mut awareness = current.awareness.write().await;
    self.current_awareness(&current, || {
      awareness.add_reminder(reminder.clone());
      Ok(())
    })?;
    drop(awareness);
    let interact = self.collab_interact.read().await;
    current.owner.check()?;
    interact.add_reminder(reminder).await?;
    current.owner.check()
  }

  pub async fn remove_reminder(&self, reminder_id: &str) -> FlowyResult<()> {
    let current = self.get_awareness().await?;
    let mut awareness = current.awareness.write().await;
    self.current_awareness(&current, || {
      awareness.remove_reminder(reminder_id);
      Ok(())
    })?;
    drop(awareness);
    let interact = self.collab_interact.read().await;
    current.owner.check()?;
    interact.remove_reminder(reminder_id).await?;
    current.owner.check()
  }

  pub async fn update_reminder(&self, reminder_pb: ReminderPB) -> FlowyResult<()> {
    let reminder = Reminder::from(reminder_pb);
    let current = self.get_awareness().await?;
    let mut awareness = current.awareness.write().await;
    self.current_awareness(&current, || {
      awareness.update_reminder(&reminder.id, |update| {
        update
          .set_object_id(&reminder.object_id)
          .set_title(&reminder.title)
          .set_message(&reminder.message)
          .set_is_ack(reminder.is_ack)
          .set_is_read(reminder.is_read)
          .set_scheduled_at(reminder.scheduled_at)
          .set_type(reminder.ty)
          .set_meta(reminder.meta.clone().into_inner());
      });
      Ok(())
    })?;
    drop(awareness);
    let interact = self.collab_interact.read().await;
    current.owner.check()?;
    interact.update_reminder(reminder).await?;
    current.owner.check()
  }

  pub async fn get_all_reminders(&self) -> FlowyResult<Vec<Reminder>> {
    let current = self.get_awareness().await?;
    let awareness = current.awareness.read().await;
    self.current_awareness(&current, || Ok(awareness.get_all_reminders()))
  }

  #[instrument(level = "info", skip(self), err)]
  pub(crate) async fn initial_user_awareness(
    &self,
    uid: i64,
    user_uuid: &Uuid,
    workspace_id: &Uuid,
    workspace_type: &WorkspaceType,
    epoch: u64,
  ) -> FlowyResult<()> {
    let owner = self.capture_awareness_owner(uid, *user_uuid, *workspace_id, epoch)?;
    let object_id = user_awareness_object_id(user_uuid, &workspace_id.to_string());
    let load = self.awareness_lifecycle.reserve(epoch, object_id)?;
    let is_on_disk = owner.current(|| {
      let db = owner.db.upgrade().ok_or_else(owner_changed)?;
      let read = db.read_txn();
      Ok(read.is_exist(uid, &workspace_id.to_string(), &object_id.to_string()))
    })?;
    if workspace_type.is_local() || is_on_disk {
      let source =
        CollabPersistenceImpl::new(owner.db.clone(), uid, *workspace_id).into_data_source();
      let awareness =
        Self::collab_for_user_awareness(&self.collab_builder, &owner, object_id, source, None)
          .await?;
      load.publish(|| {
        owner.check_identity()?;
        self
          .user_awareness_by_workspace
          .insert(*workspace_id, awareness);
        send_notification(workspace_id, UserNotification::DidLoadUserAwareness).send();
        Ok(())
      })?;
    } else {
      // Capture the actual service now. A late task cannot resolve a new owner's service.
      let service = owner.current(|| self.cloud_service()?.get_user_service())?;
      let weak_builder = self.collab_builder.clone();
      let shared = self.user_awareness_by_workspace.clone();
      tokio::spawn(async move {
        let result = async {
          owner.check()?;
          let fetched = service
            .get_user_awareness_doc_state(uid, &owner.workspace, &object_id)
            .await;
          owner.check()?;
          let source = match fetched {
            Ok(data) => DataSource::DocStateV1(data),
            Err(error) if error.is_record_not_found() => {
              CollabPersistenceImpl::new(owner.db.clone(), uid, owner.workspace).into_data_source()
            },
            Err(error) => return Err(error),
          };
          let awareness =
            Self::collab_for_user_awareness(&weak_builder, &owner, object_id, source, None).await?;
          load.publish(|| {
            owner.check_identity()?;
            shared.insert(owner.workspace, awareness);
            send_notification(owner.workspace, UserNotification::DidLoadUserAwareness).send();
            Ok(())
          })
        }
        .await;
        if let Err(error) = result {
          error!(
            "Failed to load reminders for their captured owner: {:?}",
            error
          );
        }
      });
    }
    Ok(())
  }

  async fn collab_for_user_awareness(
    collab_builder: &Weak<AppFlowyCollabBuilder>,
    owner: &HyperAwarenessOwner,
    object_id: Uuid,
    doc_state: DataSource,
    notifier: Option<UserAwarenessNotifier>,
  ) -> FlowyResult<Arc<RwLock<UserAwareness>>> {
    let builder = collab_builder.upgrade().ok_or_else(owner_changed)?;
    let object = owner.current(|| {
      builder
        .collab_object(
          &owner.workspace,
          owner.uid,
          &object_id,
          CollabType::UserAwareness,
        )
        .map_err(internal_error)
    })?;
    let collab = builder
      .build_collab(&object, &owner.db, doc_state)
      .await
      .map_err(internal_error)?;
    // Finalize adds sync plugins and initializes persistence. Keep that synchronous
    // boundary inside the owner lock, after the blocking build has completed.
    owner.current(|| {
      let awareness = UserAwareness::create(collab, notifier).map_err(internal_error)?;
      builder
        .finalize(
          object,
          CollabBuilderConfig::default().sync_enable(true),
          Arc::new(RwLock::new(awareness)),
        )
        .map_err(internal_error)
    })
  }

  async fn get_awareness(&self) -> FlowyResult<HyperCurrentAwareness> {
    let session = self.get_session()?;
    let workspace = Uuid::parse_str(&session.workspace_id).map_err(internal_error)?;
    let owner = self.capture_awareness_owner(
      session.user_id,
      session.user_uuid,
      workspace,
      self.awareness_lifecycle.epoch(),
    )?;
    let awareness = owner.current(|| {
      self
        .user_awareness_by_workspace
        .get(&workspace)
        .map(|value| value.value().clone())
        .ok_or_else(|| FlowyError::internal().with_context("User awareness is not loaded"))
    })?;
    {
      let active = awareness.read().await;
      owner.check()?;
      if active.object_id()
        != user_awareness_object_id(&session.user_uuid, &workspace.to_string()).to_string()
        || active.origin().client_user_id() != Some(session.user_id)
      {
        return Err(owner_changed());
      }
    }
    Ok(HyperCurrentAwareness { owner, awareness })
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::services::entities::UserConfig;
  use flowy_sqlite::kv::KVStorePreferences;
  use flowy_user_pub::session::Session;
  use semver::Version;
  use std::sync::atomic::{AtomicUsize, Ordering};
  use tempfile::TempDir;

  fn authenticated(uid: i64, user_uuid: Uuid, workspace: Uuid) -> (TempDir, Arc<AuthenticateUser>) {
    let root = tempfile::tempdir().unwrap();
    let root_str = root.path().to_str().unwrap();
    let preferences = Arc::new(KVStorePreferences::new(root_str).unwrap());
    let user = Arc::new(AuthenticateUser::new(
      UserConfig::new(
        "hyper-awareness",
        root_str,
        root_str,
        "isolated-test",
        Version::new(0, 11, 4),
      ),
      preferences,
    ));
    user
      .set_session(Some(Arc::new(Session {
        user_id: uid,
        user_uuid,
        workspace_id: workspace.to_string(),
      })))
      .unwrap();
    (root, user)
  }

  fn captured(
    user: &Arc<AuthenticateUser>,
    lifecycle: &Arc<HyperAwarenessLifecycle>,
  ) -> HyperAwarenessOwner {
    let session = user.get_session().unwrap();
    HyperAwarenessOwner {
      epoch: lifecycle.epoch(),
      uid: session.user_id,
      user_uuid: session.user_uuid,
      workspace: Uuid::parse_str(&session.workspace_id).unwrap(),
      authenticate_user: Arc::downgrade(user),
      db: user.get_collab_db(session.user_id).unwrap(),
      lifecycle: lifecycle.clone(),
    }
  }

  #[test]
  fn hyper_awareness_current_owner_uses_the_captured_real_database() {
    let (_root, user) = authenticated(71, Uuid::new_v4(), Uuid::new_v4());
    let lifecycle = Arc::new(HyperAwarenessLifecycle::default());
    let owner = captured(&user, &lifecycle);
    assert!(owner.check().is_ok());
    assert!(owner
      .db
      .upgrade()
      .is_some_and(|db| Arc::ptr_eq(&db, &user.get_collab_db(71).unwrap().upgrade().unwrap())));
  }

  #[test]
  fn hyper_awareness_same_uid_workspace_different_real_roots_cannot_publish() {
    let uuid = Uuid::new_v4();
    let workspace = Uuid::new_v4();
    let (_root_a, a) = authenticated(72, uuid, workspace);
    let (_root_b, b) = authenticated(72, uuid, workspace);
    let lifecycle = Arc::new(HyperAwarenessLifecycle::default());
    let mut old = captured(&a, &lifecycle);
    old.authenticate_user = Arc::downgrade(&b);
    let writes = AtomicUsize::new(0);
    assert!(old
      .current(|| {
        writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
      })
      .is_err());
    assert_eq!(writes.load(Ordering::SeqCst), 0);
  }

  #[test]
  fn hyper_awareness_real_session_aba_keeps_the_old_completion_invalid() {
    let uuid = Uuid::new_v4();
    let workspace = Uuid::new_v4();
    let (_root, user) = authenticated(73, uuid, workspace);
    let lifecycle = Arc::new(HyperAwarenessLifecycle::default());
    let old = captured(&user, &lifecycle);
    lifecycle.begin(|| {});
    user
      .set_session(Some(Arc::new(Session {
        user_id: 74,
        user_uuid: Uuid::new_v4(),
        workspace_id: Uuid::new_v4().to_string(),
      })))
      .unwrap();
    lifecycle.begin(|| {});
    user
      .set_session(Some(Arc::new(Session {
        user_id: 73,
        user_uuid: uuid,
        workspace_id: workspace.to_string(),
      })))
      .unwrap();
    assert!(old.check().is_err());
    assert!(captured(&user, &lifecycle).check().is_ok());
  }

  #[test]
  fn hyper_awareness_closed_physical_database_rejects_an_inflight_completion() {
    let (_root, user) = authenticated(75, Uuid::new_v4(), Uuid::new_v4());
    let lifecycle = Arc::new(HyperAwarenessLifecycle::default());
    let owner = captured(&user, &lifecycle);
    user.database.close(75).unwrap();
    assert!(owner.db.upgrade().is_none());
    assert!(owner.check().is_err());
  }

  #[tokio::test]
  async fn hyper_awareness_owner_change_while_waiting_for_a_write_lock_blocks_the_write() {
    let (_root, user) = authenticated(76, Uuid::new_v4(), Uuid::new_v4());
    let lifecycle = Arc::new(HyperAwarenessLifecycle::default());
    let owner = captured(&user, &lifecycle);
    let value = Arc::new(RwLock::new(0));
    let held = value.write().await;
    let queued_value = value.clone();
    let (entered, waiting) = tokio::sync::oneshot::channel();
    let queued = tokio::spawn(async move {
      entered.send(()).unwrap();
      let mut write = queued_value.write().await;
      owner.current(|| {
        *write += 1;
        Ok(())
      })
    });
    waiting.await.unwrap();
    lifecycle.begin(|| {});
    drop(held);
    assert!(queued.await.unwrap().is_err());
    assert_eq!(*value.read().await, 0);
  }
}
