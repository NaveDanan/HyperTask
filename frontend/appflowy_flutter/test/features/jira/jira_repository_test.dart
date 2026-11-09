import 'dart:convert';

import 'package:appflowy/features/jira/jira.dart';
import 'package:appflowy_backend/log.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';

import 'jira_test_utils.dart';

void main() {
  setUpAll(() => Log.shared.disableLog = true);

  late FakeJira jira;
  late FakeKeyValue storage;

  setUp(() {
    jira = FakeJira();
    storage = FakeKeyValue();
  });

  void serveSearch(List<Map<String, dynamic>> issues) {
    jira.on('POST', '/rest/api/2/search', (r) async {
      final start = (jsonDecode(r.body) as Map)['startAt'] as int;
      return jsonResponse({
        'startAt': start,
        'maxResults': 2,
        'total': issues.length,
        'issues': issues.skip(start).take(2).toList(),
      });
    });
  }

  group('sync and cache', () {
    test('full sync persists issues and last sync time', () async {
      final now = DateTime.utc(2024, 6, 1, 12);
      serveSearch([
        issueJson('DEMO-10'),
        issueJson('DEMO-2', category: 'done', status: 'Closed'),
        issueJson('DEMO-3'),
      ]);
      final repo = await configuredRepository(
        jira.client,
        storage: storage,
        clock: () => now,
      );
      final result = await repo.sync();
      expect(result.added, 3);
      expect(
        result.snapshot.issues.map((i) => i.key),
        ['DEMO-2', 'DEMO-3', 'DEMO-10'],
      );
      expect(result.snapshot.lastSuccessAt, now);
      expect(result.snapshot.lastError, isNull);

      // A fresh repository on the same storage sees the cache offline.
      final reopened = JiraRepository(
        store: JiraLocalStore(userId: '1', storage: storage),
        credentialStore: SessionJiraCredentialStore(),
        httpClient: MockClient((_) async => throw StateError('no network')),
      );
      final cached = await reopened.loadCache();
      expect(cached.issues, hasLength(3));
      expect(cached.lastSuccessAt, now);
      expect(cached.issues.first.statusCategory, JiraStatusCategory.done);
      expect(await reopened.hasCredentials(), isFalse);
      // The token is never written to preferences.
      expect(storage.values.values.join(), isNot(contains(testToken)));
    });

    test('failed sync keeps cached issues and records the error', () async {
      serveSearch([issueJson('DEMO-1')]);
      final repo = await configuredRepository(jira.client, storage: storage);
      await repo.sync();

      jira.on(
        'POST',
        '/rest/api/2/search',
        (_) async => jsonResponse(
          {
            'errorMessages': ['Token expired'],
          },
          401,
        ),
      );
      await expectLater(repo.sync(), throwsA(isA<JiraAuthException>()));
      final cache = await repo.loadCache();
      expect(cache.issues.single.key, 'DEMO-1');
      expect(cache.lastError, 'Token expired');
      expect(cache.lastAttemptAt, isNotNull);
      expect(jsonDecode(storage.values.values.last), isA<Map>());
    });

    test('incremental sync merges updates and keeps the rest', () async {
      var now = DateTime.utc(2024, 6, 1, 12);
      serveSearch([issueJson('DEMO-1'), issueJson('DEMO-2')]);
      final repo = await configuredRepository(
        jira.client,
        storage: storage,
        clock: () => now,
      );
      await repo.sync();

      now = now.add(const Duration(minutes: 30));
      String? jql;
      jira.on('POST', '/rest/api/2/search', (r) async {
        jql = (jsonDecode(r.body) as Map)['jql'] as String;
        return jsonResponse({
          'startAt': 0,
          'maxResults': 50,
          'total': 2,
          'issues': [
            issueJson(
              'DEMO-2',
              summary: 'Renamed',
              updated: '2024-06-01T15:20:00.000+0300',
            ),
            issueJson('DEMO-3', updated: '2024-06-01T15:21:00.000+0300'),
          ],
        });
      });
      final result = await repo.sync(full: false);
      expect(result.incremental, isTrue);
      expect(jql, '(project = "DEMO") AND updated >= -35m ORDER BY key ASC');
      expect(result.added, 1);
      expect(result.updated, 1);
      expect(
        result.snapshot.issues.map((i) => '${i.key}:${i.summary}'),
        [
          'DEMO-1:Summary of DEMO-1',
          'DEMO-2:Renamed',
          'DEMO-3:Summary of DEMO-3',
        ],
      );
    });

    test('full sync reports issues that left the JQL scope', () async {
      serveSearch([issueJson('DEMO-1'), issueJson('DEMO-2')]);
      final repo = await configuredRepository(jira.client, storage: storage);
      await repo.sync();
      serveSearch([issueJson('DEMO-2')]);
      final result = await repo.sync();
      expect(result.removed, 1);
      expect(result.snapshot.issues.single.key, 'DEMO-2');
    });

    test('changing server or project drops cache and token', () async {
      serveSearch([issueJson('DEMO-1')]);
      final repo = await configuredRepository(jira.client, storage: storage);
      await repo.sync();
      await repo.saveConfig(
        testConfig.copyWith(baseUrl: 'https://other.example.com'),
      );
      expect((await repo.loadCache()).issues, isEmpty);
      expect(await repo.hasCredentials(), isFalse);
      await expectLater(
        repo.sync(),
        throwsA(isA<JiraNotConfiguredException>()),
      );
    });
  });

  group('edit with conflict detection', () {
    final base = JiraIssue.fromJson(
      issueJson(
        'DEMO-5',
        summary: 'Old',
        updated: '2024-05-01T10:00:00.000+0000',
      ),
    );

    test('conflict when the edited field changed remotely', () async {
      jira.on(
        'GET',
        '/rest/api/2/issue/DEMO-5',
        (_) async => jsonResponse(
          issueJson(
            'DEMO-5',
            summary: 'Theirs',
            updated: '2024-05-02T10:00:00.000+0000',
          ),
        ),
      );
      jira.on(
        'PUT',
        '/rest/api/2/issue/DEMO-5',
        (_) async => jsonResponse(null, 204),
      );
      final repo = await configuredRepository(jira.client);

      await expectLater(
        repo.updateIssue(base, const JiraIssueDraft(summary: 'Mine')),
        throwsA(
          isA<JiraConflictException>()
              .having((e) => e.remote.summary, 'remote', 'Theirs'),
        ),
      );
      expect(jira.where('PUT', '/rest/api/2/issue/DEMO-5'), isEmpty);

      await repo.updateIssue(
        base,
        const JiraIssueDraft(summary: 'Mine'),
        overwrite: true,
      );
      final put = jira.where('PUT', '/rest/api/2/issue/DEMO-5').single;
      expect(jsonDecode(put.body), {
        'fields': {'summary': 'Mine'},
      });
    });

    test('unrelated remote changes do not block the edit', () async {
      jira.on(
        'GET',
        '/rest/api/2/issue/DEMO-5',
        (_) async => jsonResponse(
          issueJson(
            'DEMO-5',
            summary: 'Old',
            status: 'In Progress',
            category: 'indeterminate',
            updated: '2024-05-02T10:00:00.000+0000',
          ),
        ),
      );
      jira.on(
        'PUT',
        '/rest/api/2/issue/DEMO-5',
        (_) async => jsonResponse(null, 204),
      );
      final repo = await configuredRepository(jira.client);
      final saved = await repo.updateIssue(
        base,
        const JiraIssueDraft(description: 'More detail'),
      );
      expect(saved.statusName, 'In Progress');
      expect(
        jsonDecode(jira.where('PUT', '/rest/api/2/issue/DEMO-5').single.body),
        {
          'fields': {'description': 'More detail'},
        },
      );
      expect((await repo.loadCache()).issues.single.key, 'DEMO-5');
    });

    test('create sends project, type and summary then caches result', () async {
      jira.on(
        'POST',
        '/rest/api/2/issue',
        (_) async => jsonResponse({'id': '99', 'key': 'DEMO-99'}, 201),
      );
      jira.on(
        'GET',
        '/rest/api/2/issue/DEMO-99',
        (_) async => jsonResponse(issueJson('DEMO-99', summary: 'New')),
      );
      final repo = await configuredRepository(jira.client);
      final issue = await repo.createIssue(
        const JiraIssueDraft(summary: 'New', issueTypeId: '10002'),
      );
      expect(issue.key, 'DEMO-99');
      expect(
        jsonDecode(jira.where('POST', '/rest/api/2/issue').single.body),
        {
          'fields': {
            'project': {'key': 'DEMO'},
            'issuetype': {'id': '10002'},
            'summary': 'New',
          },
        },
      );
      expect((await repo.loadCache()).issues.single.summary, 'New');
    });

    test('create validates locally before calling Jira', () async {
      final repo = await configuredRepository(jira.client);
      await expectLater(
        repo.createIssue(const JiraIssueDraft(summary: ' ', issueTypeId: '1')),
        throwsA(isA<JiraValidationException>()),
      );
      expect(jira.requests, isEmpty);
    });
  });

  group('transitions', () {
    final issue = JiraIssue.fromJson(issueJson('DEMO-7'));

    test('posts the chosen transition id and resolution', () async {
      jira.on(
        'POST',
        '/rest/api/2/issue/DEMO-7/transitions',
        (_) async => jsonResponse(null, 204),
      );
      jira.on(
        'GET',
        '/rest/api/2/issue/DEMO-7',
        (_) async => jsonResponse(
          issueJson('DEMO-7', status: 'Closed', category: 'done'),
        ),
      );
      final repo = await configuredRepository(jira.client);
      final transition = JiraTransition.fromJson(
        transitionJson(
          '731',
          'Close',
          'Closed',
          'done',
          fields: resolutionField(),
        ),
      );
      final updated = await repo.transitionIssue(
        issue,
        transition,
        resolutionId: '10000',
      );
      expect(updated.isDone, isTrue);
      final body = jsonDecode(
        jira.where('POST', '/rest/api/2/issue/DEMO-7/transitions').single.body,
      );
      expect(body, {
        'transition': {'id': '731'},
        'fields': {
          'resolution': {'id': '10000'},
        },
      });
    });

    test('rejects missing resolution and unsupported fields', () async {
      final repo = await configuredRepository(jira.client);
      await expectLater(
        repo.transitionIssue(
          issue,
          JiraTransition.fromJson(
            transitionJson(
              '1',
              'Close',
              'Closed',
              'done',
              fields: resolutionField(),
            ),
          ),
        ),
        throwsA(isA<JiraValidationException>()),
      );
      await expectLater(
        repo.transitionIssue(
          issue,
          JiraTransition.fromJson(
            transitionJson(
              '2',
              'Close',
              'Closed',
              'done',
              fields: {
                'customfield_1': {'required': true, 'name': 'Root cause'},
              },
            ),
          ),
        ),
        throwsA(isA<JiraTransitionUnsupportedException>()),
      );
      expect(jira.requests, isEmpty);
    });
  });

  test('stripOrderBy removes trailing ordering', () {
    expect(stripOrderBy('project = X ORDER BY rank DESC'), 'project = X');
    expect(stripOrderBy('project = X'), 'project = X');
  });
}
