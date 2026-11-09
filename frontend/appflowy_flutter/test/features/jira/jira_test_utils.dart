import 'dart:convert';

import 'package:appflowy/core/config/kv.dart';
import 'package:appflowy/features/jira/jira.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// In-memory [KeyValueStorage].
class FakeKeyValue implements KeyValueStorage {
  final Map<String, String> values = {};

  @override
  Future<void> clear() async => values.clear();

  @override
  Future<String?> get(String key) async => values[key];

  @override
  Future<T?> getWithFormat<T>(
    String key,
    T Function(String value) formatter,
  ) async {
    final value = values[key];
    return value == null ? null : formatter(value);
  }

  @override
  Future<void> remove(String key) async => values.remove(key);

  @override
  Future<void> set(String key, String value) async => values[key] = value;
}

const testToken = 'pat-SECRET-0123456789';

const testConfig = JiraConfig(
  baseUrl: 'https://jira.example.com',
  projectKey: 'DEMO',
);

http.Response jsonResponse(Object? body, [int status = 200]) => http.Response(
      body == null ? '' : jsonEncode(body),
      status,
      headers: {'content-type': 'application/json;charset=UTF-8'},
    );

Map<String, dynamic> issueJson(
  String key, {
  String? summary,
  String status = 'To Do',
  String category = 'new',
  String? assignee,
  String updated = '2024-05-01T10:00:00.000+0300',
  String description = '',
  String type = 'Task',
}) {
  return {
    'id': key.split('-').last,
    'key': key,
    'fields': {
      'summary': summary ?? 'Summary of $key',
      'description': description,
      'status': {
        'name': status,
        'statusCategory': {'key': category},
      },
      'issuetype': {'id': '10002', 'name': type},
      'priority': {'name': 'Medium'},
      'assignee': assignee == null
          ? null
          : {
              'name': assignee,
              'key': assignee,
              'displayName': 'User $assignee',
            },
      'created': '2024-04-01T10:00:00.000+0300',
      'updated': updated,
    },
  };
}

Map<String, dynamic> transitionJson(
  String id,
  String name,
  String toStatus,
  String category, {
  Map<String, dynamic> fields = const {},
  bool hasScreen = false,
}) {
  return {
    'id': id,
    'name': name,
    'hasScreen': hasScreen,
    'to': {
      'name': toStatus,
      'statusCategory': {'key': category},
    },
    'fields': fields,
  };
}

Map<String, dynamic> resolutionField({bool required = true}) => {
      'resolution': {
        'required': required,
        'name': 'Resolution',
        'allowedValues': [
          {'id': '1', 'name': 'Fixed'},
          {'id': '2', 'name': "Won't Fix"},
          {'id': '10000', 'name': 'Done'},
        ],
      },
    };

/// Builds a repository with saved config + token on fake storage.
Future<JiraRepository> configuredRepository(
  http.Client client, {
  FakeKeyValue? storage,
  JiraConfig config = testConfig,
  DateTime Function()? clock,
}) async {
  final repo = JiraRepository(
    store: JiraLocalStore(userId: '1', storage: storage ?? FakeKeyValue()),
    credentialStore: SessionJiraCredentialStore(),
    httpClient: client,
    clock: clock,
  );
  await repo.saveConfig(
    config,
    credentials: const JiraCredentials(secret: testToken),
  );
  return repo;
}

/// Tiny router for MockClient keyed by "METHOD path".
class FakeJira {
  final List<http.Request> requests = [];
  final Map<String, Future<http.Response> Function(http.Request)> routes = {};

  void on(
    String method,
    String path,
    Future<http.Response> Function(http.Request) handler,
  ) {
    routes['$method $path'] = handler;
  }

  MockClient get client => MockClient((request) async {
        requests.add(request);
        final handler = routes['${request.method} ${request.url.path}'];
        if (handler == null) {
          return jsonResponse(
            {
              'errorMessages': [
                'No route ${request.method} ${request.url.path}',
              ],
            },
            404,
          );
        }
        return handler(request);
      });

  List<http.Request> where(String method, String path) =>
      requests.where((r) => r.method == method && r.url.path == path).toList();
}
