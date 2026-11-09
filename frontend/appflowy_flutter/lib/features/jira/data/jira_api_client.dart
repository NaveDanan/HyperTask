import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';

/// Minimal Jira Server / Data Center REST v2 client.
///
/// * All URLs are built from [JiraConfig.baseUrl], so deployments under a
///   context path (`https://host/jira`) work.
/// * Requests go only to the configured Jira host. Credentials are attached
///   as an `Authorization` header and never logged or echoed in errors.
class JiraApiClient {
  JiraApiClient({
    required this.config,
    required JiraCredentials credentials,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 30),
    this.maxIssues = 10000,
  })  : _credentials = credentials,
        _http = httpClient ?? http.Client(),
        _ownsClient = httpClient == null;

  final JiraConfig config;
  final JiraCredentials _credentials;
  final http.Client _http;
  final bool _ownsClient;
  final Duration timeout;

  /// Safety cap for paginated reads.
  final int maxIssues;

  void close() {
    if (_ownsClient) {
      _http.close();
    }
  }

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = Uri.parse(config.baseUrl);
    final basePath = base.path.endsWith('/')
        ? base.path.substring(0, base.path.length - 1)
        : base.path;
    return base.replace(
      path: '$basePath/rest/api/2$path',
      queryParameters: query == null || query.isEmpty ? null : query,
    );
  }

  Map<String, String> get _headers => {
        HttpHeaders.acceptHeader: 'application/json',
        HttpHeaders.contentTypeHeader: 'application/json; charset=utf-8',
        HttpHeaders.authorizationHeader:
            _credentials.authorizationHeader(config.authType),
        // Required by Jira for some state-changing endpoints (XSRF check).
        'X-Atlassian-Token': 'no-check',
      };

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    if (!config.isComplete) {
      throw const JiraNotConfiguredException(
        'Set the Jira URL and project key first.',
      );
    }
    if (_credentials.isEmpty) {
      throw const JiraNotConfiguredException(
        'Enter a Jira personal access token or password.',
      );
    }

    final request = http.Request(method, _uri(path, query))
      ..headers.addAll(_headers)
      // Never follow redirects: they usually point to an SSO/login page and
      // would forward the Authorization header to another location.
      ..followRedirects = false;
    if (body != null) {
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      final streamed = await _http.send(request).timeout(timeout);
      response = await http.Response.fromStream(streamed).timeout(timeout);
    } on TimeoutException {
      throw JiraNetworkException(
        'Jira did not respond within ${timeout.inSeconds}s.',
      );
    } on HandshakeException catch (e) {
      throw JiraNetworkException(
        'TLS handshake with ${request.url.host} failed '
        '(${e.osError?.message ?? e.message}). If your company uses a '
        'private CA, install it in the OS trust store.',
      );
    } on SocketException catch (e) {
      throw JiraNetworkException(
        'Cannot connect to ${request.url.host}: '
        '${e.osError?.message ?? e.message}.',
      );
    } on http.ClientException catch (e) {
      throw JiraNetworkException('Request failed: ${e.message}.');
    }

    return _decode(response);
  }

  dynamic _decode(http.Response response) {
    final status = response.statusCode;
    final contentType = response.headers[HttpHeaders.contentTypeHeader] ?? '';
    final isJson = contentType.contains('json');
    dynamic json;
    if (response.body.isNotEmpty && isJson) {
      try {
        json = jsonDecode(response.body);
      } on FormatException {
        json = null;
      }
    }

    if (status >= 200 && status < 300) {
      if (response.body.isEmpty || status == 204) {
        return null;
      }
      if (!isJson || json == null) {
        throw JiraServerException(
          'Expected JSON but got "${contentType.isEmpty ? 'no content type' : contentType}". '
          'The URL may point to a login/SSO page instead of the Jira REST API.',
          statusCode: status,
        );
      }
      return json;
    }

    if (status >= 300 && status < 400) {
      throw JiraAuthException(
        'Jira redirected the request (HTTP $status), usually to a login or '
        'SSO page. Check the base URL/context path and that token '
        'authentication is allowed.',
        statusCode: status,
      );
    }

    final serverMessage = _errorMessage(json);
    switch (status) {
      case 400:
        throw JiraValidationException(
          serverMessage ?? 'Jira rejected the request.',
          statusCode: status,
          fieldErrors: _fieldErrors(json),
        );
      case 401:
        throw JiraAuthException(
          serverMessage ??
              'The token or password was rejected. Personal access tokens '
                  'need the "Bearer" mode; basic auth may be disabled.',
          statusCode: status,
        );
      case 403:
        final reason = response.headers['x-seraph-loginreason'] ?? '';
        throw JiraPermissionException(
          reason.contains('AUTHENTICATION_DENIED')
              ? 'Jira requires a CAPTCHA after failed logins. Sign in once '
                  'in the browser, then retry.'
              : serverMessage ?? 'You do not have permission for this action.',
          statusCode: status,
        );
      case 404:
        throw JiraNotFoundException(
          serverMessage ??
              'Not found. Check the project key and that it is visible to '
                  'you.',
          statusCode: status,
        );
      case 429:
        final retry = int.tryParse(response.headers['retry-after'] ?? '');
        throw JiraRateLimitException(
          serverMessage ?? 'Jira is rate limiting requests. Try again later.',
          statusCode: status,
          retryAfter: retry == null ? null : Duration(seconds: retry),
        );
      default:
        throw JiraServerException(
          serverMessage ?? 'Jira returned HTTP $status.',
          statusCode: status,
        );
    }
  }

  static String? _errorMessage(dynamic json) {
    if (json is! Map<String, dynamic>) {
      return null;
    }
    final messages = <String>[
      ...(json['errorMessages'] as List? ?? const []).map((e) => '$e'),
      ..._fieldErrors(json).entries.map((e) => '${e.key}: ${e.value}'),
      if (json['message'] is String) json['message'] as String,
    ].where((m) => m.trim().isNotEmpty);
    return messages.isEmpty ? null : messages.join('\n');
  }

  static Map<String, String> _fieldErrors(dynamic json) {
    if (json is! Map<String, dynamic>) {
      return const {};
    }
    final errors = json['errors'];
    if (errors is! Map) {
      return const {};
    }
    return errors.map((k, v) => MapEntry('$k', '$v'));
  }

  // ---------------------------------------------------------------- reads

  /// Validates URL + credentials. Returns the authenticated user.
  Future<JiraUser> getMyself() async {
    final json = await _send('GET', '/myself');
    return JiraUser.fromJson(json as Map<String, dynamic>);
  }

  Future<JiraProject> getProject([String? key]) async {
    final json = await _send('GET', '/project/${key ?? config.projectKey}');
    return JiraProject.fromJson(json as Map<String, dynamic>);
  }

  /// Issue types that can be created in the project.
  ///
  /// Jira 8.4+ exposes `createmeta/{project}/issuetypes`; Jira 9 removed the
  /// older `createmeta?projectKeys=` form. Falls back to the project's
  /// issue types if neither is available.
  Future<List<JiraIssueType>> getCreatableIssueTypes() async {
    final key = config.projectKey;
    try {
      final types = <JiraIssueType>[];
      var startAt = 0;
      while (true) {
        final json = await _send(
          'GET',
          '/issue/createmeta/$key/issuetypes',
          query: {'startAt': '$startAt', 'maxResults': '50'},
        ) as Map<String, dynamic>;
        final values = (json['values'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(JiraIssueType.fromJson)
            .toList();
        types.addAll(values);
        final isLast = json['isLast'] as bool? ??
            (values.isEmpty ||
                startAt + values.length >=
                    ((json['total'] as num?)?.toInt() ?? 0));
        if (isLast || values.isEmpty) {
          break;
        }
        startAt += values.length;
      }
      return types;
    } on JiraNotFoundException {
      // Older servers: fall through.
    }

    try {
      final json = await _send(
        'GET',
        '/issue/createmeta',
        query: {'projectKeys': key, 'expand': 'projects.issuetypes'},
      ) as Map<String, dynamic>;
      final projects = (json['projects'] as List? ?? const [])
          .whereType<Map<String, dynamic>>();
      final project = projects.where((p) => p['key'] == key).firstOrNull;
      if (project != null) {
        return (project['issuetypes'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(JiraIssueType.fromJson)
            .toList();
      }
    } on JiraNotFoundException {
      // Fall through.
    }

    return (await getProject(key)).issueTypes;
  }

  Future<JiraIssue> getIssue(String key) async {
    final json = await _send(
      'GET',
      '/issue/$key',
      query: {'fields': JiraIssue.searchFields.join(',')},
    );
    return JiraIssue.fromJson(json as Map<String, dynamic>);
  }

  /// One page of a JQL search.
  Future<JiraSearchPage> search(
    String jql, {
    int startAt = 0,
    int? maxResults,
  }) async {
    final json = await _send(
      'POST',
      '/search',
      body: {
        'jql': jql,
        'startAt': startAt,
        'maxResults': maxResults ?? config.pageSize,
        'fields': JiraIssue.searchFields,
      },
    ) as Map<String, dynamic>;
    final issues = (json['issues'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(JiraIssue.fromJson)
        .toList();
    return JiraSearchPage(
      issues: issues,
      startAt: (json['startAt'] as num?)?.toInt() ?? startAt,
      maxResults: (json['maxResults'] as num?)?.toInt() ?? issues.length,
      total: (json['total'] as num?)?.toInt() ?? issues.length,
    );
  }

  /// Reads all pages for [jql]. Issues are de-duplicated by key in case the
  /// result set shifts while paging.
  Future<List<JiraIssue>> searchAll(
    String jql, {
    void Function(int loaded, int total)? onProgress,
  }) async {
    final orderedJql =
        jql.toLowerCase().contains('order by') ? jql : '$jql ORDER BY key ASC';
    final byKey = <String, JiraIssue>{};
    var startAt = 0;
    while (true) {
      final page = await search(orderedJql, startAt: startAt);
      for (final issue in page.issues) {
        byKey[issue.key] = issue;
      }
      onProgress?.call(byKey.length, page.total);
      if (page.isLast || byKey.length >= maxIssues) {
        break;
      }
      // Advance by what was actually returned; the server may cap
      // maxResults below what was requested.
      startAt = page.startAt + page.issues.length;
    }
    return byKey.values.toList();
  }

  Future<List<JiraTransition>> getTransitions(String issueKey) async {
    final json = await _send(
      'GET',
      '/issue/$issueKey/transitions',
      query: {'expand': 'transitions.fields'},
    ) as Map<String, dynamic>;
    return (json['transitions'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(JiraTransition.fromJson)
        .toList();
  }

  // ------------------------------------------------------------- mutations

  /// Returns the new issue key.
  Future<String> createIssue(JiraIssueDraft draft) async {
    final json = await _send(
      'POST',
      '/issue',
      body: {'fields': draft.toFields(projectKey: config.projectKey)},
    ) as Map<String, dynamic>;
    final key = json['key'] as String?;
    if (key == null || key.isEmpty) {
      throw const JiraServerException('Jira did not return the new issue key.');
    }
    return key;
  }

  /// Updates only the fields present in [draft].
  Future<void> updateIssue(String issueKey, JiraIssueDraft draft) async {
    final fields = draft.toFields();
    if (fields.isEmpty) {
      return;
    }
    await _send('PUT', '/issue/$issueKey', body: {'fields': fields});
  }

  Future<void> transitionIssue(
    String issueKey, {
    required String transitionId,
    String? resolutionId,
    String? comment,
  }) async {
    await _send(
      'POST',
      '/issue/$issueKey/transitions',
      body: {
        'transition': {'id': transitionId},
        if (resolutionId != null)
          'fields': {
            'resolution': {'id': resolutionId},
          },
        if (comment != null && comment.trim().isNotEmpty)
          'update': {
            'comment': [
              {
                'add': {'body': comment.trim()},
              },
            ],
          },
      },
    );
  }
}
