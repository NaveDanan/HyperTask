import 'package:appflowy/core/helpers/url_launcher.dart';
import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/jira_repository.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';
import 'package:appflowy/features/jira/presentation/widgets/jira_widgets.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:flutter/material.dart';

/// Lets the user move an issue through its workflow. Transitions are loaded
/// live for this issue; the one leading to a done status is preselected.
Future<JiraIssue?> showJiraTransitionDialog(
  BuildContext context, {
  required JiraRepository repository,
  required JiraIssue issue,
  String? browseUrl,
}) {
  return showDialog<JiraIssue>(
    context: context,
    builder: (_) => JiraTransitionDialog(
      repository: repository,
      issue: issue,
      browseUrl: browseUrl,
    ),
  );
}

class JiraTransitionDialog extends StatefulWidget {
  const JiraTransitionDialog({
    super.key,
    required this.repository,
    required this.issue,
    this.browseUrl,
  });

  final JiraRepository repository;
  final JiraIssue issue;
  final String? browseUrl;

  @override
  State<JiraTransitionDialog> createState() => _JiraTransitionDialogState();
}

class _JiraTransitionDialogState extends State<JiraTransitionDialog> {
  List<JiraTransition>? transitions;
  JiraTransition? selected;
  JiraFieldOption? resolution;
  final TextEditingController comment = TextEditingController();
  bool loading = true;
  bool applying = false;
  JiraException? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    comment.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final list = await widget.repository.getTransitions(widget.issue.key);
      // Done transitions first, keep workflow order otherwise.
      final sorted = [
        ...list.where((t) => t.closesIssue),
        ...list.where((t) => !t.closesIssue),
      ];
      if (!mounted) return;
      setState(() {
        transitions = sorted;
        _select(pickCloseTransition(sorted) ?? sorted.firstOrNull);
      });
    } on JiraException catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _select(JiraTransition? transition) {
    selected = transition;
    final options = transition?.resolutionField?.allowedValues ?? const [];
    resolution = options
            .where(
              (o) =>
                  ['done', 'fixed', 'resolved'].contains(o.name.toLowerCase()),
            )
            .firstOrNull ??
        options.firstOrNull;
  }

  Future<void> _apply() async {
    final transition = selected;
    if (transition == null) return;
    setState(() {
      applying = true;
      error = null;
    });
    try {
      final updated = await widget.repository.transitionIssue(
        widget.issue,
        transition,
        resolutionId: resolution?.id,
        comment: transition.hasScreen ? comment.text : null,
      );
      if (mounted) Navigator.of(context).pop(updated);
    } on JiraException catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final transition = selected;
    final unsupported = transition?.unsupportedRequiredFields ?? const [];
    final resolutionField = transition?.resolutionField;
    final hasDone = transitions?.any((t) => t.closesIssue) ?? false;
    final canApply = !applying && transition != null && unsupported.isEmpty;

    return JiraModal(
      title: '${widget.issue.key}: change status',
      footerTrailing: [
        AFOutlinedTextButton.normal(
          text: 'Cancel',
          onTap: () => Navigator.of(context).pop(),
        ),
        AFFilledTextButton.primary(
          key: const Key('jira-transition-apply'),
          text: applying
              ? 'Applying…'
              : (transition?.closesIssue ?? false)
                  ? 'Close issue'
                  : 'Apply',
          disabled: !canApply,
          onTap: _apply,
        ),
      ],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            spacing: theme.spacing.s,
            children: [
              Text(
                'Current status',
                style: theme.textStyle.caption.standard(
                  color: theme.textColorScheme.secondary,
                ),
              ),
              JiraStatusBadge(
                label: widget.issue.statusName,
                category: widget.issue.statusCategory,
              ),
              const Spacer(),
              if (widget.browseUrl != null)
                AFGhostTextButton.primary(
                  text: 'Open in Jira',
                  size: AFButtonSize.s,
                  onTap: () => afLaunchUrlString(widget.browseUrl!),
                ),
            ],
          ),
          SizedBox(height: theme.spacing.l),
          if (error != null) ...[
            JiraBanner.fromException(
              error!,
              actions: [
                if (transitions == null)
                  AFOutlinedTextButton.normal(
                    text: 'Retry',
                    size: AFButtonSize.s,
                    onTap: _load,
                  ),
              ],
            ),
            SizedBox(height: theme.spacing.l),
          ],
          if (loading)
            const Center(child: CircularProgressIndicator.adaptive())
          else if (transitions != null && transitions!.isEmpty)
            const JiraBanner(
              kind: JiraBannerKind.info,
              message: 'No transitions are available for you on this issue '
                  'in its current status.',
            )
          else if (transitions != null) ...[
            if (!hasDone)
              Padding(
                padding: EdgeInsets.only(bottom: theme.spacing.m),
                child: const JiraBanner(
                  kind: JiraBannerKind.info,
                  message: 'No transition leads directly to a Done status '
                      'from here. Move it forward first.',
                ),
              ),
            JiraFormField(
              label: 'Transition',
              child: Column(
                children: [
                  for (final t in transitions!)
                    JiraChoiceTile(
                      key: ValueKey('jira-transition-${t.id}'),
                      selected: t.id == transition?.id,
                      onTap: () => setState(() => _select(t)),
                      child: Row(
                        spacing: theme.spacing.m,
                        children: [
                          Expanded(
                            child: Text(
                              t.name,
                              style: theme.textStyle.body.standard(
                                color: theme.textColorScheme.primary,
                              ),
                            ),
                          ),
                          JiraStatusBadge(
                            label: t.toStatusName,
                            category: t.toCategory,
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            if (unsupported.isNotEmpty)
              JiraBanner(
                kind: JiraBannerKind.warning,
                message: '"${transition!.name}" requires '
                    '${unsupported.map((f) => f.name).join(', ')}. '
                    'Complete this transition in Jira.',
              ),
            if (resolutionField != null &&
                resolutionField.allowedValues.isNotEmpty)
              JiraFormField(
                label: 'Resolution',
                isRequired: resolutionField.required,
                child: AFDropDownMenu<JiraMenuItem<String>>(
                  items: resolutionField.allowedValues
                      .map((o) => JiraMenuItem(o.id, o.name))
                      .toList(),
                  selectedItems: [
                    if (resolution != null)
                      JiraMenuItem(resolution!.id, resolution!.name),
                  ],
                  isClearEnabled: !resolutionField.required,
                  closeOnSelect: true,
                  onSelected: (item) => setState(() {
                    resolution = item == null
                        ? null
                        : resolutionField.allowedValues
                            .firstWhere((o) => o.id == item.value);
                  }),
                ),
              ),
            if (transition?.hasScreen ?? false)
              JiraFormField(
                label: 'Comment (optional)',
                child: JiraMultilineField(controller: comment, minLines: 2),
              ),
          ],
        ],
      ),
    );
  }
}
