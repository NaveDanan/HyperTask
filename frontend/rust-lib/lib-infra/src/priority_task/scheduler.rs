use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crate::priority_task::queue::TaskQueue;
use crate::priority_task::store::TaskStore;
use crate::priority_task::{Task, TaskContent, TaskId, TaskState};
use anyhow::Error;
use async_trait::async_trait;
use tokio::sync::{watch, RwLock};
use tokio::time::interval;
use tracing::trace;

pub struct TaskDispatcher {
  queue: TaskQueue,
  store: TaskStore,
  timeout: Duration,
  handlers: HashMap<String, Arc<dyn TaskHandler>>,
  stopped: bool,

  notifier: watch::Sender<bool>,
  pub(crate) notifier_rx: Option<watch::Receiver<bool>>,
}

impl TaskDispatcher {
  pub fn new(timeout: Duration) -> Self {
    let (notifier, notifier_rx) = watch::channel(false);
    Self {
      queue: TaskQueue::new(),
      store: TaskStore::new(),
      timeout,
      handlers: HashMap::new(),
      stopped: false,
      notifier,
      notifier_rx: Some(notifier_rx),
    }
  }

  pub fn register_handler<T>(&mut self, handler: T)
  where
    T: TaskHandler,
  {
    let handler_id = handler.handler_id().to_owned();
    self.handlers.insert(handler_id, Arc::new(handler));
  }

  pub async fn unregister_handler<T: AsRef<str>>(&mut self, handler_id: T) {
    if let Some(handler) = self.handlers.remove(handler_id.as_ref()) {
      tracing::trace!(
        "{}:{} is unregistered",
        handler.handler_name(),
        handler.handler_id()
      );
    }
  }

  pub fn stop(&mut self) {
    self.stopped = true;
    let _ = self.notifier.send(true);
    self.queue.clear();
    self.store.clear();
  }

  fn take_next_task(&mut self) -> Option<(Task, Option<Arc<dyn TaskHandler>>, Duration)> {
    if self.stopped {
      return None;
    }
    let pending_task = self.queue.mut_head(|list| list.pop())?;
    let task = self.store.remove_task(&pending_task.id)?;
    let handler = self.handlers.get(&task.handler_id).cloned();
    Some((task, handler, self.timeout))
  }

  pub fn add_task(&mut self, task: Task) {
    if self.stopped {
      let mut task = task;
      task.set_state(TaskState::Cancel);
      if let Some(ret) = task.ret.take() {
        let _ = ret.send(task.into());
      }
      return;
    }
    debug_assert!(!task.state().is_done());
    if task.state().is_done() {
      tracing::warn!("Should not add a task which state is done");
      return;
    }

    trace!(
      "Add task: handler:{}, task:{:?}",
      task.handler_id,
      task.content
    );
    self.queue.push(&task);
    self.store.insert_task(task);
    self.notify();
  }

  pub fn read_task(&self, task_id: &TaskId) -> Option<&Task> {
    self.store.read_task(task_id)
  }

  pub fn cancel_task(&mut self, task_id: TaskId) {
    if let Some(task) = self.store.mut_task(&task_id) {
      task.set_state(TaskState::Cancel);
    }
  }

  pub fn clear_task(&mut self) {
    self.queue.clear();
    self.store.clear();
  }
  pub fn next_task_id(&self) -> TaskId {
    self.store.next_task_id()
  }

  pub(crate) fn notify(&self) {
    if !self.stopped {
      let _ = self.notifier.send(false);
    }
  }
}
pub struct TaskRunner();
impl TaskRunner {
  pub async fn run(dispatcher: Arc<RwLock<TaskDispatcher>>) {
    dispatcher.read().await.notify();
    let debounce_duration = Duration::from_millis(300);
    let mut notifier = dispatcher
      .write()
      .await
      .notifier_rx
      .take()
      .expect("Only take once");
    loop {
      // stops the runner if the notifier was closed.
      if notifier.changed().await.is_err() {
        break;
      }

      // stops the runner if the value of notifier is `true`
      if *notifier.borrow() {
        break;
      }

      let mut interval = interval(debounce_duration);
      interval.tick().await;
      // Handlers may need controller locks held by a caller scheduling another task.
      // Release the dispatcher lock before awaiting the handler to avoid a lock cycle.
      let next = dispatcher.write().await.take_next_task();
      let processed = next.is_some();
      if let Some((mut task, handler, timeout)) = next {
        if !task.state().is_cancel() {
          match (handler, task.content.take()) {
            (Some(handler), Some(content)) => {
              task.set_state(TaskState::Processing);
              tracing::trace!("{} task is running", handler.handler_name());
              match tokio::time::timeout(timeout, handler.run(content)).await {
                Ok(Ok(())) => task.set_state(TaskState::Done),
                Ok(Err(error)) => {
                  tracing::error!("{} task failed: {:?}", handler.handler_name(), error);
                  task.set_state(TaskState::Failure);
                },
                Err(error) => {
                  tracing::error!("{} task timed out: {:?}", handler.handler_name(), error);
                  task.set_state(TaskState::Timeout);
                },
              }
            },
            _ => task.set_state(TaskState::Cancel),
          }
        }
        if let Some(ret) = task.ret.take() {
          let _ = ret.send(task.into());
        }
      }
      // Do not replace a stop notification received while the handler was running.
      let dispatcher = dispatcher.read().await;
      if dispatcher.stopped {
        break;
      }
      if processed {
        dispatcher.notify();
      }
    }
  }
}

#[async_trait]
pub trait TaskHandler: Send + Sync + 'static {
  fn handler_id(&self) -> &str;

  fn handler_name(&self) -> &str {
    ""
  }

  async fn run(&self, content: TaskContent) -> Result<(), Error>;
}

#[async_trait]
impl<T> TaskHandler for Box<T>
where
  T: TaskHandler,
{
  fn handler_id(&self) -> &str {
    (**self).handler_id()
  }

  fn handler_name(&self) -> &str {
    (**self).handler_name()
  }

  async fn run(&self, content: TaskContent) -> Result<(), Error> {
    (**self).run(content).await
  }
}

#[async_trait]
impl<T> TaskHandler for Arc<T>
where
  T: TaskHandler,
{
  fn handler_id(&self) -> &str {
    (**self).handler_id()
  }

  fn handler_name(&self) -> &str {
    (**self).handler_name()
  }

  async fn run(&self, content: TaskContent) -> Result<(), Error> {
    (**self).run(content).await
  }
}
