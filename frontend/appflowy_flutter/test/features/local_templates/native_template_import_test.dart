import 'dart:convert';
import 'dart:io';
import 'package:appflowy/features/local_templates/data/local_template_import_service.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy/workspace/application/view/view_service.dart';
import 'package:appflowy_backend/appflowy_backend.dart';
import 'package:appflowy_backend/dispatch/dispatch.dart';
import 'package:appflowy_backend/log.dart';
import 'package:appflowy_backend/protobuf/flowy-user/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-database2/protobuf.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'bundled document and typed Bug Tracker import through real native SDK',
    () async {
      Log.shared.disableLog = true;
      final data = await Directory('.sandbox').createTemp('native-template-');
      final sdk = FlowySDK();
      await sdk.init(
        jsonEncode({
          'root': data.absolute.path,
          'app_version': '0.11.4',
          'custom_app_path': data.absolute.path,
          'origin_app_path': data.absolute.path,
          'device_id': 'native-template-smoke',
          'platform': 'windows',
          'authenticator_type': 0,
          'appflowy_cloud_config': {
            'base_url': '',
            'ws_base_url': '',
            'gotrue_url': '',
            'enable_sync_trace': false,
          },
          'envs': <String, String>{},
        }),
      );
      final signedUp = await UserEventSignUp(
        SignUpPayloadPB(
          name: 'Template SDK smoke',
          email: 'local-test@example.invalid',
          password: 'Local-test-only!42',
          authType: AuthTypePB.Local,
          deviceId: 'native-template-smoke',
        ),
      ).send().timeout(const Duration(seconds: 45));
      expect(signedUp.isSuccess, true, reason: signedUp.toString());
      final workspace =
          (await FolderEventReadCurrentWorkspace().send()).getOrThrow();
      final repository =
          LocalTemplateRepository(source: const AssetLocalTemplateSource());
      final manifest = await repository.loadManifest();
      String? databaseViewId;
      final importer = LocalTemplateImporter(
        repository: repository,
        createDatabase: ({
          required parentViewId,
          required name,
          required layout,
          required initialData,
        }) async {
          final created = await ViewBackendService.createView(
            parentViewId: parentViewId,
            name: name,
            layoutType: layout,
            initialDataBytes: initialData,
          );
          if (created.isSuccess) {
            databaseViewId = created.getOrThrow().id;
          }
          return created;
        },
      );
      for (final name in ['API Documentation', 'Bug Tracker']) {
        final entry =
            manifest.templates.firstWhere((entry) => entry.name == name);
        final imported = await importer
            .importTemplate(entry: entry, parentViewId: workspace.id)
            .timeout(const Duration(seconds: 45));
        expect(imported.isSuccess, true, reason: '$name: $imported');
      }
      expect(databaseViewId, isNotNull);
      final database = (await DatabaseEventGetDatabase(
        DatabaseViewIdPB(value: databaseViewId!),
      ).send())
          .getOrThrow();
      expect(database.fields, isNotEmpty);
      expect(database.rows, isNotEmpty);
      await sdk.dispose();
    },
    skip: !Platform.isWindows,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
