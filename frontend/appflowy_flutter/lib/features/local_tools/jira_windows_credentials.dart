import 'dart:convert';
import 'dart:io';

import 'package:appflowy/ai/service/openai_endpoint_settings.dart';
import 'package:appflowy/features/jira/data/jira_credential_store.dart';
import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

/// Device-local credentials protected by the current Windows user's DPAPI key.
class WindowsJiraCredentialStore implements JiraCredentialStore {
  WindowsJiraCredentialStore({this.directory});
  final Directory? directory;

  @override
  bool get isPersistent => Platform.isWindows;

  Future<File> _file(String accountId) async {
    final root = directory ?? await getApplicationSupportDirectory();
    final name = const Uuid().v5(Namespace.url.value, accountId);
    return File(path.join(root.path, 'jira_credentials', '$name.json'));
  }

  @override
  Future<JiraCredentials?> read(String accountId) async {
    if (!Platform.isWindows) {
      return SessionJiraCredentialStore.instance.read(accountId);
    }
    final file = await _file(accountId);
    if (!await file.exists()) return null;
    try {
      final data =
          jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      return JiraCredentials(
        secret: decryptKey(data['protected_secret'] as String),
        username: data['username'] as String? ?? '',
      );
    } catch (_) {
      // Damaged or foreign-account credentials require re-entry.
      return null;
    }
  }

  @override
  Future<void> write(String accountId, JiraCredentials credentials) async {
    if (!Platform.isWindows) {
      return SessionJiraCredentialStore.instance.write(accountId, credentials);
    }
    final file = await _file(accountId);
    final temporary = File('${file.path}.tmp');
    await file.parent.create(recursive: true);
    await temporary.writeAsString(
      jsonEncode({
        'username': credentials.username,
        'protected_secret': encryptKey(credentials.secret),
      }),
      flush: true,
    );
    await temporary.rename(file.path);
  }

  @override
  Future<void> delete(String accountId) async {
    if (!Platform.isWindows) {
      return SessionJiraCredentialStore.instance.delete(accountId);
    }
    final file = await _file(accountId);
    if (await file.exists()) await file.delete();
  }
}
