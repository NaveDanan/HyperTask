import 'dart:convert';

/// How requests are authenticated against Jira Server / Data Center.
enum JiraAuthType {
  /// `Authorization: Bearer <personal access token>` (Jira DC 8.14+).
  personalAccessToken,

  /// `Authorization: Basic base64(username:password-or-token)`.
  ///
  /// Some Data Center instances disable basic auth; prefer PATs.
  basic;

  String get label => switch (this) {
        personalAccessToken => 'Personal access token (Bearer)',
        basic => 'Username + password/token (Basic)',
      };

  static JiraAuthType fromName(String? name) => JiraAuthType.values
      .firstWhere((e) => e.name == name, orElse: () => personalAccessToken);
}

/// Non-secret Jira connection settings.
///
/// Secrets live in [JiraCredentials] and are never serialized with this
/// object.
class JiraConfig {
  const JiraConfig({
    required this.baseUrl,
    required this.projectKey,
    this.authType = JiraAuthType.personalAccessToken,
    this.username = '',
    this.customJql = '',
    this.databaseViewId = '',
    this.pageSize = 100,
  });

  factory JiraConfig.fromJson(Map<String, dynamic> json) {
    return JiraConfig(
      baseUrl: normalizeBaseUrl(json['baseUrl'] as String? ?? ''),
      projectKey: (json['projectKey'] as String? ?? '').trim().toUpperCase(),
      authType: JiraAuthType.fromName(json['authType'] as String?),
      username: json['username'] as String? ?? '',
      customJql: json['customJql'] as String? ?? '',
      databaseViewId: json['databaseViewId'] as String? ?? '',
      pageSize: (json['pageSize'] as num?)?.toInt() ?? 100,
    );
  }

  /// Builds a config from any Jira URL the user may paste, e.g.
  /// `https://jira.example.com/projects/DEMO/`,
  /// `https://host/jira/browse/DEMO-12` or `https://host/jira`.
  ///
  /// The context path (`/jira`) is preserved and the project key is derived
  /// from the URL when [projectKey] is not provided.
  factory JiraConfig.fromUserUrl(
    String url, {
    String? projectKey,
    JiraAuthType authType = JiraAuthType.personalAccessToken,
    String username = '',
  }) {
    final parsed = parseJiraUrl(url);
    return JiraConfig(
      baseUrl: parsed.baseUrl,
      projectKey: (projectKey?.trim().isNotEmpty ?? false)
          ? projectKey!.trim().toUpperCase()
          : parsed.projectKey ?? '',
      authType: authType,
      username: username,
    );
  }

  /// Jira base URL including any deployment context path, without a trailing
  /// slash, e.g. `https://jira.example.com` or `https://host/jira`.
  final String baseUrl;
  final String projectKey;
  final JiraAuthType authType;

  /// Only used for [JiraAuthType.basic].
  final String username;

  /// Optional JQL replacing the default `project = KEY`. Ordering is always
  /// appended by the client so that paging is stable.
  final String customJql;

  /// Optional AppFlowy database view that mirrors Jira issues.
  final String databaseViewId;

  final int pageSize;

  bool get isComplete => baseUrl.isNotEmpty && projectKey.isNotEmpty;

  /// Identifies the remote data set. Caches from a different server/project
  /// must never be mixed.
  String get scopeId => '$baseUrl|$projectKey';

  String get defaultJql => 'project = "$projectKey"';

  String get effectiveJql =>
      customJql.trim().isEmpty ? defaultJql : customJql.trim();

  String browseUrl(String issueKey) => '$baseUrl/browse/$issueKey';

  String get projectUrl => '$baseUrl/projects/$projectKey';

  JiraConfig copyWith({
    String? baseUrl,
    String? projectKey,
    JiraAuthType? authType,
    String? username,
    String? customJql,
    String? databaseViewId,
    int? pageSize,
  }) {
    return JiraConfig(
      baseUrl: baseUrl != null ? normalizeBaseUrl(baseUrl) : this.baseUrl,
      projectKey: projectKey?.trim().toUpperCase() ?? this.projectKey,
      authType: authType ?? this.authType,
      username: username ?? this.username,
      customJql: customJql ?? this.customJql,
      databaseViewId: databaseViewId ?? this.databaseViewId,
      pageSize: pageSize ?? this.pageSize,
    );
  }

  Map<String, dynamic> toJson() => {
        'baseUrl': baseUrl,
        'projectKey': projectKey,
        'authType': authType.name,
        'username': username,
        'customJql': customJql,
        'databaseViewId': databaseViewId,
        'pageSize': pageSize,
      };

  String encode() => jsonEncode(toJson());

  @override
  bool operator ==(Object other) =>
      other is JiraConfig &&
      other.baseUrl == baseUrl &&
      other.projectKey == projectKey &&
      other.authType == authType &&
      other.username == username &&
      other.customJql == customJql &&
      other.databaseViewId == databaseViewId &&
      other.pageSize == pageSize;

  @override
  int get hashCode => Object.hash(
        baseUrl,
        projectKey,
        authType,
        username,
        customJql,
        databaseViewId,
        pageSize,
      );

  /// Removes trailing slashes, query and fragment. Keeps the context path.
  static String normalizeBaseUrl(String url) {
    var value = url.trim();
    if (value.isEmpty) {
      return '';
    }
    if (!value.contains('://')) {
      value = 'https://$value';
    }
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty) {
      return '';
    }
    var path = uri.path;
    while (path.endsWith('/')) {
      path = path.substring(0, path.length - 1);
    }
    return Uri(
      scheme: uri.scheme,
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
      path: path,
    ).toString();
  }

  /// Splits a pasted Jira URL into base URL (with context path) and an
  /// optional project key.
  static ({String baseUrl, String? projectKey}) parseJiraUrl(String url) {
    final normalized = normalizeBaseUrl(url);
    if (normalized.isEmpty) {
      return (baseUrl: '', projectKey: null);
    }
    final uri = Uri.parse(normalized);
    final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();

    // Markers after which the remaining path belongs to Jira routes, not to
    // the deployment context path.
    const markers = {
      'projects',
      'browse',
      'secure',
      'rest',
      'issues',
      'plugins',
      'login.jsp',
    };
    final markerIndex = segments.indexWhere(markers.contains);
    String? projectKey;
    var contextSegments = segments;
    if (markerIndex >= 0) {
      contextSegments = segments.sublist(0, markerIndex);
      final marker = segments[markerIndex];
      if (markerIndex + 1 < segments.length) {
        final next = segments[markerIndex + 1];
        if (marker == 'projects') {
          projectKey = next.toUpperCase();
        } else if (marker == 'browse') {
          final match =
              RegExp(r'^([A-Za-z][A-Za-z0-9_]*)(-\d+)?$').firstMatch(next);
          projectKey = match?.group(1)?.toUpperCase();
        }
      }
    }
    final base = Uri(
      scheme: uri.scheme,
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
      path: contextSegments.isEmpty ? '' : '/${contextSegments.join('/')}',
    ).toString();
    return (baseUrl: base, projectKey: projectKey);
  }
}

/// Secret material. [toString] is redacted so it can never leak into logs.
class JiraCredentials {
  const JiraCredentials({required this.secret, this.username = ''});

  final String secret;
  final String username;

  bool get isEmpty => secret.isEmpty;

  /// Builds the `Authorization` header value for [authType].
  String authorizationHeader(JiraAuthType authType) {
    switch (authType) {
      case JiraAuthType.personalAccessToken:
        return 'Bearer $secret';
      case JiraAuthType.basic:
        final encoded = base64Encode(utf8.encode('$username:$secret'));
        return 'Basic $encoded';
    }
  }

  @override
  String toString() => 'JiraCredentials(username: $username, secret: ***)';
}
