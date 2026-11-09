import 'dart:io';
import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:appflowy/features/local_tools/jira_windows_credentials.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'Jira credentials survive restart as encrypted account-scoped files',
    () async {
      final directory =
          await Directory.systemTemp.createTemp('appflowy-jira-credentials-');
      final store = WindowsJiraCredentialStore(directory: directory);
      try {
        await store.write(
          'user-a:server-a',
          const JiraCredentials(username: 'alice', secret: 'test-secret-123'),
        );
        final files = await Directory('${directory.path}/jira_credentials')
            .list()
            .where((e) => e is File)
            .cast<File>()
            .toList();
        expect(files, hasLength(1));
        expect(
          await files.single.readAsString(),
          isNot(contains('test-secret-123')),
        );
        final restored = WindowsJiraCredentialStore(directory: directory);
        expect(
          (await restored.read('user-a:server-a'))?.secret,
          'test-secret-123',
        );
        expect(await restored.read('user-b:server-a'), isNull);
        expect(await restored.read('user-a:server-b'), isNull);
        await restored.delete('user-a:server-a');
        expect(await restored.read('user-a:server-a'), isNull);
      } finally {
        final credentials = Directory('${directory.path}/jira_credentials');
        if (await credentials.exists()) {
          await for (final item in credentials.list()) {
            if (item is File) await item.delete();
          }
          await credentials.delete();
        }
        await directory.delete();
      }
    },
    skip: !Platform.isWindows,
  );
}
