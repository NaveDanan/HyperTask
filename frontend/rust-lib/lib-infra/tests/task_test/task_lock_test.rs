use std::sync::Arc;
use std::time::Duration;

use anyhow::Error;
use lib_infra::async_trait::async_trait;
use lib_infra::priority_task::{
  Task, TaskContent, TaskDispatcher, TaskHandler, TaskRunner, TaskState,
};
use tokio::sync::{Notify, RwLock};
use tokio::time::timeout;

struct SchedulingHandler {
  dispatcher: Arc<RwLock<TaskDispatcher>>,
}

#[async_trait]
impl TaskHandler for SchedulingHandler {
  fn handler_id(&self) -> &str {
    "schedules"
  }

  async fn run(&self, _: TaskContent) -> Result<(), Error> {
    // A database sort/filter handler needs a controller lock while another caller may
    // hold that controller lock and enqueue work. Access to the dispatcher must stay free.
    let _dispatcher = self.dispatcher.write().await;
    Ok(())
  }
}

#[tokio::test]
async fn task_handler_can_acquire_dispatcher_without_waiting_for_timeout() {
  let dispatcher = Arc::new(RwLock::new(TaskDispatcher::new(Duration::from_secs(10))));
  dispatcher
    .write()
    .await
    .register_handler(SchedulingHandler {
      dispatcher: dispatcher.clone(),
    });
  let mut task = Task::background("schedules", 1, TaskContent::Text(String::new()));
  let result = task.recv.take().unwrap();
  dispatcher.write().await.add_task(task);
  let runner = tokio::spawn(TaskRunner::run(dispatcher.clone()));
  let result = timeout(Duration::from_secs(1), result)
    .await
    .unwrap()
    .unwrap();
  assert_eq!(result.state, TaskState::Done);
  dispatcher.write().await.stop();
  timeout(Duration::from_secs(1), runner)
    .await
    .unwrap()
    .unwrap();
}

struct BlockingHandler {
  started: Arc<Notify>,
  finish: Arc<Notify>,
}

#[tokio::test]
async fn clearing_tasks_does_not_block_tasks_added_afterward() {
  let dispatcher = Arc::new(RwLock::new(TaskDispatcher::new(Duration::from_secs(10))));
  dispatcher
    .write()
    .await
    .register_handler(SchedulingHandler {
      dispatcher: dispatcher.clone(),
    });
  let stale = Task::background("schedules", 1, TaskContent::Text(String::new()));
  dispatcher.write().await.add_task(stale);
  dispatcher.write().await.clear_task();
  let mut fresh = Task::background("schedules", 2, TaskContent::Text(String::new()));
  let result = fresh.recv.take().unwrap();
  dispatcher.write().await.add_task(fresh);
  let runner = tokio::spawn(TaskRunner::run(dispatcher.clone()));
  assert_eq!(
    timeout(Duration::from_secs(1), result)
      .await
      .unwrap()
      .unwrap()
      .state,
    TaskState::Done
  );
  dispatcher.write().await.stop();
  timeout(Duration::from_secs(1), runner)
    .await
    .unwrap()
    .unwrap();
}

#[async_trait]
impl TaskHandler for BlockingHandler {
  fn handler_id(&self) -> &str {
    "blocks"
  }

  async fn run(&self, _: TaskContent) -> Result<(), Error> {
    self.started.notify_one();
    self.finish.notified().await;
    Ok(())
  }
}

#[tokio::test]
async fn queued_task_can_be_cancelled_while_another_handler_runs() {
  let dispatcher = Arc::new(RwLock::new(TaskDispatcher::new(Duration::from_secs(10))));
  let started = Arc::new(Notify::new());
  let finish = Arc::new(Notify::new());
  dispatcher.write().await.register_handler(BlockingHandler {
    started: started.clone(),
    finish: finish.clone(),
  });
  let mut first = Task::background("blocks", 1, TaskContent::Text(String::new()));
  let first_result = first.recv.take().unwrap();
  dispatcher.write().await.add_task(first);
  let runner = tokio::spawn(TaskRunner::run(dispatcher.clone()));
  timeout(Duration::from_secs(1), started.notified())
    .await
    .unwrap();
  let mut queued = Task::background("blocks", 2, TaskContent::Text(String::new()));
  let queued_result = queued.recv.take().unwrap();
  {
    let mut dispatcher = timeout(Duration::from_secs(1), dispatcher.write())
      .await
      .unwrap();
    dispatcher.add_task(queued);
    dispatcher.cancel_task(2);
  }
  finish.notify_one();
  assert_eq!(
    timeout(Duration::from_secs(1), first_result)
      .await
      .unwrap()
      .unwrap()
      .state,
    TaskState::Done
  );
  assert_eq!(
    timeout(Duration::from_secs(1), queued_result)
      .await
      .unwrap()
      .unwrap()
      .state,
    TaskState::Cancel
  );
  dispatcher.write().await.stop();
  timeout(Duration::from_secs(1), runner)
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn stop_during_a_handler_is_not_overwritten_by_completion_notification() {
  let dispatcher = Arc::new(RwLock::new(TaskDispatcher::new(Duration::from_secs(10))));
  let started = Arc::new(Notify::new());
  let finish = Arc::new(Notify::new());
  dispatcher.write().await.register_handler(BlockingHandler {
    started: started.clone(),
    finish: finish.clone(),
  });
  let task = Task::background("blocks", 1, TaskContent::Text(String::new()));
  dispatcher.write().await.add_task(task);
  let runner = tokio::spawn(TaskRunner::run(dispatcher.clone()));
  timeout(Duration::from_secs(1), started.notified())
    .await
    .unwrap();
  timeout(Duration::from_secs(1), dispatcher.write())
    .await
    .unwrap()
    .stop();
  finish.notify_one();
  timeout(Duration::from_secs(1), runner)
    .await
    .unwrap()
    .unwrap();
  let mut rejected = Task::background("blocks", 2, TaskContent::Text(String::new()));
  let result = rejected.recv.take().unwrap();
  dispatcher.write().await.add_task(rejected);
  assert_eq!(result.await.unwrap().state, TaskState::Cancel);
}
