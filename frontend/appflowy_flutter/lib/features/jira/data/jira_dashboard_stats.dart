import 'package:appflowy/features/jira/data/models/jira_issue.dart';

class JiraAssigneeProgress {
  const JiraAssigneeProgress({
    required this.name,
    required this.displayName,
    required this.byCategory,
  });

  /// Username, or empty for unassigned.
  final String name;
  final String displayName;
  final Map<JiraStatusCategory, int> byCategory;

  int get total => byCategory.values.fold(0, (a, b) => a + b);
  int get done => byCategory[JiraStatusCategory.done] ?? 0;
  int get inProgress => byCategory[JiraStatusCategory.inProgress] ?? 0;
  double get progress => total == 0 ? 0 : done / total;
}

/// Aggregates computed from the actual status categories Jira reports.
class JiraDashboardStats {
  const JiraDashboardStats({
    required this.total,
    required this.byCategory,
    required this.byStatus,
    required this.byAssignee,
  });

  factory JiraDashboardStats.from(Iterable<JiraIssue> issues) {
    final byCategory = {for (final c in JiraStatusCategory.values) c: 0};
    final byStatus = <String, (JiraStatusCategory, int)>{};
    final assignees = <String, (String, Map<JiraStatusCategory, int>)>{};
    var total = 0;
    for (final issue in issues) {
      total++;
      byCategory[issue.statusCategory] = byCategory[issue.statusCategory]! + 1;
      final status = byStatus[issue.statusName];
      byStatus[issue.statusName] =
          (issue.statusCategory, (status?.$2 ?? 0) + 1);
      final key = issue.assignee?.name ?? '';
      final entry = assignees.putIfAbsent(
        key,
        () => (issue.assignee == null ? 'Unassigned' : issue.assigneeLabel, {}),
      );
      entry.$2[issue.statusCategory] =
          (entry.$2[issue.statusCategory] ?? 0) + 1;
    }
    final assigneeList = assignees.entries
        .map(
          (e) => JiraAssigneeProgress(
            name: e.key,
            displayName: e.value.$1,
            byCategory: e.value.$2,
          ),
        )
        .toList()
      ..sort((a, b) {
        final byOpen = (b.total - b.done).compareTo(a.total - a.done);
        return byOpen != 0 ? byOpen : a.displayName.compareTo(b.displayName);
      });
    return JiraDashboardStats(
      total: total,
      byCategory: byCategory,
      byStatus: byStatus,
      byAssignee: assigneeList,
    );
  }

  final int total;
  final Map<JiraStatusCategory, int> byCategory;

  /// Status name -> (category, count), as named in the project's workflow.
  final Map<String, (JiraStatusCategory, int)> byStatus;
  final List<JiraAssigneeProgress> byAssignee;

  int count(JiraStatusCategory category) => byCategory[category] ?? 0;

  int get open => total - count(JiraStatusCategory.done);

  /// Share of issues in the done category.
  double get progress =>
      total == 0 ? 0 : count(JiraStatusCategory.done) / total;
}
