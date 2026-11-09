import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/jira_repository.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';
import 'package:appflowy/features/jira/presentation/widgets/jira_widgets.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:flutter/material.dart';

/// Creates a new issue when [issue] is null, otherwise edits it.
/// Resolves to the saved issue, or null if cancelled.
Future<JiraIssue?> showJiraIssueDialog(
  BuildContext context, {
  required JiraRepository repository,
  JiraIssue? issue,
}) {
  return showDialog<JiraIssue>(
    context: context,
    builder: (_) => JiraIssueDialog(repository: repository, issue: issue),
  );
}

class JiraIssueDialog extends StatefulWidget {
  const JiraIssueDialog({super.key, required this.repository, this.issue});

  final JiraRepository repository;
  final JiraIssue? issue;

  @override
  State<JiraIssueDialog> createState() => _JiraIssueDialogState();
}

class _JiraIssueDialogState extends State<JiraIssueDialog> {
  late JiraIssue? base = widget.issue;
  late final TextEditingController summary;
  late final TextEditingController description;
  late final TextEditingController assignee;

  List<JiraIssueType>? issueTypes;
  JiraIssueType? issueType;
  bool loadingTypes = false;
  bool saving = false;
  JiraException? error;
  JiraConflictException? conflict;
  Map<String, String> fieldErrors = const {};

  bool get isEdit => widget.issue != null;

  @override
  void initState() {
    super.initState();
    summary = TextEditingController(text: base?.summary ?? '');
    description = TextEditingController(text: base?.description ?? '');
    assignee = TextEditingController(text: base?.assignee?.name ?? '');
    if (!isEdit) {
      _loadIssueTypes();
    }
  }

  @override
  void dispose() {
    summary.dispose();
    description.dispose();
    assignee.dispose();
    super.dispose();
  }

  Future<void> _loadIssueTypes() async {
    setState(() {
      loadingTypes = true;
      error = null;
    });
    try {
      // Sub-tasks need a parent issue and cannot be created standalone here.
      final types = (await widget.repository.getCreatableIssueTypes())
          .where((t) => !t.subtask)
          .toList();
      if (!mounted) return;
      setState(() {
        issueTypes = types;
        issueType = types.where((t) => t.name == 'Task').firstOrNull ??
            types.firstOrNull;
      });
    } on JiraException catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => loadingTypes = false);
    }
  }

  /// Only fields the user actually changed are sent on edit.
  JiraIssueDraft _draft() {
    final s = summary.text.trim();
    final d = description.text;
    final a = assignee.text.trim();
    final original = base;
    if (original == null) {
      return JiraIssueDraft(
        summary: s,
        description: d.trim().isEmpty ? null : d,
        issueTypeId: issueType?.id,
        assigneeName: a.isEmpty ? null : a,
      );
    }
    return JiraIssueDraft(
      summary: s != original.summary ? s : null,
      description: d != original.description ? d : null,
      assigneeName: a != (original.assignee?.name ?? '') ? a : null,
    );
  }

  Future<void> _submit({bool overwrite = false}) async {
    if (summary.text.trim().isEmpty) {
      setState(() => fieldErrors = {'summary': 'Summary is required.'});
      return;
    }
    setState(() {
      saving = true;
      error = null;
      fieldErrors = const {};
      if (!overwrite) conflict = null;
    });
    try {
      final draft = _draft();
      final JiraIssue saved;
      if (base == null) {
        saved = await widget.repository.createIssue(draft);
      } else if (draft.toFields().isEmpty) {
        saved = base!;
      } else {
        saved = await widget.repository.updateIssue(
          base!,
          draft,
          overwrite: overwrite,
        );
      }
      if (mounted) Navigator.of(context).pop(saved);
    } on JiraConflictException catch (e) {
      if (mounted) setState(() => conflict = e);
    } on JiraValidationException catch (e) {
      if (mounted) {
        setState(() {
          fieldErrors = e.fieldErrors;
          error = e;
        });
      }
    } on JiraException catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  void _useRemote(JiraIssue remote) {
    setState(() {
      base = remote;
      summary.text = remote.summary;
      description.text = remote.description;
      assignee.text = remote.assignee?.name ?? '';
      conflict = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final canSubmit = !saving && (isEdit || issueType != null);
    return JiraModal(
      title: isEdit ? 'Edit ${widget.issue!.key}' : 'New Jira issue',
      footerTrailing: [
        AFOutlinedTextButton.normal(
          text: 'Cancel',
          onTap: () => Navigator.of(context).pop(),
        ),
        AFFilledTextButton.primary(
          key: const Key('jira-issue-submit'),
          text: saving ? 'Saving…' : (isEdit ? 'Save' : 'Create'),
          disabled: !canSubmit,
          onTap: _submit,
        ),
      ],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (conflict != null) ...[
            JiraBanner(
              kind: JiraBannerKind.warning,
              title: 'Changed in Jira since you opened it',
              message: '${conflict!.message}\n'
                  'Jira now has: "${conflict!.remote.summary}" '
                  '(${conflict!.remote.statusName}, '
                  '${conflict!.remote.assigneeLabel}).',
              actions: [
                AFOutlinedTextButton.normal(
                  text: 'Use Jira version',
                  size: AFButtonSize.s,
                  onTap: () => _useRemote(conflict!.remote),
                ),
                AFOutlinedTextButton.destructive(
                  text: 'Overwrite with mine',
                  size: AFButtonSize.s,
                  onTap: () => _submit(overwrite: true),
                ),
              ],
            ),
            SizedBox(height: theme.spacing.l),
          ],
          if (error != null && error is! JiraValidationException) ...[
            JiraBanner.fromException(error!),
            SizedBox(height: theme.spacing.l),
          ],
          if (!isEdit)
            JiraFormField(
              label: 'Issue type',
              isRequired: true,
              error: fieldErrors['issuetype'],
              helper: loadingTypes ? 'Loading issue types…' : null,
              child: _IssueTypePicker(
                types: issueTypes ?? const [],
                selected: issueType,
                disabled: loadingTypes || issueTypes == null,
                onSelected: (t) => setState(() => issueType = t),
              ),
            ),
          JiraFormField(
            label: 'Summary',
            isRequired: true,
            error: fieldErrors['summary'],
            child: AFTextField(
              key: const Key('jira-issue-summary'),
              controller: summary,
              autoFocus: true,
              maxLength: 255,
            ),
          ),
          JiraFormField(
            label: 'Description',
            error: fieldErrors['description'],
            helper: 'Jira wiki markup is supported.',
            child: JiraMultilineField(controller: description),
          ),
          JiraFormField(
            label: 'Assignee username (optional)',
            error: fieldErrors['assignee'],
            helper: isEdit
                ? 'Clear to unassign. Leave unchanged to keep.'
                : 'Leave empty to use the project default.',
            child: AFTextField(controller: assignee),
          ),
          if (error is JiraValidationException &&
              (error as JiraValidationException).fieldErrors.isEmpty)
            JiraBanner.fromException(error!),
        ],
      ),
    );
  }
}

class _IssueTypePicker extends StatelessWidget {
  const _IssueTypePicker({
    required this.types,
    required this.selected,
    required this.onSelected,
    this.disabled = false,
  });

  final List<JiraIssueType> types;
  final JiraIssueType? selected;
  final ValueChanged<JiraIssueType> onSelected;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final items = types.map((t) => JiraMenuItem(t, t.name)).toList();
    return AFDropDownMenu<JiraMenuItem<JiraIssueType>>(
      items: items,
      selectedItems: [
        if (selected != null) JiraMenuItem(selected!, selected!.name),
      ],
      isDisabled: disabled,
      isClearEnabled: false,
      emptyLabel: 'Select an issue type',
      closeOnSelect: true,
      onSelected: (item) {
        if (item != null) onSelected(item.value);
      },
    );
  }
}
