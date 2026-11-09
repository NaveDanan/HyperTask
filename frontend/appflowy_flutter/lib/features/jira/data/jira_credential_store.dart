import 'package:appflowy/features/jira/data/models/jira_config.dart';

/// Storage for Jira secrets (PAT / password).
///
/// Implementations must keep secrets out of plain-text preferences, logs and
/// any AppFlowy cloud sync. The secret is only ever sent to the configured
/// Jira host by [JiraApiClient].
abstract class JiraCredentialStore {
  /// Whether secrets survive an app restart.
  bool get isPersistent;

  Future<JiraCredentials?> read(String accountId);

  Future<void> write(String accountId, JiraCredentials credentials);

  Future<void> delete(String accountId);
}

/// Keeps secrets in memory for the current app session only.
///
/// This is the default because the app does not currently depend on an OS
/// keychain plugin. Users re-enter the token after restarting AppFlowy;
/// cached issues stay available offline in the meantime. See
/// `doc/jira-integration.md` for wiring a `flutter_secure_storage` adapter.
class SessionJiraCredentialStore implements JiraCredentialStore {
  SessionJiraCredentialStore();

  /// Shared instance so the token survives closing and reopening the page.
  static final SessionJiraCredentialStore instance =
      SessionJiraCredentialStore();

  final Map<String, JiraCredentials> _values = {};

  @override
  bool get isPersistent => false;

  @override
  Future<JiraCredentials?> read(String accountId) async => _values[accountId];

  @override
  Future<void> write(String accountId, JiraCredentials credentials) async {
    _values[accountId] = credentials;
  }

  @override
  Future<void> delete(String accountId) async {
    _values.remove(accountId);
  }
}
