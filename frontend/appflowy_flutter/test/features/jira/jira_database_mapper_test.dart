import 'package:appflowy/features/jira/jira.dart';
import 'package:flutter_test/flutter_test.dart';

import 'jira_test_utils.dart';

class FakeGateway implements JiraDatabaseGateway {
  FakeGateway(this.fields);

  final List<JiraDbField> fields;
  final Map<String, Map<String, String>> rows = {};
  int writes = 0;
  int fieldCreates = 0;
  var _id = 0;

  @override
  Future<JiraDbField> createTextField(String viewId, String name) async {
    fieldCreates++;
    final f = JiraDbField(id: 'f${_id++}', name: name, isText: true);
    fields.add(f);
    return f;
  }

  @override
  Future<String> createRow(String viewId, Map<String, String> cells) async {
    writes++;
    final id = 'r${_id++}';
    rows[id] = Map.of(cells);
    return id;
  }

  @override
  Future<List<JiraDbField>> getFields(String viewId) async => List.of(fields);

  @override
  Future<List<String>> getRowIds(String viewId) async => rows.keys.toList();

  @override
  Future<String> getText(String viewId, String rowId, String fieldId) async =>
      rows[rowId]?[fieldId] ?? '';

  @override
  Future<void> updateText(
    String viewId,
    String rowId,
    String fieldId,
    String text,
  ) async {
    writes++;
    rows[rowId]![fieldId] = text;
  }

  String fieldId(String name) => fields.firstWhere((f) => f.name == name).id;
}

void main() {
  final issues = [
    JiraIssue.fromJson(issueJson('DEMO-1', assignee: 'a')),
    JiraIssue.fromJson(issueJson('DEMO-2', category: 'done', status: 'Done')),
  ];

  group('JiraDatabaseMapper', () {
    test('creates columns and rows once; re-run is a no-op', () async {
      final gateway = FakeGateway([
        const JiraDbField(
          id: 'title',
          name: 'Name',
          isText: true,
          isPrimary: true,
        ),
        const JiraDbField(id: 'notes', name: 'My notes', isText: true),
      ]);
      final mapper = JiraDatabaseMapper(gateway: gateway);

      final first = await mapper.sync(
        viewId: 'v',
        config: testConfig,
        issues: issues,
      );
      expect(first.created, 2);
      expect(first.createdFields, contains(JiraDatabaseMapper.keyColumn));
      final row = gateway.rows.values.first;
      expect(row['title'], 'Summary of DEMO-1');
      expect(
        row[gateway.fieldId('Jira Link')],
        'https://jira.example.com/browse/DEMO-1',
      );
      expect(row.containsKey('notes'), isFalse);

      final writesBefore = gateway.writes;
      final second = await mapper.sync(
        viewId: 'v',
        config: testConfig,
        issues: issues,
      );
      expect(second.created, 0);
      expect(second.unchanged, 2);
      expect(gateway.writes, writesBefore);
      expect(gateway.fieldCreates, first.createdFields.length);
    });

    test('updates only changed cells and keeps user columns', () async {
      final gateway = FakeGateway([
        const JiraDbField(
          id: 'title',
          name: 'Name',
          isText: true,
          isPrimary: true,
        ),
        const JiraDbField(id: 'notes', name: 'My notes', isText: true),
      ]);
      final mapper = JiraDatabaseMapper(gateway: gateway);
      await mapper.sync(viewId: 'v', config: testConfig, issues: issues);
      final rowId = gateway.rows.keys.first;
      gateway.rows[rowId]!['notes'] = 'keep me';

      final changed = JiraIssue.fromJson(
        issueJson(
          'DEMO-1',
          assignee: 'a',
          status: 'In Progress',
          category: 'indeterminate',
          updated: '2024-06-01T10:00:00.000+0000',
        ),
      );
      final writesBefore = gateway.writes;
      final report = await mapper.sync(
        viewId: 'v',
        config: testConfig,
        issues: [changed, issues[1]],
      );
      expect(report.updated, 1);
      expect(report.unchanged, 1);
      // Status, status category and updated stamp changed.
      expect(gateway.writes - writesBefore, 3);
      expect(gateway.rows[rowId]!['notes'], 'keep me');
      expect(
        gateway.rows[rowId]![gateway.fieldId('Jira Status')],
        'In Progress',
      );
    });

    test('skips non-text fields, reports duplicates and stale rows', () async {
      final gateway = FakeGateway([
        const JiraDbField(
          id: 'title',
          name: 'Name',
          isText: true,
          isPrimary: true,
        ),
        const JiraDbField(id: 'st', name: 'Jira Status', isText: false),
      ]);
      final mapper = JiraDatabaseMapper(gateway: gateway);
      await mapper.sync(viewId: 'v', config: testConfig, issues: issues);
      final keyField = gateway.fieldId(JiraDatabaseMapper.keyColumn);
      gateway.rows['dup'] = {keyField: 'DEMO-1'};
      gateway.rows['old'] = {keyField: 'DEMO-0'};

      final report = await mapper.sync(
        viewId: 'v',
        config: testConfig,
        issues: issues,
      );
      expect(report.skippedFields, ['Jira Status']);
      expect(report.duplicateKeys, ['DEMO-1']);
      expect(report.staleKeys, ['DEMO-0']);
      expect(gateway.rows.containsKey('old'), isTrue);
      expect(gateway.rows.values.any((r) => r.containsKey('st')), isFalse);
    });

    test('requires a target view', () async {
      final mapper = JiraDatabaseMapper(gateway: FakeGateway([]));
      await expectLater(
        mapper.sync(viewId: '', config: testConfig, issues: issues),
        throwsA(isA<JiraNotConfiguredException>()),
      );
    });
  });

  group('JiraDashboardStats', () {
    test('counts by actual status category, status and assignee', () {
      final stats = JiraDashboardStats.from([
        JiraIssue.fromJson(issueJson('DEMO-1', assignee: 'a')),
        JiraIssue.fromJson(
          issueJson(
            'DEMO-2',
            assignee: 'a',
            status: 'Closed',
            category: 'done',
          ),
        ),
        JiraIssue.fromJson(
          issueJson(
            'DEMO-3',
            assignee: 'b',
            status: 'In Review',
            category: 'indeterminate',
          ),
        ),
        JiraIssue.fromJson(
          issueJson('DEMO-4', status: 'Resolved', category: 'done'),
        ),
      ]);
      expect(stats.total, 4);
      expect(stats.count(JiraStatusCategory.toDo), 1);
      expect(stats.count(JiraStatusCategory.inProgress), 1);
      expect(stats.count(JiraStatusCategory.done), 2);
      expect(stats.progress, 0.5);
      expect(stats.open, 2);
      expect(stats.byStatus['Closed'], (JiraStatusCategory.done, 1));
      final a = stats.byAssignee.firstWhere((x) => x.name == 'a');
      expect((a.total, a.done, a.progress), (2, 1, 0.5));
      final unassigned = stats.byAssignee.firstWhere((x) => x.name == '');
      expect(unassigned.displayName, 'Unassigned');
      expect(unassigned.progress, 1);
    });

    test('empty set has zero progress', () {
      final stats = JiraDashboardStats.from(const []);
      expect(stats.total, 0);
      expect(stats.progress, 0);
    });
  });
}
