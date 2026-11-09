import 'dart:async';

import 'package:appflowy_backend/log.dart';
import 'package:http/http.dart' as http;

import 'package:appflowy/features/jira/data/jira_api_client.dart';
import 'package:appflowy/features/jira/data/jira_credential_store.dart';
import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/jira_local_store.dart';
import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';

class JiraSyncResult {
  const JiraSyncResult({
    required this.snapshot,
    required this.added,
    required this.updated,
    required this.removed,
    required this.incremental,
  });

  final JiraCacheSnapshot snapshot;
  final int added;
  final int updated;

  /// Issues no longer matched by the JQL (moved, deleted or filtered out).
  /// They are dropped from the local cache only; nothing is deleted in Jira.
  final int removed;
  final bool incremental;
}

/// Coordinates the Jira REST client with the local cache.
///
/// All writes to Jira are single-issue operations triggered by the user.
/// There are no bulk updates.
class JiraRepository {
  JiraRepository({
    required JiraLocalStore store,
    JiraCredentialStore? credentialStore,
    http.Client? httpClient,
    DateTime Function()? clock,
  })  : _store = store,
        _credentialStore =
            credentialStore ?? SessionJiraCredentialStore.instance,
        _httpClient = httpClient,
        _clock = clock ?? DateTime.now;

  final JiraLocalStore _store;
  final JiraCredentialStore _credentialStore;
  final http.Client? _httpClient;
  final DateTime Function() _clock;

  JiraConfig? _config;
  JiraCacheSnapshot? _snapshot;
  Future<void> _queue = Future.value();

  JiraConfig? get config => _config;

  bool get credentialsPersist => _credentialStore.isPersistent;

  /// Serializes cache mutations so concurrent operations never interleave
  /// read-modify-write cycles.
  Future<T> _locked<T>(Future<T> Function() action) {
    final completer = Completer<T>();
    _queue = _queue.then((_) async {
      try {
        completer.complete(await action());
      } catch (e, s) {
        completer.completeError(e, s);
      }
    });
    return completer.future;
  }

  String _accountId(JiraConfig config) =>
      '${_store.userId}|${config.scopeId}|${config.authType.name}|${config.username}';

  Future<JiraConfig?> loadConfig() async {
    return _config ??= await _store.readConfig();
  }

  Future<bool> hasCredentials() async {
    final config = await loadConfig();
    if (config == null) {
      return false;
    }
    final creds = await _credentialStore.read(_accountId(config));
    return creds != null && !creds.isEmpty;
  }

  /// Saves settings. When [credentials] is null the existing secret for the
  /// same account is kept.
  Future<void> saveConfig(
    JiraConfig config, {
    JiraCredentials? credentials,
  }) async {
    await _locked(() async {
      final previous = _config;
      // Secrets are bound to one server + auth mode + username and are never
      // carried over to a different one.
      if (credentials != null && !credentials.isEmpty) {
        await _credentialStore.write(_accountId(config), credentials);
      }
      if (previous != null && previous.scopeId != config.scopeId) {
        // Different server or project: never keep the old cache around.
        await _store.clearCache();
        _snapshot = null;
      }
      await _store.writeConfig(config);
      _config = config;
    });
  }

  Future<void> forgetCredentials() async {
    final config = await loadConfig();
    if (config != null) {
      await _credentialStore.delete(_accountId(config));
    }
  }

  /// Read-only check of URL, credentials and project visibility.
  Future<(JiraUser, JiraProject)> testConnection(
    JiraConfig config,
    JiraCredentials? credentials,
  ) async {
    final creds = (credentials != null && !credentials.isEmpty)
        ? credentials
        : await _credentialStore.read(_accountId(config));
    final client = _client(config, creds);
    try {
      final user = await client.getMyself();
      final project = await client.getProject();
      return (user, project);
    } finally {
      client.close();
    }
  }

  JiraApiClient _client(JiraConfig config, JiraCredentials? credentials) {
    return JiraApiClient(
      config: config,
      credentials: credentials ?? const JiraCredentials(secret: ''),
      httpClient: _httpClient,
    );
  }

  Future<T> _withClient<T>(Future<T> Function(JiraApiClient client) run) async {
    final config = await loadConfig();
    if (config == null || !config.isComplete) {
      throw const JiraNotConfiguredException(
        'Open Jira settings and enter the server URL and project key.',
      );
    }
    final creds = await _credentialStore.read(_accountId(config));
    if (creds == null || creds.isEmpty) {
      throw const JiraNotConfiguredException(
        'Enter your Jira token in settings to connect.',
      );
    }
    final client = _client(config, creds);
    try {
      return await run(client);
    } finally {
      client.close();
    }
  }

  Future<JiraCacheSnapshot> loadCache() async {
    final config = await loadConfig();
    if (config == null) {
      return const JiraCacheSnapshot(scopeId: '', jql: '', issues: []);
    }
    return _snapshot ??= await _store.readCache(config);
  }

  Future<void> _saveSnapshot(JiraCacheSnapshot snapshot) async {
    _snapshot = snapshot;
    await _store.writeCache(snapshot);
  }

  /// Pulls issues from Jira.
  ///
  /// A full sync mirrors the JQL result into the cache. An incremental sync
  /// only fetches issues updated since the last successful sync (with a
  /// safety overlap) and merges them; it cannot detect removals, so the UI
  /// offers a full refresh as well.
  Future<JiraSyncResult> sync({
    bool full = true,
    void Function(int loaded, int total)? onProgress,
  }) {
    return _locked(() async {
      final config = await loadConfig();
      final current = await loadCache();
      final now = _clock();
      final baseJql = stripOrderBy(config?.effectiveJql ?? '');
      final canIncrement = !full &&
          current.hasSynced &&
          current.jql == baseJql &&
          current.issues.isNotEmpty;

      try {
        final fetched = await _withClient((client) {
          if (canIncrement) {
            // Relative JQL dates avoid server/client timezone mismatches.
            final minutes =
                now.difference(current.lastSuccessAt!).inMinutes + 5;
            return client.searchAll(
              '($baseJql) AND updated >= -${minutes}m',
              onProgress: onProgress,
            );
          }
          return client.searchAll(baseJql, onProgress: onProgress);
        });

        final previous = {for (final i in current.issues) i.key: i};
        var added = 0;
        var updated = 0;
        final List<JiraIssue> merged;
        if (canIncrement) {
          final next = Map<String, JiraIssue>.of(previous);
          for (final issue in fetched) {
            final old = next[issue.key];
            if (old == null) {
              added++;
              next[issue.key] = issue;
            } else if (!old.updated.isAfter(issue.updated)) {
              if (!old.updated.isAtSameMomentAs(issue.updated)) {
                updated++;
              }
              next[issue.key] = issue;
            }
          }
          merged = next.values.toList();
        } else {
          for (final issue in fetched) {
            final old = previous[issue.key];
            if (old == null) {
              added++;
            } else if (!old.updated.isAtSameMomentAs(issue.updated)) {
              updated++;
            }
          }
          merged = fetched;
        }
        final removed = canIncrement
            ? 0
            : previous.keys
                .toSet()
                .difference(fetched.map((i) => i.key).toSet())
                .length;

        merged.sort(compareIssueKeys);
        final snapshot = current.copyWith(
          issues: merged,
          jql: baseJql,
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastError: () => null,
        );
        await _saveSnapshot(snapshot);
        Log.info(
          'Jira: synced ${merged.length} issues '
          '(+$added ~$updated -$removed, incremental: $canIncrement)',
        );
        return JiraSyncResult(
          snapshot: snapshot,
          added: added,
          updated: updated,
          removed: removed,
          incremental: canIncrement,
        );
      } on JiraException catch (e) {
        await _saveSnapshot(
          current.copyWith(lastAttemptAt: now, lastError: () => e.message),
        );
        Log.warn('Jira: sync failed: ${e.runtimeType} ${e.statusCode ?? ''}');
        rethrow;
      }
    });
  }

  Future<List<JiraIssueType>> getCreatableIssueTypes() =>
      _withClient((c) => c.getCreatableIssueTypes());

  Future<JiraIssue> createIssue(JiraIssueDraft draft) async {
    if ((draft.summary ?? '').trim().isEmpty) {
      throw const JiraValidationException(
        'Summary is required.',
        fieldErrors: {'summary': 'Summary is required.'},
      );
    }
    if ((draft.issueTypeId ?? '').isEmpty) {
      throw const JiraValidationException(
        'Choose an issue type.',
        fieldErrors: {'issuetype': 'Choose an issue type.'},
      );
    }
    final issue = await _withClient((client) async {
      final key = await client.createIssue(draft);
      return client.getIssue(key);
    });
    await _locked(() async => _saveSnapshot((await loadCache()).upsert(issue)));
    return issue;
  }

  /// Edits one issue with optimistic concurrency.
  ///
  /// [base] is the version the user started from. If Jira has a newer
  /// version that changed any field being edited, a
  /// [JiraConflictException] is thrown unless [overwrite] is set. Changes to
  /// unrelated fields (e.g. status) do not block the edit.
  Future<JiraIssue> updateIssue(
    JiraIssue base,
    JiraIssueDraft draft, {
    bool overwrite = false,
  }) async {
    final issue = await _withClient((client) async {
      final remote = await client.getIssue(base.key);
      if (!overwrite && remote.updated.isAfter(base.updated)) {
        final conflicts = <String>[
          if (draft.summary != null && remote.summary != base.summary)
            'summary',
          if (draft.description != null &&
              remote.description != base.description)
            'description',
          if (draft.assigneeName != null &&
              remote.assignee?.name != base.assignee?.name)
            'assignee',
        ];
        if (conflicts.isNotEmpty) {
          throw JiraConflictException(
            '${base.key} was changed in Jira after you opened it '
            '(${conflicts.join(', ')}).',
            local: base,
            remote: remote,
          );
        }
      }
      await client.updateIssue(base.key, draft);
      return client.getIssue(base.key);
    });
    await _locked(() async => _saveSnapshot((await loadCache()).upsert(issue)));
    return issue;
  }

  /// Transitions currently available for [issueKey]. Always fetched live:
  /// they depend on the workflow, the issue's status and permissions.
  Future<List<JiraTransition>> getTransitions(String issueKey) =>
      _withClient((c) => c.getTransitions(issueKey));

  Future<JiraIssue> transitionIssue(
    JiraIssue issue,
    JiraTransition transition, {
    String? resolutionId,
    String? comment,
  }) async {
    final unsupported = transition.unsupportedRequiredFields;
    if (unsupported.isNotEmpty) {
      throw JiraTransitionUnsupportedException(
        '"${transition.name}" requires ${unsupported.map((f) => f.name).join(', ')}. '
        'Complete it in Jira.',
      );
    }
    final resolution = transition.resolutionField;
    if (resolution != null && resolution.required && resolutionId == null) {
      throw const JiraValidationException(
        'Choose a resolution.',
        fieldErrors: {'resolution': 'Choose a resolution.'},
      );
    }
    final updated = await _withClient((client) async {
      await client.transitionIssue(
        issue.key,
        transitionId: transition.id,
        resolutionId: resolution == null ? null : resolutionId,
        comment: comment,
      );
      return client.getIssue(issue.key);
    });
    await _locked(
      () async => _saveSnapshot((await loadCache()).upsert(updated)),
    );
    return updated;
  }
}

/// Removes a trailing `ORDER BY` clause so the JQL can be wrapped.
String stripOrderBy(String jql) {
  final match = RegExp(r'\border\s+by\b', caseSensitive: false).firstMatch(jql);
  return (match == null ? jql : jql.substring(0, match.start)).trim();
}

/// Sorts `ABC-2` before `ABC-10`.
int compareIssueKeys(JiraIssue a, JiraIssue b) {
  final pa = a.key.split('-');
  final pb = b.key.split('-');
  final project = pa.first.compareTo(pb.first);
  if (project != 0) {
    return project;
  }
  final na = int.tryParse(pa.last) ?? 0;
  final nb = int.tryParse(pb.last) ?? 0;
  return na.compareTo(nb);
}
