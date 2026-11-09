import 'dart:convert';

import 'package:appflowy/core/config/kv.dart';
import 'package:appflowy_backend/log.dart';

import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';

/// Snapshot of the last known Jira state for one AppFlowy user.
class JiraCacheSnapshot {
  const JiraCacheSnapshot({
    required this.scopeId,
    required this.jql,
    required this.issues,
    this.lastAttemptAt,
    this.lastSuccessAt,
    this.lastError,
  });

  factory JiraCacheSnapshot.empty(JiraConfig config) => JiraCacheSnapshot(
        scopeId: config.scopeId,
        jql: config.effectiveJql,
        issues: const [],
      );

  factory JiraCacheSnapshot.fromJson(Map<String, dynamic> json) {
    return JiraCacheSnapshot(
      scopeId: json['scopeId'] as String? ?? '',
      jql: json['jql'] as String? ?? '',
      issues: (json['issues'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(JiraIssue.fromJson)
          .toList(),
      lastAttemptAt: DateTime.tryParse(json['lastAttemptAt'] as String? ?? ''),
      lastSuccessAt: DateTime.tryParse(json['lastSuccessAt'] as String? ?? ''),
      lastError: json['lastError'] as String?,
    );
  }

  final String scopeId;
  final String jql;
  final List<JiraIssue> issues;
  final DateTime? lastAttemptAt;
  final DateTime? lastSuccessAt;

  /// User-facing error from the last failed sync, cleared on success.
  final String? lastError;

  bool get hasSynced => lastSuccessAt != null;

  JiraCacheSnapshot copyWith({
    List<JiraIssue>? issues,
    DateTime? lastAttemptAt,
    DateTime? lastSuccessAt,
    String? jql,
    String? Function()? lastError,
  }) {
    return JiraCacheSnapshot(
      scopeId: scopeId,
      jql: jql ?? this.jql,
      issues: issues ?? this.issues,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
      lastSuccessAt: lastSuccessAt ?? this.lastSuccessAt,
      lastError: lastError != null ? lastError() : this.lastError,
    );
  }

  /// Replaces or inserts one issue, keyed by its stable key.
  JiraCacheSnapshot upsert(JiraIssue issue) {
    final next = [...issues];
    final index =
        next.indexWhere((i) => i.key == issue.key || i.id == issue.id);
    if (index >= 0) {
      next[index] = issue;
    } else {
      next.add(issue);
    }
    return copyWith(issues: next);
  }

  Map<String, dynamic> toJson() => {
        'version': 1,
        'scopeId': scopeId,
        'jql': jql,
        'issues': issues.map((e) => e.toJson()).toList(),
        'lastAttemptAt': lastAttemptAt?.toUtc().toIso8601String(),
        'lastSuccessAt': lastSuccessAt?.toUtc().toIso8601String(),
        'lastError': lastError,
      };
}

/// Persists non-secret config and the issue cache on this device only.
///
/// Entries are namespaced per AppFlowy user id so different local accounts
/// never see each other's Jira data. Nothing here is synced to AppFlowy
/// cloud.
class JiraLocalStore {
  JiraLocalStore({required this.userId, KeyValueStorage? storage})
      : _storage = storage ?? DartKeyValue();

  final String userId;
  final KeyValueStorage _storage;

  String get _configKey => 'appflowy.jira.$userId.config';
  String get _cacheKey => 'appflowy.jira.$userId.cache';

  Future<JiraConfig?> readConfig() async {
    final raw = await _storage.get(_configKey);
    if (raw == null) {
      return null;
    }
    try {
      return JiraConfig.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (e) {
      Log.warn('Jira: ignoring unreadable config: $e');
      return null;
    }
  }

  Future<void> writeConfig(JiraConfig config) =>
      _storage.set(_configKey, config.encode());

  /// Returns the cache only if it belongs to [config]'s server + project.
  Future<JiraCacheSnapshot> readCache(JiraConfig config) async {
    final raw = await _storage.get(_cacheKey);
    if (raw == null) {
      return JiraCacheSnapshot.empty(config);
    }
    try {
      final snapshot =
          JiraCacheSnapshot.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      if (snapshot.scopeId != config.scopeId) {
        return JiraCacheSnapshot.empty(config);
      }
      return snapshot;
    } catch (e) {
      Log.warn('Jira: discarding unreadable cache: $e');
      return JiraCacheSnapshot.empty(config);
    }
  }

  Future<void> writeCache(JiraCacheSnapshot snapshot) =>
      _storage.set(_cacheKey, jsonEncode(snapshot.toJson()));

  Future<void> clearCache() => _storage.remove(_cacheKey);
}
