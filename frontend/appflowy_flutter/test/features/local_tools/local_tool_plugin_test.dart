import 'package:appflowy/features/local_tools/local_tool_plugin.dart';
import 'package:appflowy/plugins/blank/blank.dart';
import 'package:appflowy/startup/plugin/plugin.dart';
import 'package:appflowy/startup/startup.dart';
import 'package:appflowy/workspace/presentation/home/home_stack.dart';
import 'package:appflowy_backend/protobuf/flowy-user/protobuf.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fluttertoast/fluttertoast.dart';

void main() {
  setUp(() {
    getIt.registerSingleton<FToast>(FToast());
    getIt.registerSingleton<PluginSandbox>(PluginSandbox());
    registerPlugin(builder: BlankPluginBuilder(), config: BlankPluginConfig());
  });
  tearDown(() async => getIt.reset());
  testWidgets('tool tabs render their page instead of the blank placeholder', (tester) async {
    final user = UserProfilePB();
    final manager = PageManager();
    manager.setPlugin(
      LocalToolPlugin(
        toolId: 'jira', title: 'Jira', user: user,
        page: (_) => const Text('Jira dashboard content'),
      ),
      true,
    );
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: manager.stackWidget(userProfile: user, onDeleted: (_, __) {}))));
    await tester.pumpAndSettle();
    expect(find.text('Jira dashboard content'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    manager.dispose();
  });
}
