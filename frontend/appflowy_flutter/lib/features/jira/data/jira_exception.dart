import 'package:appflowy/features/jira/data/models/jira_issue.dart';

/// Errors surfaced by the Jira integration. Messages are written for users
/// and never contain credentials or request headers.
sealed class JiraException implements Exception {
  const JiraException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  /// Short, user-facing title.
  String get title;

  @override
  String toString() =>
      '$runtimeType(${statusCode ?? '-'}): $message'; // no secrets here
}

/// Missing configuration or credentials.
class JiraNotConfiguredException extends JiraException {
  const JiraNotConfiguredException(super.message);

  @override
  String get title => 'Jira is not configured';
}

/// 401: wrong/expired token, or basic auth disabled on the server.
class JiraAuthException extends JiraException {
  const JiraAuthException(super.message, {super.statusCode});

  @override
  String get title => 'Authentication failed';
}

/// 403: authenticated but lacking permission (or CAPTCHA lock-out).
class JiraPermissionException extends JiraException {
  const JiraPermissionException(super.message, {super.statusCode});

  @override
  String get title => 'Permission denied';
}

/// 404: unknown project/issue, or not visible to this user.
class JiraNotFoundException extends JiraException {
  const JiraNotFoundException(super.message, {super.statusCode});

  @override
  String get title => 'Not found';
}

/// 400: Jira rejected the payload. [fieldErrors] maps field id to message.
class JiraValidationException extends JiraException {
  const JiraValidationException(
    super.message, {
    super.statusCode,
    this.fieldErrors = const {},
  });

  final Map<String, String> fieldErrors;

  @override
  String get title => 'Jira rejected the request';
}

/// 429: throttled by the server.
class JiraRateLimitException extends JiraException {
  const JiraRateLimitException(
    super.message, {
    super.statusCode,
    this.retryAfter,
  });

  final Duration? retryAfter;

  @override
  String get title => 'Too many requests';
}

/// 5xx or unexpected response bodies.
class JiraServerException extends JiraException {
  const JiraServerException(super.message, {super.statusCode});

  @override
  String get title => 'Jira server error';
}

/// DNS/TLS/socket/timeout failures.
class JiraNetworkException extends JiraException {
  const JiraNetworkException(super.message);

  @override
  String get title => 'Cannot reach Jira';
}

/// The issue changed on the server after the local copy was loaded.
class JiraConflictException extends JiraException {
  const JiraConflictException(
    super.message, {
    required this.local,
    required this.remote,
  });

  /// The version the user started editing from.
  final JiraIssue local;

  /// The current server version.
  final JiraIssue remote;

  @override
  String get title => 'Edit conflict';
}

/// A transition requires fields that cannot be filled in from AppFlowy.
class JiraTransitionUnsupportedException extends JiraException {
  const JiraTransitionUnsupportedException(super.message);

  @override
  String get title => 'Transition needs more input';
}
