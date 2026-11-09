/// Jira Server / Data Center integration.
///
/// Entry point: [JiraDashboardPage]. See `doc/jira-integration.md`.
library;

export 'data/jira_api_client.dart';
export 'data/jira_credential_store.dart';
export 'data/jira_dashboard_stats.dart';
export 'data/jira_database_mapper.dart';
export 'data/jira_exception.dart';
export 'data/jira_local_store.dart';
export 'data/jira_repository.dart';
export 'data/models/jira_config.dart';
export 'data/models/jira_issue.dart';
export 'logic/jira_bloc.dart';
export 'presentation/jira_dashboard_page.dart';
export 'presentation/dialogs/jira_issue_dialog.dart';
export 'presentation/dialogs/jira_settings_dialog.dart';
export 'presentation/dialogs/jira_transition_dialog.dart';
