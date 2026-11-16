use hyper_ai::ai_manager::AIManager;
use std::sync::Weak;

use hyper_database2::DatabaseManager;
use hyper_document::manager::DocumentManager as DocumentManager2;
use hyper_folder::manager::FolderManager;
use hyper_search::services::manager::SearchManager;
use hyper_storage::manager::StorageManager;
use hyper_user::user_manager::UserManager;
use lib_dispatch::prelude::AFPlugin;

pub fn make_plugins(
  folder_manager: Weak<FolderManager>,
  database_manager: Weak<DatabaseManager>,
  user_session: Weak<UserManager>,
  document_manager2: Weak<DocumentManager2>,
  search_manager: Weak<SearchManager>,
  ai_manager: Weak<AIManager>,
  file_storage_manager: Weak<StorageManager>,
) -> Vec<AFPlugin> {
  let user_plugin = hyper_user::event_map::init(user_session);
  let folder_plugin = hyper_folder::event_map::init(folder_manager);
  let database_plugin = hyper_database2::event_map::init(database_manager);
  let document_plugin2 = hyper_document::event_map::init(document_manager2);
  let date_plugin = hyper_date::event_map::init();
  let search_plugin = hyper_search::event_map::init(search_manager);
  let ai_plugin = hyper_ai::event_map::init(ai_manager);
  let file_storage_plugin = hyper_storage::event_map::init(file_storage_manager);
  vec![
    user_plugin,
    folder_plugin,
    database_plugin,
    document_plugin2,
    date_plugin,
    search_plugin,
    ai_plugin,
    file_storage_plugin,
  ]
}
