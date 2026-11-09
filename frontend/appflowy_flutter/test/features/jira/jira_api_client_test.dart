import 'dart:convert';
import 'dart:io';

import 'package:appflowy/features/jira/jira.dart';
import 'package:appflowy_backend/log.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'jira_test_utils.dart';

void main() {
  setUpAll(() => Log.shared.disableLog = true);

  JiraApiClient client(
    MockClientHandler handler, {
    JiraConfig config = testConfig,
    JiraCredentials credentials = const JiraCredentials(secret: testToken),
  }) {
    return JiraApiClient(
      config: config,
      credentials: credentials,
      httpClient: MockClient(handler),
    );
  }

  group('JiraConfig', () {
    test('parses project URL with and without context path', () {
      final a =
          JiraConfig.fromUserUrl('https://jira.example.com/projects/DEMO/');
      expect(a.baseUrl, 'https://jira.example.com');
      expect(a.projectKey, 'DEMO');

      final b =
          JiraConfig.fromUserUrl('https://host:8443/jira/browse/ABC-12?x=1');
      expect(b.baseUrl, 'https://host:8443/jira');
      expect(b.projectKey, 'ABC');

      final c = JiraConfig.fromUserUrl('host/jira/', projectKey: 'demo');
      expect(c.baseUrl, 'https://host/jira');
      expect(c.projectKey, 'DEMO');
    });

    test('credentials never print the secret', () {
      const creds = JiraCredentials(secret: testToken, username: 'u');
      expect(creds.toString(), isNot(contains(testToken)));
    });
  });

  group('requests', () {
    test('uses context path and bearer auth for PATs', () async {
      late http.Request seen;
      final api = client(
        (r) async {
          seen = r;
          return jsonResponse({'name': 'nave', 'displayName': 'Nave'});
        },
        config: testConfig.copyWith(baseUrl: 'https://host/jira/'),
      );
      final me = await api.getMyself();
      expect(me.displayName, 'Nave');
      expect(seen.url.toString(), 'https://host/jira/rest/api/2/myself');
      expect(seen.headers['authorization'], 'Bearer $testToken');
      expect(seen.followRedirects, isFalse);
    });

    test('uses basic auth when configured', () async {
      late http.Request seen;
      final api = client(
        (r) async {
          seen = r;
          return jsonResponse({'name': 'u'});
        },
        config: testConfig.copyWith(authType: JiraAuthType.basic),
        credentials: const JiraCredentials(secret: 'pw', username: 'u'),
      );
      await api.getMyself();
      expect(
        seen.headers['authorization'],
        'Basic ${base64Encode(utf8.encode('u:pw'))}',
      );
    });

    test('missing token fails before any request', () async {
      var calls = 0;
      final api = client(
        (r) async {
          calls++;
          return jsonResponse({});
        },
        credentials: const JiraCredentials(secret: ''),
      );
      await expectLater(
        api.getMyself(),
        throwsA(isA<JiraNotConfiguredException>()),
      );
      expect(calls, 0);
    });
  });

  group('paging', () {
    test('searchAll follows startAt with server-capped page size', () async {
      final all = List.generate(5, (i) => issueJson('DEMO-${i + 1}'));
      final bodies = <Map<String, dynamic>>[];
      final api = client((r) async {
        expect(r.method, 'POST');
        expect(r.url.path, '/rest/api/2/search');
        final body = jsonDecode(r.body) as Map<String, dynamic>;
        bodies.add(body);
        final start = body['startAt'] as int;
        // Server ignores maxResults=100 and returns 2 per page.
        return jsonResponse({
          'startAt': start,
          'maxResults': 2,
          'total': all.length,
          'issues': all.skip(start).take(2).toList(),
        });
      });
      final issues = await api.searchAll('project = "DEMO"');
      expect(issues.map((i) => i.key), [
        'DEMO-1',
        'DEMO-2',
        'DEMO-3',
        'DEMO-4',
        'DEMO-5',
      ]);
      expect(bodies.map((b) => b['startAt']), [0, 2, 4]);
      expect(bodies.first['jql'], 'project = "DEMO" ORDER BY key ASC');
      expect(bodies.first['maxResults'], 100);
    });

    test('stops on empty page even if total is inconsistent', () async {
      var calls = 0;
      final api = client((r) async {
        calls++;
        return jsonResponse({
          'startAt': 0,
          'maxResults': 50,
          'total': 10,
          'issues': calls == 1 ? [issueJson('DEMO-1')] : [],
        });
      });
      final issues = await api.searchAll('project = DEMO ORDER BY rank');
      expect(issues, hasLength(1));
      expect(calls, 2);
    });
  });

  group('errors', () {
    Future<JiraException> failWith(http.Response response) async {
      final api = client((_) async => response);
      try {
        await api.getMyself();
      } on JiraException catch (e) {
        return e;
      }
      fail('expected JiraException');
    }

    test('401 maps to auth error without leaking the token', () async {
      final e = await failWith(jsonResponse({'errorMessages': []}, 401));
      expect(e, isA<JiraAuthException>());
      expect(e.statusCode, 401);
      expect(e.toString(), isNot(contains(testToken)));
      expect(e.message, isNot(contains(testToken)));
    });

    test('400 keeps field errors', () async {
      final e = await failWith(
        jsonResponse(
          {
            'errorMessages': [],
            'errors': {'summary': 'You must specify a summary of the issue.'},
          },
          400,
        ),
      );
      expect(e, isA<JiraValidationException>());
      expect(
        (e as JiraValidationException).fieldErrors['summary'],
        contains('summary'),
      );
    });

    test('403 with CAPTCHA reason explains the lock-out', () async {
      final e = await failWith(
        http.Response(
          '',
          403,
          headers: {'x-seraph-loginreason': 'AUTHENTICATION_DENIED'},
        ),
      );
      expect(e, isA<JiraPermissionException>());
      expect(e.message, contains('CAPTCHA'));
    });

    test('HTML login page is not treated as success', () async {
      final e = await failWith(
        http.Response(
          '<html>login</html>',
          200,
          headers: {'content-type': 'text/html'},
        ),
      );
      expect(e, isA<JiraServerException>());
      expect(e.message, contains('login'));
    });

    test('redirects are reported, not followed', () async {
      final e = await failWith(
        http.Response('', 302, headers: {'location': 'https://sso/login'}),
      );
      expect(e, isA<JiraAuthException>());
    });

    test('5xx and 429 map to server and rate-limit errors', () async {
      expect(
        await failWith(jsonResponse({'message': 'boom'}, 503)),
        isA<JiraServerException>(),
      );
      final limited = await failWith(
        http.Response('', 429, headers: {'retry-after': '30'}),
      );
      expect(limited, isA<JiraRateLimitException>());
      expect(
        (limited as JiraRateLimitException).retryAfter,
        const Duration(seconds: 30),
      );
    });

    test('socket failures map to network errors', () async {
      final api = client(
        (_) async => throw const SocketException('Connection refused'),
      );
      await expectLater(
        api.getMyself(),
        throwsA(isA<JiraNetworkException>()),
      );
    });
  });

  group('metadata', () {
    test('createmeta falls back to the legacy endpoint', () async {
      final paths = <String>[];
      final api = client((r) async {
        paths.add(r.url.path);
        if (r.url.path.endsWith('/issue/createmeta/DEMO/issuetypes')) {
          return jsonResponse(
            {
              'errorMessages': ['nope'],
            },
            404,
          );
        }
        return jsonResponse({
          'projects': [
            {
              'key': 'DEMO',
              'issuetypes': [
                {'id': '1', 'name': 'Bug'},
                {'id': '5', 'name': 'Sub-task', 'subtask': true},
              ],
            },
          ],
        });
      });
      final types = await api.getCreatableIssueTypes();
      expect(types.map((t) => t.name), ['Bug', 'Sub-task']);
      expect(paths.last, '/rest/api/2/issue/createmeta');
    });

    test('createmeta pages on Jira 8.4+/9', () async {
      final api = client((r) async {
        final start = int.parse(r.url.queryParameters['startAt']!);
        return jsonResponse({
          'startAt': start,
          'total': 3,
          'isLast': start >= 2,
          'values': start == 0
              ? [
                  {'id': '1', 'name': 'Bug'},
                  {'id': '2', 'name': 'Task'},
                ]
              : [
                  {'id': '3', 'name': 'Story'},
                ],
        });
      });
      final types = await api.getCreatableIssueTypes();
      expect(types.map((t) => t.id), ['1', '2', '3']);
    });

    test('transitions are fetched per issue with fields', () async {
      late Uri uri;
      final api = client((r) async {
        uri = r.url;
        return jsonResponse({
          'transitions': [
            transitionJson(
              '11',
              'Start Progress',
              'In Progress',
              'indeterminate',
            ),
            transitionJson(
              '31',
              'Close Issue',
              'Closed',
              'done',
              fields: resolutionField(),
              hasScreen: true,
            ),
          ],
        });
      });
      final transitions = await api.getTransitions('DEMO-7');
      expect(uri.path, '/rest/api/2/issue/DEMO-7/transitions');
      expect(uri.queryParameters['expand'], 'transitions.fields');
      expect(transitions.last.resolutionField?.allowedValues, hasLength(3));
      expect(transitions.last.hasScreen, isTrue);
    });
  });

  group('pickCloseTransition', () {
    JiraTransition t(
      String id,
      String name,
      String cat, {
      Map<String, dynamic> fields = const {},
    }) =>
        JiraTransition.fromJson(
          transitionJson(id, name, name, cat, fields: fields),
        );

    test('prefers a closing transition into the done category', () {
      final picked = pickCloseTransition([
        t('5', "Won't Do", 'done'),
        t('11', 'Start Progress', 'indeterminate'),
        t('41', 'Close', 'done'),
      ]);
      expect(picked?.id, '41');
    });

    test('avoids transitions with unsupported required fields', () {
      final picked = pickCloseTransition([
        t(
          '41',
          'Close',
          'done',
          fields: {
            'customfield_1': {'required': true, 'name': 'Root cause'},
          },
        ),
        t('51', 'Done', 'done'),
      ]);
      expect(picked?.id, '51');
    });

    test('returns null when nothing reaches done', () {
      expect(pickCloseTransition([t('11', 'Start', 'indeterminate')]), isNull);
    });
  });
}
