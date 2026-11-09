/// Jira's three fixed status categories. Workflows can define any number of
/// statuses but every status maps to exactly one of these.
enum JiraStatusCategory {
  toDo('new', 'To Do'),
  inProgress('indeterminate', 'In Progress'),
  done('done', 'Done'),
  unknown('undefined', 'No category');

  const JiraStatusCategory(this.key, this.label);

  /// The `statusCategory.key` value returned by Jira.
  final String key;
  final String label;

  static JiraStatusCategory fromKey(String? key) => JiraStatusCategory.values
      .firstWhere((e) => e.key == key, orElse: () => unknown);
}

class JiraUser {
  const JiraUser({
    required this.name,
    required this.displayName,
    this.key = '',
    this.emailAddress = '',
  });

  factory JiraUser.fromJson(Map<String, dynamic> json) {
    return JiraUser(
      // Server/DC identifies users by `name` (username) and `key`.
      name: json['name'] as String? ?? json['accountId'] as String? ?? '',
      key: json['key'] as String? ?? '',
      displayName: json['displayName'] as String? ?? '',
      emailAddress: json['emailAddress'] as String? ?? '',
    );
  }

  final String name;
  final String key;
  final String displayName;
  final String emailAddress;

  Map<String, dynamic> toJson() => {
        'name': name,
        'key': key,
        'displayName': displayName,
        'emailAddress': emailAddress,
      };
}

class JiraIssueType {
  const JiraIssueType({
    required this.id,
    required this.name,
    this.subtask = false,
    this.description = '',
  });

  factory JiraIssueType.fromJson(Map<String, dynamic> json) {
    return JiraIssueType(
      id: '${json['id'] ?? ''}',
      name: json['name'] as String? ?? '',
      subtask: json['subtask'] as bool? ?? false,
      description: json['description'] as String? ?? '',
    );
  }

  final String id;
  final String name;
  final bool subtask;
  final String description;

  @override
  bool operator ==(Object other) =>
      other is JiraIssueType && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);
}

class JiraProject {
  const JiraProject({
    required this.id,
    required this.key,
    required this.name,
    this.issueTypes = const [],
  });

  factory JiraProject.fromJson(Map<String, dynamic> json) {
    return JiraProject(
      id: '${json['id'] ?? ''}',
      key: json['key'] as String? ?? '',
      name: json['name'] as String? ?? '',
      issueTypes: (json['issueTypes'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(JiraIssueType.fromJson)
          .toList(),
    );
  }

  final String id;
  final String key;
  final String name;
  final List<JiraIssueType> issueTypes;
}

/// Allowed value of a field on a transition screen (e.g. a resolution).
class JiraFieldOption {
  const JiraFieldOption({required this.id, required this.name});

  factory JiraFieldOption.fromJson(Map<String, dynamic> json) {
    return JiraFieldOption(
      id: '${json['id'] ?? ''}',
      name: json['name'] as String? ?? json['value'] as String? ?? '',
    );
  }

  final String id;
  final String name;
}

class JiraTransitionField {
  const JiraTransitionField({
    required this.id,
    required this.name,
    required this.required,
    this.allowedValues = const [],
  });

  final String id;
  final String name;
  final bool required;
  final List<JiraFieldOption> allowedValues;
}

class JiraTransition {
  const JiraTransition({
    required this.id,
    required this.name,
    required this.toStatusName,
    required this.toCategory,
    this.fields = const [],
    this.hasScreen = false,
  });

  factory JiraTransition.fromJson(Map<String, dynamic> json) {
    final to = json['to'] as Map<String, dynamic>? ?? const {};
    final category = to['statusCategory'] as Map<String, dynamic>? ?? const {};
    final rawFields = json['fields'] as Map<String, dynamic>? ?? const {};
    return JiraTransition(
      id: '${json['id'] ?? ''}',
      name: json['name'] as String? ?? '',
      toStatusName: to['name'] as String? ?? '',
      toCategory: JiraStatusCategory.fromKey(category['key'] as String?),
      hasScreen: json['hasScreen'] as bool? ?? false,
      fields: rawFields.entries
          .where((e) => e.value is Map<String, dynamic>)
          .map((e) {
        final value = e.value as Map<String, dynamic>;
        return JiraTransitionField(
          id: e.key,
          name: value['name'] as String? ?? e.key,
          required: value['required'] as bool? ?? false,
          allowedValues: (value['allowedValues'] as List? ?? const [])
              .whereType<Map<String, dynamic>>()
              .map(JiraFieldOption.fromJson)
              .toList(),
        );
      }).toList(),
    );
  }

  final String id;
  final String name;
  final String toStatusName;
  final JiraStatusCategory toCategory;

  /// Only populated when requested with `expand=transitions.fields`.
  final List<JiraTransitionField> fields;

  /// Jira only accepts a comment with transitions that have a screen.
  final bool hasScreen;

  bool get closesIssue => toCategory == JiraStatusCategory.done;

  JiraTransitionField? get resolutionField =>
      fields.where((f) => f.id == 'resolution').firstOrNull;

  /// Required fields we cannot fill in from the close dialog.
  List<JiraTransitionField> get unsupportedRequiredFields => fields
      .where((f) => f.required && f.id != 'resolution' && f.id != 'comment')
      .toList();
}

/// Picks the most likely "close" transition among those Jira offers for an
/// issue right now. Never assumes fixed ids: workflows differ per project.
///
/// Preference: transitions into the done category, then names that read like
/// closing ("Close", "Done", "Resolve"), then fewest required fields.
JiraTransition? pickCloseTransition(List<JiraTransition> transitions) {
  final done = transitions.where((t) => t.closesIssue).toList();
  if (done.isEmpty) {
    return null;
  }
  int score(JiraTransition t) {
    final n = '${t.name} ${t.toStatusName}'.toLowerCase();
    var s = 0;
    if (n.contains('close')) s += 4;
    if (n.contains('done')) s += 3;
    if (n.contains('resolve')) s += 2;
    if (n.contains('reject') ||
        n.contains("won't") ||
        n.contains('cancel') ||
        n.contains('duplicate')) {
      s -= 5;
    }
    s -= t.unsupportedRequiredFields.length * 10;
    return s;
  }

  done.sort((a, b) => score(b).compareTo(score(a)));
  return done.first;
}

class JiraIssue {
  const JiraIssue({
    required this.id,
    required this.key,
    required this.summary,
    required this.statusName,
    required this.statusCategory,
    required this.issueTypeName,
    required this.updated,
    this.description = '',
    this.issueTypeId = '',
    this.priorityName = '',
    this.assignee,
    this.reporter,
    this.created,
    this.resolutionName = '',
    this.dueDate,
  });

  factory JiraIssue.fromJson(Map<String, dynamic> json) {
    final fields = json['fields'] as Map<String, dynamic>? ?? const {};
    final status = fields['status'] as Map<String, dynamic>? ?? const {};
    final category =
        status['statusCategory'] as Map<String, dynamic>? ?? const {};
    final type = fields['issuetype'] as Map<String, dynamic>? ?? const {};
    final priority = fields['priority'] as Map<String, dynamic>?;
    final assignee = fields['assignee'] as Map<String, dynamic>?;
    final reporter = fields['reporter'] as Map<String, dynamic>?;
    final resolution = fields['resolution'] as Map<String, dynamic>?;
    return JiraIssue(
      id: '${json['id'] ?? ''}',
      key: json['key'] as String? ?? '',
      summary: fields['summary'] as String? ?? '',
      description: fields['description'] as String? ?? '',
      statusName: status['name'] as String? ?? '',
      statusCategory: JiraStatusCategory.fromKey(category['key'] as String?),
      issueTypeName: type['name'] as String? ?? '',
      issueTypeId: '${type['id'] ?? ''}',
      priorityName: priority?['name'] as String? ?? '',
      assignee: assignee == null ? null : JiraUser.fromJson(assignee),
      reporter: reporter == null ? null : JiraUser.fromJson(reporter),
      created: parseJiraDate(fields['created'] as String?),
      updated: parseJiraDate(fields['updated'] as String?) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      resolutionName: resolution?['name'] as String? ?? '',
      dueDate: parseJiraDate(fields['duedate'] as String?),
    );
  }

  /// Fields requested from the search API. Keep the payload small.
  static const searchFields = [
    'summary',
    'description',
    'status',
    'issuetype',
    'priority',
    'assignee',
    'reporter',
    'created',
    'updated',
    'resolution',
    'duedate',
  ];

  /// Numeric Jira id: stable for the lifetime of the issue.
  final String id;

  /// Human key (e.g. `DEMO-42`). Stable unless the issue is moved to another
  /// project; the cache and database mapping key by this value.
  final String key;
  final String summary;
  final String description;
  final String statusName;
  final JiraStatusCategory statusCategory;
  final String issueTypeName;
  final String issueTypeId;
  final String priorityName;
  final JiraUser? assignee;
  final JiraUser? reporter;
  final DateTime? created;

  /// Server-side last update. Used for optimistic concurrency.
  final DateTime updated;
  final String resolutionName;
  final DateTime? dueDate;

  bool get isDone => statusCategory == JiraStatusCategory.done;

  String get assigneeLabel => assignee?.displayName.isNotEmpty == true
      ? assignee!.displayName
      : (assignee?.name ?? 'Unassigned');

  /// Serializes to the same shape the REST API returns so the cache can be
  /// parsed with [JiraIssue.fromJson].
  Map<String, dynamic> toJson() => {
        'id': id,
        'key': key,
        'fields': {
          'summary': summary,
          'description': description,
          'status': {
            'name': statusName,
            'statusCategory': {'key': statusCategory.key},
          },
          'issuetype': {'id': issueTypeId, 'name': issueTypeName},
          if (priorityName.isNotEmpty) 'priority': {'name': priorityName},
          if (assignee != null) 'assignee': assignee!.toJson(),
          if (reporter != null) 'reporter': reporter!.toJson(),
          if (created != null) 'created': created!.toUtc().toIso8601String(),
          'updated': updated.toUtc().toIso8601String(),
          if (resolutionName.isNotEmpty) 'resolution': {'name': resolutionName},
          if (dueDate != null)
            'duedate': dueDate!.toIso8601String().substring(0, 10),
        },
      };
}

/// Parses Jira timestamps (`2024-05-01T10:20:30.000+0300`), ISO-8601 and
/// plain dates (`2024-05-01`).
DateTime? parseJiraDate(String? value) {
  if (value == null || value.isEmpty) {
    return null;
  }
  // Jira emits `+0300`; Dart's parser needs `+03:00`.
  final fixed = value.replaceFirstMapped(
    RegExp(r'([+-]\d{2})(\d{2})$'),
    (m) => '${m[1]}:${m[2]}',
  );
  return DateTime.tryParse(fixed);
}

class JiraSearchPage {
  const JiraSearchPage({
    required this.issues,
    required this.startAt,
    required this.maxResults,
    required this.total,
  });

  final List<JiraIssue> issues;
  final int startAt;
  final int maxResults;
  final int total;

  bool get isLast => issues.isEmpty || startAt + issues.length >= total;
}

/// Input for create and edit. Only non-null values are sent.
class JiraIssueDraft {
  const JiraIssueDraft({
    this.summary,
    this.description,
    this.issueTypeId,
    this.assigneeName,
  });

  final String? summary;
  final String? description;
  final String? issueTypeId;

  /// Server/DC username. An empty string unassigns.
  final String? assigneeName;

  Map<String, dynamic> toFields({String? projectKey}) => {
        if (projectKey != null) 'project': {'key': projectKey},
        if (issueTypeId != null) 'issuetype': {'id': issueTypeId},
        if (summary != null) 'summary': summary,
        if (description != null) 'description': description,
        if (assigneeName != null)
          'assignee': assigneeName!.isEmpty ? null : {'name': assigneeName},
      };
}
