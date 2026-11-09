import 'package:appflowy/core/helpers/url_launcher.dart';
import 'package:appflowy/features/jira/data/jira_dashboard_stats.dart';
import 'package:appflowy/features/jira/data/jira_database_mapper.dart';
import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/jira_local_store.dart';
import 'package:appflowy/features/jira/data/jira_repository.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';
import 'package:appflowy/features/jira/logic/jira_bloc.dart';
import 'package:appflowy/features/jira/presentation/dialogs/jira_issue_dialog.dart';
import 'package:appflowy/features/jira/presentation/dialogs/jira_settings_dialog.dart';
import 'package:appflowy/features/jira/presentation/dialogs/jira_transition_dialog.dart';
import 'package:appflowy/features/jira/presentation/widgets/jira_widgets.dart';
import 'package:appflowy/generated/flowy_svgs.g.dart';
import 'package:appflowy_backend/protobuf/flowy-user/protobuf.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

/// Jira project dashboard: cached issue list, sync, create/edit/close and
/// progress by status category and assignee.
///
/// Data is scoped to [user] on this device. [repository] and
/// [databaseMapper] can be injected for tests.
class JiraDashboardPage extends StatelessWidget {
  const JiraDashboardPage({
    super.key,
    required this.user,
    this.repository,
    this.databaseMapper,
  });

  final UserProfilePB user;
  final JiraRepository? repository;
  final JiraDatabaseMapper? databaseMapper;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => JiraBloc(
        repository: repository ??
            JiraRepository(store: JiraLocalStore(userId: user.id.toString())),
        databaseMapper: databaseMapper ??
            JiraDatabaseMapper(gateway: const BackendJiraDatabaseGateway()),
      )..add(const JiraStarted()),
      child: const _JiraDashboardView(),
    );
  }
}

class _JiraDashboardView extends StatelessWidget {
  const _JiraDashboardView();

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return ColoredBox(
      color: theme.surfaceColorScheme.primary,
      child: BlocBuilder<JiraBloc, JiraState>(
        builder: (context, state) {
          if (state.isLoading) {
            return const Center(child: CircularProgressIndicator.adaptive());
          }
          return Padding(
            padding: EdgeInsets.symmetric(
              horizontal: theme.spacing.xxl,
              vertical: theme.spacing.xl,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: theme.spacing.l,
              children: [
                const _Header(),
                ..._banners(context, state),
                if (!state.isConfigured)
                  const Expanded(child: _EmptyState())
                else ...[
                  _StatsRow(stats: state.stats, selected: state.categoryFilter),
                  const Expanded(child: _Body()),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  List<Widget> _banners(BuildContext context, JiraState state) {
    final bloc = context.read<JiraBloc>();
    final banners = <Widget>[];
    final error = state.error;
    if (error != null) {
      banners.add(
        JiraBanner.fromException(
          error,
          onDismiss: () => bloc.add(const JiraMessageDismissed()),
          actions: [
            if (error is JiraAuthException ||
                error is JiraNotConfiguredException ||
                error is JiraNotFoundException)
              AFOutlinedTextButton.normal(
                text: 'Open settings',
                size: AFButtonSize.s,
                onTap: () => openJiraSettings(context),
              ),
          ],
        ),
      );
    } else if (state.snapshot.lastError != null) {
      banners.add(
        JiraBanner(
          kind: JiraBannerKind.warning,
          title: 'Last sync failed '
              '${formatJiraRelative(state.snapshot.lastAttemptAt)}',
          message: '${state.snapshot.lastError}\nShowing cached data from '
              '${formatJiraRelative(state.snapshot.lastSuccessAt)}.',
        ),
      );
    } else if (state.message != null) {
      banners.add(
        JiraBanner(
          kind: JiraBannerKind.success,
          message: state.message!,
          onDismiss: () => bloc.add(const JiraMessageDismissed()),
        ),
      );
    }
    if (state.isConfigured && !state.hasCredentials) {
      banners.add(
        JiraBanner(
          kind: JiraBannerKind.info,
          title: 'Connect to sync',
          message: state.snapshot.hasSynced
              ? 'Showing cached issues. Enter your Jira token to refresh '
                  'and make changes.'
              : 'Enter your Jira personal access token to load issues.',
          actions: [
            AFFilledTextButton.primary(
              text: 'Enter token',
              size: AFButtonSize.s,
              onTap: () => openJiraSettings(context),
            ),
          ],
        ),
      );
    }
    return banners;
  }
}

Future<void> openJiraSettings(BuildContext context) async {
  final bloc = context.read<JiraBloc>();
  final state = bloc.state;
  final result = await showJiraSettingsDialog(
    context,
    repository: bloc.repository,
    config: state.config,
    hasCredentials: state.hasCredentials,
    credentialsPersist: state.credentialsPersist,
  );
  if (result != null) {
    bloc.add(JiraConfigSaved(result.config, credentials: result.credentials));
  }
}

Future<void> _openIssueEditor(BuildContext context, [JiraIssue? issue]) async {
  final bloc = context.read<JiraBloc>();
  final saved = await showJiraIssueDialog(
    context,
    repository: bloc.repository,
    issue: issue,
  );
  if (saved != null) {
    bloc.add(
      JiraIssueChanged(
        saved,
        message: issue == null ? 'Created ${saved.key}' : 'Saved ${saved.key}',
      ),
    );
  }
}

Future<void> _openTransition(BuildContext context, JiraIssue issue) async {
  final bloc = context.read<JiraBloc>();
  final updated = await showJiraTransitionDialog(
    context,
    repository: bloc.repository,
    issue: issue,
    browseUrl: bloc.state.config?.browseUrl(issue.key),
  );
  if (updated != null) {
    bloc.add(
      JiraIssueChanged(
        updated,
        message: '${updated.key} is now ${updated.statusName}',
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final state = context.watch<JiraBloc>().state;
    final bloc = context.read<JiraBloc>();
    final config = state.config;
    final syncLabel = state.isSyncing
        ? (state.syncTotal > 0
            ? 'Syncing ${state.syncLoaded}/${state.syncTotal}…'
            : 'Syncing…')
        : 'Sync';
    return Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      runSpacing: theme.spacing.m,
      spacing: theme.spacing.l,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              config?.isComplete == true
                  ? 'Jira · ${config!.projectKey}'
                  : 'Jira',
              style: theme.textStyle.heading3.prominent(
                color: theme.textColorScheme.primary,
              ),
            ),
            if (config?.isComplete == true)
              Text(
                '${Uri.parse(config!.baseUrl).host} · '
                'synced ${formatJiraRelative(state.snapshot.lastSuccessAt)}',
                style: theme.textStyle.caption.standard(
                  color: theme.textColorScheme.secondary,
                ),
              ),
          ],
        ),
        Wrap(
          spacing: theme.spacing.s,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (state.isConfigured) ...[
              AFFilledTextButton.primary(
                key: const Key('jira-new-issue'),
                text: 'New issue',
                disabled: !state.hasCredentials,
                onTap: () => _openIssueEditor(context),
              ),
              AFOutlinedTextButton.normal(
                key: const Key('jira-sync'),
                text: syncLabel,
                disabled: !state.canSync,
                onTap: () => bloc.add(
                  JiraSyncRequested(full: !state.snapshot.hasSynced),
                ),
              ),
              AFGhostTextButton.primary(
                text: 'Full refresh',
                disabled: !state.canSync,
                onTap: () => bloc.add(const JiraSyncRequested()),
              ),
              if (config!.databaseViewId.isNotEmpty)
                AFGhostTextButton.primary(
                  text: state.isDatabaseSyncing
                      ? 'Updating database…'
                      : 'Update database',
                  disabled:
                      state.isDatabaseSyncing || state.snapshot.issues.isEmpty,
                  onTap: () => bloc.add(const JiraDatabaseSyncRequested()),
                ),
              JiraIconButton(
                tooltip: 'Open project in Jira',
                onTap: () => afLaunchUrlString(config.projectUrl),
                icon: const FlowySvg(FlowySvgs.open_in_browser_s),
              ),
            ],
            JiraIconButton(
              key: const Key('jira-settings'),
              tooltip: 'Jira settings',
              onTap: () => openJiraSettings(context),
              icon: const FlowySvg(FlowySvgs.settings_s),
            ),
          ],
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: theme.spacing.m,
          children: [
            Text(
              'Connect a Jira project',
              style: theme.textStyle.heading4.prominent(
                color: theme.textColorScheme.primary,
              ),
            ),
            Text(
              'Sync issues from Jira Server / Data Center, track progress '
              'and create, edit or close issues without leaving AppFlowy.',
              textAlign: TextAlign.center,
              style: theme.textStyle.body.standard(
                color: theme.textColorScheme.secondary,
              ),
            ),
            AFFilledTextButton.primary(
              key: const Key('jira-connect'),
              text: 'Connect to Jira',
              onTap: () => openJiraSettings(context),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats, required this.selected});

  final JiraDashboardStats stats;
  final JiraStatusCategory? selected;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final bloc = context.read<JiraBloc>();
    final categories = [
      JiraStatusCategory.toDo,
      JiraStatusCategory.inProgress,
      JiraStatusCategory.done,
      if (stats.count(JiraStatusCategory.unknown) > 0)
        JiraStatusCategory.unknown,
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: theme.spacing.m,
      children: [
        Wrap(
          spacing: theme.spacing.m,
          runSpacing: theme.spacing.m,
          children: [
            _StatTile(
              label: 'Total',
              value: stats.total,
              selected: selected == null,
              onTap: () => bloc.add(const JiraFilterCleared()),
            ),
            for (final c in categories)
              _StatTile(
                key: ValueKey('jira-stat-${c.key}'),
                label: c.label,
                value: stats.count(c),
                category: c,
                selected: selected == c,
                onTap: () => bloc.add(JiraFilterChanged(category: c)),
              ),
          ],
        ),
        _ProgressBar(stats: stats),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    super.key,
    required this.label,
    required this.value,
    required this.selected,
    required this.onTap,
    this.category,
  });

  final String label;
  final int value;
  final bool selected;
  final VoidCallback onTap;
  final JiraStatusCategory? category;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final accent = category == null
        ? theme.textColorScheme.primary
        : jiraCategoryColors(theme, category!).$2;
    return Semantics(
      button: true,
      selected: selected,
      label: '$label: $value',
      child: AFGhostButton.normal(
        onTap: onTap,
        padding: EdgeInsets.zero,
        builder: (context, isHovering, _) => Container(
          width: 148,
          padding: EdgeInsets.all(theme.spacing.l),
          decoration: BoxDecoration(
            color: isHovering
                ? theme.surfaceColorScheme.layer01Hover
                : theme.surfaceColorScheme.layer01,
            borderRadius: BorderRadius.circular(theme.borderRadius.l),
            border: Border.all(
              color: selected
                  ? theme.borderColorScheme.themeThick
                  : theme.borderColorScheme.primary,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: theme.spacing.xs,
            children: [
              Text(
                label,
                style: theme.textStyle.caption.enhanced(
                  color: theme.textColorScheme.secondary,
                ),
              ),
              Text(
                '$value',
                style: theme.textStyle.heading2.prominent(color: accent),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Stacked bar of status categories; the label states the done share.
class _ProgressBar extends StatelessWidget {
  const _ProgressBar({required this.stats});

  final JiraDashboardStats stats;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final percent = (stats.progress * 100).round();
    final segments = [
      JiraStatusCategory.done,
      JiraStatusCategory.inProgress,
      JiraStatusCategory.toDo,
      JiraStatusCategory.unknown,
    ].where((c) => stats.count(c) > 0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: theme.spacing.xs,
      children: [
        Text(
          stats.total == 0
              ? 'No issues yet'
              : '$percent% done · ${stats.open} open of ${stats.total}',
          style: theme.textStyle.caption.standard(
            color: theme.textColorScheme.secondary,
          ),
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(theme.borderRadius.s),
          child: SizedBox(
            height: 8,
            child: stats.total == 0
                ? ColoredBox(color: theme.fillColorScheme.contentHover)
                : Row(
                    children: [
                      for (final c in segments)
                        Expanded(
                          flex: stats.count(c),
                          child: ColoredBox(
                            color: c == JiraStatusCategory.toDo
                                ? theme.fillColorScheme.contentVisible
                                : jiraCategoryColors(theme, c).$2,
                          ),
                        ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }
}

class _Body extends StatelessWidget {
  const _Body();

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 960) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: theme.spacing.xl,
            children: const [
              Expanded(child: _IssueList()),
              SizedBox(
                width: 300,
                child: SingleChildScrollView(child: _SidePanel()),
              ),
            ],
          );
        }
        return const _IssueList(header: _SidePanel());
      },
    );
  }
}

class _SidePanel extends StatelessWidget {
  const _SidePanel();

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final state = context.watch<JiraBloc>().state;
    final stats = state.stats;
    final bloc = context.read<JiraBloc>();
    final statuses = stats.byStatus.entries.toList()
      ..sort((a, b) => b.value.$2.compareTo(a.value.$2));
    final caption = theme.textStyle.caption.standard(
      color: theme.textColorScheme.secondary,
    );
    final body = theme.textStyle.body.standard(
      color: theme.textColorScheme.primary,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: theme.spacing.s,
      children: [
        _SectionTitle('Assignees'),
        if (stats.byAssignee.isEmpty) Text('No issues', style: caption),
        for (final a in stats.byAssignee)
          AFGhostButton.normal(
            key: ValueKey('jira-assignee-${a.name}'),
            onTap: () => bloc.add(JiraFilterChanged(assignee: a.name)),
            padding: EdgeInsets.all(theme.spacing.xs),
            builder: (context, isHovering, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: theme.spacing.xs,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        a.displayName,
                        overflow: TextOverflow.ellipsis,
                        style: state.assigneeFilter == a.name
                            ? theme.textStyle.body.enhanced(
                                color: theme.textColorScheme.action,
                              )
                            : body,
                      ),
                    ),
                    Text(
                      '${a.done}/${a.total} done',
                      style: caption,
                    ),
                  ],
                ),
                ClipRRect(
                  borderRadius: BorderRadius.circular(theme.borderRadius.xs),
                  child: LinearProgressIndicator(
                    value: a.progress,
                    minHeight: 4,
                    backgroundColor: theme.fillColorScheme.contentHover,
                    color: theme.textColorScheme.success,
                  ),
                ),
              ],
            ),
          ),
        SizedBox(height: theme.spacing.l),
        _SectionTitle('Statuses'),
        for (final s in statuses)
          Padding(
            padding: EdgeInsets.symmetric(vertical: theme.spacing.xs / 2),
            child: Row(
              children: [
                Flexible(
                  child: JiraStatusBadge(label: s.key, category: s.value.$1),
                ),
                const Spacer(),
                Text('${s.value.$2}', style: body),
              ],
            ),
          ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return Text(
      text,
      style: theme.textStyle.body.enhanced(
        color: theme.textColorScheme.primary,
      ),
    );
  }
}

class _IssueList extends StatelessWidget {
  const _IssueList({this.header});

  /// Shown above the issues in narrow layouts.
  final Widget? header;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final state = context.watch<JiraBloc>().state;
    final bloc = context.read<JiraBloc>();
    final issues = state.visibleIssues;
    final hasFilter = state.categoryFilter != null ||
        state.assigneeFilter != null ||
        state.query.isNotEmpty;
    final leading = <Widget>[
      if (header != null) ...[header!, SizedBox(height: theme.spacing.l)],
      Row(
        spacing: theme.spacing.m,
        children: [
          Expanded(
            child: AFTextField(
              key: const Key('jira-search'),
              size: AFTextFieldSize.m,
              hintText: 'Search key, summary, status or assignee',
              onChanged: (q) => bloc.add(JiraFilterChanged(query: q)),
            ),
          ),
          Text(
            '${issues.length} of ${state.snapshot.issues.length}',
            style: theme.textStyle.caption.standard(
              color: theme.textColorScheme.secondary,
            ),
          ),
          if (hasFilter)
            AFGhostTextButton.primary(
              text: 'Clear filters',
              onTap: () => bloc.add(const JiraFilterCleared()),
            ),
        ],
      ),
      SizedBox(height: theme.spacing.s),
    ];
    if (issues.isEmpty) {
      return ListView(
        children: [
          ...leading,
          Padding(
            padding: EdgeInsets.all(theme.spacing.xxl),
            child: Center(
              child: Text(
                state.snapshot.issues.isEmpty
                    ? (state.isSyncing
                        ? 'Loading issues…'
                        : 'No issues synced yet.')
                    : 'No issues match the current filters.',
                style: theme.textStyle.body.standard(
                  color: theme.textColorScheme.secondary,
                ),
              ),
            ),
          ),
        ],
      );
    }
    return ListView.builder(
      itemCount: leading.length + issues.length,
      itemBuilder: (context, index) {
        if (index < leading.length) {
          return leading[index];
        }
        return _IssueRow(issue: issues[index - leading.length]);
      },
    );
  }
}

class _IssueRow extends StatelessWidget {
  const _IssueRow({required this.issue});

  final JiraIssue issue;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final state = context.watch<JiraBloc>().state;
    final canEdit = state.hasCredentials;
    final browseUrl = state.config?.browseUrl(issue.key);
    final meta = [
      issue.issueTypeName,
      if (issue.priorityName.isNotEmpty) issue.priorityName,
      'updated ${formatJiraRelative(issue.updated)}',
    ].join(' · ');
    return DecoratedBox(
      key: ValueKey('jira-issue-${issue.key}'),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: theme.borderColorScheme.primary),
        ),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: theme.spacing.s),
        child: Row(
          spacing: theme.spacing.m,
          children: [
            SizedBox(
              width: 96,
              child: Text(
                issue.key,
                style: theme.textStyle.body.enhanced(
                  color: theme.textColorScheme.action,
                ),
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    issue.summary,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textStyle.body.standard(
                      color: theme.textColorScheme.primary,
                    ),
                  ),
                  Text(
                    meta,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textStyle.caption.standard(
                      color: theme.textColorScheme.tertiary,
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: 140,
              child: Text(
                issue.assigneeLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textStyle.caption.standard(
                  color: theme.textColorScheme.secondary,
                ),
              ),
            ),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 130),
              child: JiraStatusBadge(
                label: issue.statusName,
                category: issue.statusCategory,
              ),
            ),
            JiraIconButton(
              key: ValueKey('jira-transition-${issue.key}'),
              tooltip: issue.isDone ? 'Change status' : 'Close / change status',
              disabled: !canEdit,
              onTap: () => _openTransition(context, issue),
              icon: const FlowySvg(FlowySvgs.check_s),
            ),
            JiraIconButton(
              key: ValueKey('jira-edit-${issue.key}'),
              tooltip: 'Edit',
              disabled: !canEdit,
              onTap: () => _openIssueEditor(context, issue),
              icon: const FlowySvg(FlowySvgs.edit_s),
            ),
            if (browseUrl != null)
              JiraIconButton(
                tooltip: 'Open in Jira',
                onTap: () => afLaunchUrlString(browseUrl),
                icon: const FlowySvg(FlowySvgs.open_in_browser_s),
              ),
          ],
        ),
      ),
    );
  }
}
