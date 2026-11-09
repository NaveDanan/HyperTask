import 'dart:convert';

import 'package:appflowy/plugins/database/application/cell/cell_controller.dart';
import 'package:appflowy/plugins/database/domain/cell_service.dart';
import 'package:appflowy/plugins/database/domain/database_view_service.dart';
import 'package:appflowy/plugins/database/domain/field_service.dart';
import 'package:appflowy_backend/dispatch/dispatch.dart';
import 'package:appflowy_backend/protobuf/flowy-database2/protobuf.dart';

import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';

/// A database field as seen by the mapper.
class JiraDbField {
  const JiraDbField({
    required this.id,
    required this.name,
    required this.isText,
    this.isPrimary = false,
  });

  final String id;
  final String name;

  /// Only rich-text fields are written; other types are never converted.
  final bool isText;
  final bool isPrimary;
}

/// The subset of AppFlowy database operations the mapper needs. Kept small
/// so the mapping rules can be tested without the Rust backend.
abstract class JiraDatabaseGateway {
  Future<List<JiraDbField>> getFields(String viewId);

  Future<JiraDbField> createTextField(String viewId, String name);

  Future<List<String>> getRowIds(String viewId);

  Future<String> getText(String viewId, String rowId, String fieldId);

  /// Appends a row with the given text cells (field id -> text).
  Future<String> createRow(String viewId, Map<String, String> cells);

  Future<void> updateText(
    String viewId,
    String rowId,
    String fieldId,
    String text,
  );
}

class JiraDatabaseSyncReport {
  const JiraDatabaseSyncReport({
    this.created = 0,
    this.updated = 0,
    this.unchanged = 0,
    this.createdFields = const [],
    this.skippedFields = const [],
    this.duplicateKeys = const [],
    this.staleKeys = const [],
  });

  final int created;
  final int updated;
  final int unchanged;
  final List<String> createdFields;

  /// Fields with a mapped name but a non-text type; left untouched.
  final List<String> skippedFields;

  /// Keys found on more than one row. Only the first row is updated.
  final List<String> duplicateKeys;

  /// Rows whose Jira key is not in the current issue set. They are kept.
  final List<String> staleKeys;

  String get summary {
    final parts = [
      '$created created',
      '$updated updated',
      '$unchanged unchanged',
      if (createdFields.isNotEmpty) 'added fields: ${createdFields.join(', ')}',
      if (skippedFields.isNotEmpty)
        'skipped non-text fields: ${skippedFields.join(', ')}',
      if (duplicateKeys.isNotEmpty)
        'duplicate rows for ${duplicateKeys.join(', ')}',
      if (staleKeys.isNotEmpty) '${staleKeys.length} rows no longer in Jira',
    ];
    return parts.join(' · ');
  }
}

/// One-way, idempotent mirror of Jira issues into an existing AppFlowy
/// database view (Jira -> AppFlowy).
///
/// Rules:
/// * Rows are matched by the `Jira Key` text column, never by position.
/// * Missing mapped columns are added as text fields; existing fields are
///   never renamed, retyped or deleted.
/// * A row is only written when Jira's `updated` timestamp differs from the
///   `Jira Updated` cell, so re-running is a no-op and local edits to rows
///   whose issue has not changed in Jira are preserved.
/// * Rows are never deleted. Columns not listed in [columns] are never
///   touched.
class JiraDatabaseMapper {
  JiraDatabaseMapper({required this.gateway});

  final JiraDatabaseGateway gateway;

  static const keyColumn = 'Jira Key';
  static const updatedColumn = 'Jira Updated';

  /// Column name -> value. The primary (title) field receives the summary.
  static Map<String, String> columns(JiraIssue issue, JiraConfig config) => {
        keyColumn: issue.key,
        'Jira Status': issue.statusName,
        'Jira Status Category': issue.statusCategory.label,
        'Jira Type': issue.issueTypeName,
        'Jira Assignee': issue.assignee == null ? '' : issue.assigneeLabel,
        'Jira Priority': issue.priorityName,
        'Jira Link': config.browseUrl(issue.key),
        updatedColumn: issue.updated.toUtc().toIso8601String(),
      };

  Future<JiraDatabaseSyncReport> sync({
    required String viewId,
    required JiraConfig config,
    required List<JiraIssue> issues,
  }) async {
    if (viewId.trim().isEmpty) {
      throw const JiraNotConfiguredException(
        'Set a target database view id in Jira settings.',
      );
    }
    final fields = await gateway.getFields(viewId);
    final byName = <String, JiraDbField>{};
    for (final f in fields) {
      byName.putIfAbsent(f.name, () => f);
    }
    final primary = fields.where((f) => f.isPrimary && f.isText).firstOrNull;

    final createdFields = <String>[];
    final skippedFields = <String>[];
    final fieldIds = <String, String>{};
    final sample = columns(
      JiraIssue(
        id: '',
        key: '',
        summary: '',
        statusName: '',
        statusCategory: JiraStatusCategory.unknown,
        issueTypeName: '',
        updated: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      ),
      config,
    );
    for (final name in sample.keys) {
      final existing = byName[name];
      if (existing == null) {
        final created = await gateway.createTextField(viewId, name);
        fieldIds[name] = created.id;
        createdFields.add(name);
      } else if (existing.isText) {
        fieldIds[name] = existing.id;
      } else {
        skippedFields.add(name);
      }
    }
    final keyFieldId = fieldIds[keyColumn];
    final updatedFieldId = fieldIds[updatedColumn];
    if (keyFieldId == null || updatedFieldId == null) {
      throw JiraValidationException(
        'The "$keyColumn" and "$updatedColumn" columns must be text fields.',
      );
    }

    // Index existing rows by Jira key.
    final rowsByKey = <String, String>{};
    final duplicates = <String>{};
    for (final rowId in await gateway.getRowIds(viewId)) {
      final key = (await gateway.getText(viewId, rowId, keyFieldId)).trim();
      if (key.isEmpty) {
        continue;
      }
      if (rowsByKey.containsKey(key)) {
        duplicates.add(key);
      } else {
        rowsByKey[key] = rowId;
      }
    }

    var created = 0;
    var updated = 0;
    var unchanged = 0;
    for (final issue in issues) {
      final values = columns(issue, config);
      final cells = <String, String>{
        for (final e in values.entries)
          if (fieldIds[e.key] != null) fieldIds[e.key]!: e.value,
        if (primary != null) primary.id: issue.summary,
      };
      final rowId = rowsByKey[issue.key];
      if (rowId == null) {
        await gateway.createRow(viewId, cells);
        created++;
        continue;
      }
      final stamp = await gateway.getText(viewId, rowId, updatedFieldId);
      if (createdFields.isEmpty && stamp == values[updatedColumn]) {
        unchanged++;
        continue;
      }
      for (final cell in cells.entries) {
        if (cell.key == keyFieldId) {
          continue;
        }
        final current = await gateway.getText(viewId, rowId, cell.key);
        if (current != cell.value) {
          await gateway.updateText(viewId, rowId, cell.key, cell.value);
        }
      }
      updated++;
    }

    final issueKeys = issues.map((i) => i.key).toSet();
    return JiraDatabaseSyncReport(
      created: created,
      updated: updated,
      unchanged: unchanged,
      createdFields: createdFields,
      skippedFields: skippedFields,
      duplicateKeys: duplicates.toList()..sort(),
      staleKeys: rowsByKey.keys.where((k) => !issueKeys.contains(k)).toList()
        ..sort(),
    );
  }
}

/// [JiraDatabaseGateway] backed by the existing AppFlowy database services.
class BackendJiraDatabaseGateway implements JiraDatabaseGateway {
  const BackendJiraDatabaseGateway();

  @override
  Future<List<JiraDbField>> getFields(String viewId) async {
    final fields = (await FieldBackendService.getFields(viewId: viewId))
        .fold((f) => f, (e) => throw JiraServerException(e.msg));
    return fields
        .map(
          (f) => JiraDbField(
            id: f.id,
            name: f.name,
            isText: f.fieldType == FieldType.RichText,
            isPrimary: f.isPrimary,
          ),
        )
        .toList();
  }

  @override
  Future<JiraDbField> createTextField(String viewId, String name) async {
    final field = (await FieldBackendService.createField(
      viewId: viewId,
      fieldName: name,
    ))
        .fold((f) => f, (e) => throw JiraServerException(e.msg));
    return JiraDbField(id: field.id, name: field.name, isText: true);
  }

  @override
  Future<List<String>> getRowIds(String viewId) async {
    final database =
        (await DatabaseViewBackendService(viewId: viewId).openDatabase())
            .fold((d) => d, (e) => throw JiraServerException(e.msg));
    return database.rows.map((r) => r.id).toList();
  }

  @override
  Future<String> getText(String viewId, String rowId, String fieldId) async {
    final cell = await CellBackendService.getCell(
      viewId: viewId,
      cellContext: CellContext(fieldId: fieldId, rowId: rowId),
    );
    return cell.fold(
      (c) => c.data.isEmpty ? '' : utf8.decode(c.data, allowMalformed: true),
      (_) => '',
    );
  }

  @override
  Future<String> createRow(String viewId, Map<String, String> cells) async {
    final payload = CreateRowPayloadPB(
      viewId: viewId,
      rowPosition: OrderObjectPositionPB(
        position: OrderObjectPositionTypePB.End,
      ),
    )..data.addAll(cells);
    final row = (await DatabaseEventCreateRow(payload).send())
        .fold((r) => r, (e) => throw JiraServerException(e.msg));
    return row.id;
  }

  @override
  Future<void> updateText(
    String viewId,
    String rowId,
    String fieldId,
    String text,
  ) async {
    (await CellBackendService.updateCell(
      viewId: viewId,
      cellContext: CellContext(fieldId: fieldId, rowId: rowId),
      data: text,
    ))
        .fold((_) => null, (e) => throw JiraServerException(e.msg));
  }
}
