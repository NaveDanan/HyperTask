import 'package:appflowy_backend/log.dart';
import 'package:bloc/bloc.dart';

import 'package:appflowy/features/jira/data/jira_dashboard_stats.dart';
import 'package:appflowy/features/jira/data/jira_database_mapper.dart';
import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/jira_local_store.dart';
import 'package:appflowy/features/jira/data/jira_repository.dart';
import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';

sealed class JiraEvent {
  const JiraEvent();
}

class JiraStarted extends JiraEvent {
  const JiraStarted();
}

class JiraConfigSaved extends JiraEvent {
  const JiraConfigSaved(this.config, {this.credentials});

  final JiraConfig config;
  final JiraCredentials? credentials;
}

class JiraSyncRequested extends JiraEvent {
  const JiraSyncRequested({this.full = true});

  final bool full;
}

class JiraSyncProgressed extends JiraEvent {
  const JiraSyncProgressed(this.loaded, this.total);

  final int loaded;
  final int total;
}

/// Fired after a dialog created, edited or transitioned an issue.
class JiraIssueChanged extends JiraEvent {
  const JiraIssueChanged(this.issue, {this.message});

  final JiraIssue issue;
  final String? message;
}

class JiraFilterChanged extends JiraEvent {
  const JiraFilterChanged({this.category, this.query, this.assignee});

  /// Selecting the active category or assignee again toggles it off;
  /// [JiraFilterCleared] resets everything.
  final JiraStatusCategory? category;
  final String? query;
  final String? assignee;
}

class JiraFilterCleared extends JiraEvent {
  const JiraFilterCleared();
}

class JiraDatabaseSyncRequested extends JiraEvent {
  const JiraDatabaseSyncRequested();
}

class JiraMessageDismissed extends JiraEvent {
  const JiraMessageDismissed();
}

class JiraState {
  const JiraState({
    this.isLoading = true,
    this.config,
    this.hasCredentials = false,
    this.credentialsPersist = false,
    this.snapshot = const JiraCacheSnapshot(scopeId: '', jql: '', issues: []),
    this.isSyncing = false,
    this.syncLoaded = 0,
    this.syncTotal = 0,
    this.error,
    this.message,
    this.categoryFilter,
    this.assigneeFilter,
    this.query = '',
    this.isDatabaseSyncing = false,
  });

  final bool isLoading;
  final JiraConfig? config;
  final bool hasCredentials;
  final bool credentialsPersist;
  final JiraCacheSnapshot snapshot;
  final bool isSyncing;
  final int syncLoaded;
  final int syncTotal;

  /// Error from the most recent user action in this session.
  final JiraException? error;

  /// Transient success/info message.
  final String? message;
  final JiraStatusCategory? categoryFilter;

  /// Assignee username; empty string means unassigned.
  final String? assigneeFilter;
  final String query;
  final bool isDatabaseSyncing;

  bool get isConfigured => config?.isComplete ?? false;

  bool get canSync => isConfigured && hasCredentials && !isSyncing;

  JiraDashboardStats get stats => JiraDashboardStats.from(snapshot.issues);

  List<JiraIssue> get visibleIssues {
    final q = query.trim().toLowerCase();
    return snapshot.issues.where((issue) {
      if (categoryFilter != null && issue.statusCategory != categoryFilter) {
        return false;
      }
      if (assigneeFilter != null &&
          (issue.assignee?.name ?? '') != assigneeFilter) {
        return false;
      }
      if (q.isEmpty) {
        return true;
      }
      return issue.key.toLowerCase().contains(q) ||
          issue.summary.toLowerCase().contains(q) ||
          issue.statusName.toLowerCase().contains(q) ||
          issue.assigneeLabel.toLowerCase().contains(q);
    }).toList();
  }

  JiraState copyWith({
    bool? isLoading,
    JiraConfig? config,
    bool? hasCredentials,
    bool? credentialsPersist,
    JiraCacheSnapshot? snapshot,
    bool? isSyncing,
    int? syncLoaded,
    int? syncTotal,
    JiraException? Function()? error,
    String? Function()? message,
    JiraStatusCategory? Function()? categoryFilter,
    String? Function()? assigneeFilter,
    String? query,
    bool? isDatabaseSyncing,
  }) {
    return JiraState(
      isLoading: isLoading ?? this.isLoading,
      config: config ?? this.config,
      hasCredentials: hasCredentials ?? this.hasCredentials,
      credentialsPersist: credentialsPersist ?? this.credentialsPersist,
      snapshot: snapshot ?? this.snapshot,
      isSyncing: isSyncing ?? this.isSyncing,
      syncLoaded: syncLoaded ?? this.syncLoaded,
      syncTotal: syncTotal ?? this.syncTotal,
      error: error != null ? error() : this.error,
      message: message != null ? message() : this.message,
      categoryFilter:
          categoryFilter != null ? categoryFilter() : this.categoryFilter,
      assigneeFilter:
          assigneeFilter != null ? assigneeFilter() : this.assigneeFilter,
      query: query ?? this.query,
      isDatabaseSyncing: isDatabaseSyncing ?? this.isDatabaseSyncing,
    );
  }
}

class JiraBloc extends Bloc<JiraEvent, JiraState> {
  JiraBloc({
    required this.repository,
    JiraDatabaseMapper? databaseMapper,
  })  : _databaseMapper = databaseMapper,
        super(const JiraState()) {
    on<JiraStarted>(_onStarted);
    on<JiraConfigSaved>(_onConfigSaved);
    on<JiraSyncRequested>(_onSyncRequested);
    on<JiraSyncProgressed>(
      (e, emit) =>
          emit(state.copyWith(syncLoaded: e.loaded, syncTotal: e.total)),
    );
    on<JiraIssueChanged>(_onIssueChanged);
    on<JiraFilterChanged>(_onFilterChanged);
    on<JiraFilterCleared>(
      (e, emit) => emit(
        state.copyWith(
          categoryFilter: () => null,
          assigneeFilter: () => null,
          query: '',
        ),
      ),
    );
    on<JiraDatabaseSyncRequested>(_onDatabaseSyncRequested);
    on<JiraMessageDismissed>(
      (e, emit) => emit(state.copyWith(error: () => null, message: () => null)),
    );
  }

  final JiraRepository repository;
  final JiraDatabaseMapper? _databaseMapper;

  Future<void> _reload(Emitter<JiraState> emit) async {
    final config = await repository.loadConfig();
    final hasCredentials = await repository.hasCredentials();
    final snapshot = await repository.loadCache();
    emit(
      state.copyWith(
        isLoading: false,
        config: config,
        hasCredentials: hasCredentials,
        credentialsPersist: repository.credentialsPersist,
        snapshot: snapshot,
      ),
    );
  }

  Future<void> _onStarted(JiraStarted event, Emitter<JiraState> emit) async {
    await _reload(emit);
    // Refresh in the background when possible; cached data shows meanwhile.
    if (state.canSync) {
      add(const JiraSyncRequested(full: false));
    }
  }

  Future<void> _onConfigSaved(
    JiraConfigSaved event,
    Emitter<JiraState> emit,
  ) async {
    await repository.saveConfig(event.config, credentials: event.credentials);
    await _reload(emit);
    emit(state.copyWith(error: () => null, message: () => 'Settings saved'));
    if (state.canSync) {
      add(const JiraSyncRequested());
    }
  }

  Future<void> _onSyncRequested(
    JiraSyncRequested event,
    Emitter<JiraState> emit,
  ) async {
    if (state.isSyncing) {
      return;
    }
    emit(
      state.copyWith(
        isSyncing: true,
        syncLoaded: 0,
        syncTotal: 0,
        error: () => null,
      ),
    );
    try {
      final result = await repository.sync(
        full: event.full,
        onProgress: (loaded, total) {
          if (!isClosed) {
            add(JiraSyncProgressed(loaded, total));
          }
        },
      );
      emit(
        state.copyWith(
          isSyncing: false,
          snapshot: result.snapshot,
          message: () => 'Synced ${result.snapshot.issues.length} issues '
              '(${result.added} new, ${result.updated} updated'
              '${result.removed > 0 ? ', ${result.removed} no longer matched' : ''})',
        ),
      );
    } on JiraException catch (e) {
      emit(
        state.copyWith(
          isSyncing: false,
          snapshot: await repository.loadCache(),
          error: () => e,
        ),
      );
    } catch (e, s) {
      Log.error('Jira: unexpected sync failure', e, s);
      emit(
        state.copyWith(
          isSyncing: false,
          error: () => JiraServerException('Unexpected error: $e'),
        ),
      );
    }
  }

  Future<void> _onIssueChanged(
    JiraIssueChanged event,
    Emitter<JiraState> emit,
  ) async {
    emit(
      state.copyWith(
        snapshot: await repository.loadCache(),
        error: () => null,
        message: () => event.message,
      ),
    );
  }

  void _onFilterChanged(JiraFilterChanged event, Emitter<JiraState> emit) {
    emit(
      state.copyWith(
        categoryFilter: event.category == null
            ? null
            : () =>
                event.category == state.categoryFilter ? null : event.category,
        assigneeFilter: event.assignee == null
            ? null
            : () =>
                event.assignee == state.assigneeFilter ? null : event.assignee,
        query: event.query,
      ),
    );
  }

  Future<void> _onDatabaseSyncRequested(
    JiraDatabaseSyncRequested event,
    Emitter<JiraState> emit,
  ) async {
    final mapper = _databaseMapper;
    final config = state.config;
    if (mapper == null || config == null || state.isDatabaseSyncing) {
      return;
    }
    emit(state.copyWith(isDatabaseSyncing: true, error: () => null));
    try {
      final report = await mapper.sync(
        viewId: config.databaseViewId,
        config: config,
        issues: state.snapshot.issues,
      );
      emit(
        state.copyWith(
          isDatabaseSyncing: false,
          message: () => 'Database updated: ${report.summary}',
        ),
      );
    } on JiraException catch (e) {
      emit(state.copyWith(isDatabaseSyncing: false, error: () => e));
    } catch (e, s) {
      Log.error('Jira: database mapping failed', e, s);
      emit(
        state.copyWith(
          isDatabaseSyncing: false,
          error: () => JiraServerException('Database update failed: $e'),
        ),
      );
    }
  }
}
