import 'dart:convert';

import 'package:appflowy/features/jira/jira.dart';
import 'package:appflowy_backend/log.dart';
import 'package:appflowy_backend/protobuf/flowy-user/protobuf.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'jira_test_utils.dart';

void main() {
  setUpAll(() => Log.shared.disableLog = true);

  late FakeJira jira;

  setUp(() {
    jira = FakeJira();
    jira.on(
      'POST',
      '/rest/api/2/search',
      (_) async => jsonResponse({
        'startAt': 0,
        'maxResults': 50,
        'total': 3,
        'issues': [
          issueJson('DEMO-1', assignee: 'alice'),
          issueJson('DEMO-2', status: 'Closed', category: 'done'),
          issueJson(
            'DEMO-3',
            assignee: 'alice',
            status: 'In Progress',
            category: 'indeterminate',
          ),
        ],
      }),
    );
  });

  Future<void> pumpPage(WidgetTester tester, JiraRepository repository) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => AppFlowyTheme(
          data: AppFlowyDefaultTheme().light(),
          child: child!,
        ),
        home: Scaffold(
          body:
              JiraDashboardPage(user: UserProfilePB(), repository: repository),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('syncs on open and shows category totals and progress',
      (tester) async {
    final repo = await configuredRepository(jira.client);
    await pumpPage(tester, repo);

    expect(find.text('Jira · DEMO'), findsOneWidget);
    for (final key in ['DEMO-1', 'DEMO-2', 'DEMO-3']) {
      expect(find.byKey(ValueKey('jira-issue-$key')), findsOneWidget);
    }
    expect(find.text('33% done · 2 open of 3'), findsOneWidget);
    expect(find.text('User alice'), findsWidgets);
    expect(find.text('0/2 done'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('jira-stat-done')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('jira-issue-DEMO-1')), findsNothing);
    expect(find.byKey(const ValueKey('jira-issue-DEMO-2')), findsOneWidget);
  });

  testWidgets('close dialog preselects the live done transition',
      (tester) async {
    jira.on(
      'GET',
      '/rest/api/2/issue/DEMO-1/transitions',
      (_) async => jsonResponse({
        'transitions': [
          transitionJson(
            '11',
            'Start Progress',
            'In Progress',
            'indeterminate',
          ),
          transitionJson('21', "Won't Do", "Won't Do", 'done'),
          transitionJson(
            '31',
            'Close Issue',
            'Closed',
            'done',
            fields: resolutionField(),
          ),
        ],
      }),
    );
    jira.on(
      'POST',
      '/rest/api/2/issue/DEMO-1/transitions',
      (_) async => jsonResponse(null, 204),
    );
    jira.on(
      'GET',
      '/rest/api/2/issue/DEMO-1',
      (_) async => jsonResponse(
        issueJson('DEMO-1', status: 'Closed', category: 'done'),
      ),
    );
    final repo = await configuredRepository(jira.client);
    await pumpPage(tester, repo);

    await tester.tap(find.byKey(const ValueKey('jira-transition-DEMO-1')));
    await tester.pumpAndSettle();

    expect(find.text('Close Issue'), findsOneWidget);
    expect(find.text('Close issue'), findsOneWidget); // apply button label
    await tester.tap(find.byKey(const Key('jira-transition-apply')));
    await tester.pumpAndSettle();

    final post = jira.where('POST', '/rest/api/2/issue/DEMO-1/transitions');
    expect(jsonDecode(post.single.body), {
      'transition': {'id': '31'},
      'fields': {
        'resolution': {'id': '1'},
      },
    });
    expect(find.byType(JiraTransitionDialog), findsNothing);
    expect(find.text('DEMO-1 is now Closed'), findsOneWidget);
    expect(find.text('67% done · 1 open of 3'), findsOneWidget);
  });

  testWidgets('authentication errors are explained with a settings action',
      (tester) async {
    jira.on(
      'POST',
      '/rest/api/2/search',
      (_) async => jsonResponse({'errorMessages': []}, 401),
    );
    final repo = await configuredRepository(jira.client);
    await pumpPage(tester, repo);

    expect(find.text('Authentication failed (HTTP 401)'), findsOneWidget);
    expect(find.text('Open settings'), findsOneWidget);
    expect(find.text('No issues synced yet.'), findsOneWidget);
  });

  testWidgets('first run: connect, save token, then sync', (tester) async {
    final repo = JiraRepository(
      store: JiraLocalStore(userId: '1', storage: FakeKeyValue()),
      credentialStore: SessionJiraCredentialStore(),
      httpClient: jira.client,
    );
    await pumpPage(tester, repo);

    await tester.tap(find.byKey(const Key('jira-connect')));
    await tester.pumpAndSettle();
    expect(find.text('https://jira.example.com'), findsOneWidget);
    expect(find.text('DEMO'), findsWidgets);

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.text('Enter a token to connect.'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('jira-settings-secret')),
      testToken,
    );
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.byType(JiraSettingsDialog), findsNothing);
    expect(find.byKey(const ValueKey('jira-issue-DEMO-3')), findsOneWidget);
    final search = jira.where('POST', '/rest/api/2/search').first;
    expect(search.url.host, 'jira.example.com');
    expect(search.headers['authorization'], 'Bearer $testToken');
  });

  testWidgets('edit conflict offers Jira version or overwrite', (tester) async {
    jira.on(
      'GET',
      '/rest/api/2/issue/DEMO-1',
      (_) async => jsonResponse(
        issueJson(
          'DEMO-1',
          summary: 'Changed by someone else',
          updated: '2024-06-01T10:00:00.000+0300',
        ),
      ),
    );
    jira.on(
      'PUT',
      '/rest/api/2/issue/DEMO-1',
      (_) async => jsonResponse(null, 204),
    );
    final repo = await configuredRepository(jira.client);
    await pumpPage(tester, repo);

    await tester.tap(find.byKey(const ValueKey('jira-edit-DEMO-1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('jira-issue-summary')),
      'My summary',
    );
    await tester.tap(find.byKey(const Key('jira-issue-submit')));
    await tester.pumpAndSettle();

    expect(find.text('Changed in Jira since you opened it'), findsOneWidget);
    expect(jira.where('PUT', '/rest/api/2/issue/DEMO-1'), isEmpty);

    await tester.tap(find.text('Overwrite with mine'));
    await tester.pumpAndSettle();
    final put = jira.where('PUT', '/rest/api/2/issue/DEMO-1').single;
    expect(jsonDecode(put.body), {
      'fields': {'summary': 'My summary'},
    });
    expect(find.byType(JiraIssueDialog), findsNothing);
  });
}
