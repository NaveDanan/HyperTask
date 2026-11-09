import 'dart:convert';
import 'dart:typed_data';

import 'package:appflowy_backend/protobuf/flowy-document/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-folder/protobuf.dart';
import 'package:flowy_infra/uuid.dart';

/// Converts a stored template snapshot into the payloads the backend accepts.
/// Snapshots are the JSON the site serves for a published page:
/// `{ "data": { "kind": ..., "document" | "database": ... } }`.
///
/// Documents are carried over block for block. Every remote asset URL is
/// replaced with its bundled copy (see [localUrls]), so the import never
/// reaches the network.
///
/// Databases are rebuilt as typed AppFlowy databases. The snapshot's raw
/// collab state holds the fields with their type options, the views with their
/// layouts, filters, sorts and field settings, and the rows with their typed
/// cells. Those become a `DatabaseData` JSON, which the backend's folder
/// create-view API accepts as initial data. Every id is replaced with a fresh
/// one so the same template can be imported more than once.

/// Remote asset hosts. A snapshot must not reference these after localization.
final _remoteAssetPattern = RegExp(
  r'^https://(beta\.appflowy\.cloud/api/file_storage/|images\.unsplash\.com/)',
);

/// `CustomImageType.local` and `FileUrlType.local`.
const _localImageType = 0;
const _localFileUrlType = 0;

/// Field type ids known to this build of the backend (`FieldType`, 0 to 14).
const _maxKnownFieldType = 14;
const _fieldTypeRelation = 10;

/// Row height the backend uses when a row has none.
const _defaultRowHeight = 60;

/// Row documents live under `UUIDv5(rowId, "document_id")`, the derivation
/// `collab-database` uses in `database_row_document_id_from_row_id`.
String rowDocumentIdForRow(String rowId) => uuidV5(rowId, 'document_id');

/// RFC 4122 version 5 (SHA-1, name-based) UUID, the same value the Rust
/// `Uuid::new_v5` produces. Only used for the row document ids above.
String uuidV5(String namespace, String name) {
  final namespaceBytes = <int>[
    for (var i = 0; i < 32; i += 2)
      int.parse(namespace.replaceAll('-', '').substring(i, i + 2), radix: 16),
  ];
  final digest = _sha1([...namespaceBytes, ...utf8.encode(name)]);
  final bytes = digest.sublist(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = [
    for (final byte in bytes) byte.toRadixString(16).padLeft(2, '0'),
  ].join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// SHA-1 (FIPS 180-4). Written out so the store needs no extra dependency.
Uint8List _sha1(List<int> message) {
  final h = <int>[
    0x67452301,
    0xEFCDAB89,
    0x98BADCFE,
    0x10325476,
    0xC3D2E1F0,
  ];
  final padded = <int>[...message, 0x80];
  while (padded.length % 64 != 56) {
    padded.add(0);
  }
  final bitLength = message.length * 8;
  for (var shift = 56; shift >= 0; shift -= 8) {
    padded.add((bitLength >> shift) & 0xff);
  }

  for (var chunk = 0; chunk < padded.length; chunk += 64) {
    final w = List<int>.filled(80, 0);
    for (var i = 0; i < 16; i++) {
      final at = chunk + i * 4;
      w[i] = (padded[at] << 24) |
          (padded[at + 1] << 16) |
          (padded[at + 2] << 8) |
          padded[at + 3];
    }
    for (var i = 16; i < 80; i++) {
      w[i] = _rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    var a = h[0];
    var b = h[1];
    var c = h[2];
    var d = h[3];
    var e = h[4];
    for (var i = 0; i < 80; i++) {
      final int f;
      final int k;
      if (i < 20) {
        f = (b & c) | ((~b) & d);
        k = 0x5A827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }
      final temp =
          (_rotl32(a, 5) + (f & 0xFFFFFFFF) + e + k + w[i]) & 0xFFFFFFFF;
      e = d;
      d = c;
      c = _rotl32(b, 30);
      b = a;
      a = temp;
    }
    h[0] = (h[0] + a) & 0xFFFFFFFF;
    h[1] = (h[1] + b) & 0xFFFFFFFF;
    h[2] = (h[2] + c) & 0xFFFFFFFF;
    h[3] = (h[3] + d) & 0xFFFFFFFF;
    h[4] = (h[4] + e) & 0xFFFFFFFF;
  }

  final digest = Uint8List(20);
  for (var i = 0; i < 5; i++) {
    digest[i * 4] = (h[i] >> 24) & 0xff;
    digest[i * 4 + 1] = (h[i] >> 16) & 0xff;
    digest[i * 4 + 2] = (h[i] >> 8) & 0xff;
    digest[i * 4 + 3] = h[i] & 0xff;
  }
  return digest;
}

int _rotl32(int value, int bits) {
  return ((value << bits) | (value >> (32 - bits))) & 0xFFFFFFFF;
}

/// Builds the `DocumentDataPB` that `ImportItemPayloadPB.data` expects for a
/// document snapshot. Remote URLs found in [localUrls] are replaced.
DocumentDataPB documentDataPbFromSnapshot(
  Map<String, dynamic> payload, {
  Map<String, String> localUrls = const {},
}) {
  final data = _snapshotData(payload);
  final raw = _asMap(_asMap(_asMap(data['document'])['raw'])['data']);
  return _documentDataPbFromRaw(raw, localUrls: localUrls);
}

/// Everything the backend needs to recreate one database.
class LocalTemplateDatabaseImport {
  const LocalTemplateDatabaseImport({
    required this.layout,
    required this.initialData,
    required this.rowDocuments,
    required this.fidelity,
  });

  /// Layout of the first view. The folder page is created with it.
  final ViewLayoutPB layout;

  /// UTF-8 `DatabaseData` JSON for `CreateViewPayloadPB.initialData`.
  final Uint8List initialData;

  /// Page content of rows, created after the database itself.
  final List<LocalTemplateRowDocument> rowDocuments;

  final LocalTemplateDatabaseFidelity fidelity;
}

class LocalTemplateRowDocument {
  const LocalTemplateRowDocument({
    required this.rowId,
    required this.documentId,
    required this.document,
  });

  /// The row in the imported database, under its new id.
  final String rowId;

  /// `rowDocumentIdForRow(rowId)`, the id the backend looks the page up by.
  final String documentId;
  final DocumentDataPB document;
}

/// What survived the conversion, counted from the snapshot. Reported in tests
/// and in the store's inventory so partial imports are never presented as
/// complete.
class LocalTemplateDatabaseFidelity {
  const LocalTemplateDatabaseFidelity({
    required this.fieldCount,
    required this.viewCount,
    required this.hiddenViewCount,
    required this.rowCount,
    required this.rowDocumentCount,
    required this.unsupportedFieldCount,
    required this.relationFieldCount,
    required this.unresolvedRelationCellCount,
    required this.droppedCommentCount,
  });

  final int fieldCount;

  /// Views imported: the ones the published page lists.
  final int viewCount;

  /// Views in the snapshot's raw state that the page does not list. They are
  /// internal and are not imported.
  final int hiddenViewCount;

  final int rowCount;

  /// Rows whose page content was recreated.
  final int rowDocumentCount;

  /// Fields of a type this build does not know (for example rollup or formula).
  /// Their type and options are kept, but the app may not render them.
  final int unsupportedFieldCount;

  /// Relation fields. Their targets are other databases, which are not part of
  /// the template, so the references stay dangling.
  final int relationFieldCount;

  /// Relation cells whose target row is not in this database.
  final int unresolvedRelationCellCount;

  /// Row comments. The snapshot carries them, but the import does not restore
  /// them.
  final int droppedCommentCount;
}

/// Builds the typed database import for a database snapshot. Remote URLs found
/// in [localUrls] are replaced in row documents too.
LocalTemplateDatabaseImport databaseImportFromSnapshot(
  Map<String, dynamic> payload, {
  Map<String, String> localUrls = const {},
}) {
  final data = _snapshotData(payload);
  final database = _asMap(data['database']);
  final raw = _asMap(database['raw']);
  final rawDatabase = _asMap(raw['database']);
  final rawFields = _asMap(rawDatabase['fields']);
  final rawViews = _asMap(rawDatabase['views']);
  final rawRows = _asMap(raw['rows']);
  final rawRowDocuments = _asMap(raw['row_documents']);
  final summaryViews = _asList(database['views']).map(_asMap).toList();

  if (rawFields.isEmpty) {
    throw const FormatException('Database snapshot has no fields');
  }
  final sourceDatabaseId = _asString(
    rawDatabase['id'],
    fallback: _asString(database['databaseId']),
  );

  // Views in the snapshot's order, limited to the views the page lists. The
  // raw state can hold views the site does not show (for example an unnamed
  // view used internally), and those are not imported. The active view comes
  // first because the backend displays the first view of the database.
  final viewOrder = <String>[
    for (final view in summaryViews)
      if (rawViews.containsKey(_asString(view['viewId'])))
        _asString(view['viewId']),
  ];
  if (viewOrder.isEmpty) {
    viewOrder.addAll(rawViews.keys);
  }
  if (viewOrder.isEmpty) {
    throw const FormatException('Database snapshot has no views');
  }
  final activeViewId = _asString(database['activeViewId']);
  if (viewOrder.remove(activeViewId)) {
    viewOrder.insert(0, activeViewId);
  }
  final hiddenViewCount = rawViews.length - viewOrder.length;

  // Fresh ids for everything the backend keys globally. Field ids are kept
  // because they are only unique inside their database.
  final databaseId = uuid();
  final viewIds = {for (final id in viewOrder) id: uuid()};
  final rowIds = {for (final id in rawRows.keys) id: uuid()};

  var unsupportedFieldCount = 0;
  var relationFieldCount = 0;
  final fields = <Map<String, dynamic>>[];
  for (final field in rawFields.values.map(_asMap)) {
    final fieldType = _asInt(field['ty']) ?? _asInt(field['field_type']) ?? 0;
    if (fieldType > _maxKnownFieldType) {
      unsupportedFieldCount += 1;
    }
    if (fieldType == _fieldTypeRelation) {
      relationFieldCount += 1;
    }
    fields.add({
      'id': _asString(field['id']),
      'name': _asString(field['name']),
      'field_type': fieldType,
      'icon': _asString(field['icon']),
      'type_options': _remapDatabaseIds(
        _asMap(field['type_option']),
        from: sourceDatabaseId,
        to: databaseId,
      ),
      'is_primary': field['is_primary'] == true,
    });
  }

  var unresolvedRelationCellCount = 0;
  var droppedCommentCount = 0;
  final rows = <Map<String, dynamic>>[];
  for (final entry in rawRows.entries) {
    final row = _asMap(entry.value);
    final rowData = _asMap(row['data']);
    if (_asMap(row['comment']).isNotEmpty) {
      droppedCommentCount += 1;
    }
    final cells = <String, dynamic>{};
    for (final cellEntry in _asMap(rowData['cells']).entries) {
      final cell = _asMap(cellEntry.value);
      if (_asInt(cell['field_type']) == _fieldTypeRelation) {
        final targets = _asStringList(cell['data']);
        unresolvedRelationCellCount +=
            targets.where((id) => !rowIds.containsKey(id)).length;
        cells[cellEntry.key] = {
          ...cell,
          'data': [for (final id in targets) rowIds[id] ?? id],
        };
      } else {
        cells[cellEntry.key] = cell;
      }
    }
    rows.add({
      'id': rowIds[entry.key],
      'database_id': databaseId,
      'cells': cells,
      'height': _asInt(rowData['height']) ?? _defaultRowHeight,
      'visibility': rowData['visibility'] != false,
      'created_at': _asInt(rowData['created_at']) ?? 0,
      'modified_at': _asInt(rowData['last_modified']) ?? 0,
    });
  }

  final views = <Map<String, dynamic>>[];
  for (final viewId in viewOrder) {
    views.add(
      _viewJson(
        rawView: _asMap(rawViews[viewId]),
        summaryView: _summaryViewFor(summaryViews, viewId),
        viewId: viewIds[viewId]!,
        databaseId: databaseId,
        rowIds: rowIds,
      ),
    );
  }

  final rowDocuments = <LocalTemplateRowDocument>[];
  for (final oldRowId in rawRows.keys) {
    final documentJson = _asMap(
      rawRowDocuments[rowDocumentIdForRow(oldRowId)],
    );
    final rawDocument = _asMap(documentJson['data']);
    if (rawDocument.isEmpty) {
      continue;
    }
    rowDocuments.add(
      LocalTemplateRowDocument(
        rowId: rowIds[oldRowId]!,
        documentId: rowDocumentIdForRow(rowIds[oldRowId]!),
        document: _documentDataPbFromRaw(rawDocument, localUrls: localUrls),
      ),
    );
  }

  final initialData = utf8.encode(
    jsonEncode({
      'database_id': databaseId,
      'views': views,
      'fields': fields,
      'rows': rows,
    }),
  );
  final displayLayout = _asInt(
        _asMap(rawViews[viewOrder.first])['layout'],
      ) ??
      _asInt(_summaryViewFor(summaryViews, viewOrder.first)['layout']) ??
      0;

  return LocalTemplateDatabaseImport(
    layout: _layoutFor(displayLayout),
    initialData: Uint8List.fromList(initialData),
    rowDocuments: rowDocuments,
    fidelity: LocalTemplateDatabaseFidelity(
      fieldCount: fields.length,
      viewCount: views.length,
      hiddenViewCount: hiddenViewCount,
      rowCount: rows.length,
      rowDocumentCount: rowDocuments.length,
      unsupportedFieldCount: unsupportedFieldCount,
      relationFieldCount: relationFieldCount,
      unresolvedRelationCellCount: unresolvedRelationCellCount,
      droppedCommentCount: droppedCommentCount,
    ),
  );
}

/// Every remote asset URL still present in [payload]. After localization this
/// must be empty; the importer checks it before any import.
Set<String> remoteAssetUrlsIn(Object? payload) {
  final found = <String>{};
  void walk(Object? node) {
    if (node is String) {
      if (_remoteAssetPattern.hasMatch(node)) {
        found.add(node);
      }
    } else if (node is Map) {
      node.values.forEach(walk);
    } else if (node is List) {
      node.forEach(walk);
    }
  }

  walk(payload);
  return found;
}

/// Ids of the database views that embedded `grid` and `calendar` blocks in a
/// document point at. Those views are not part of the document snapshot, so
/// the import cannot recreate them.
Set<String> embeddedDatabaseViewIdsIn(Map<String, dynamic> payload) {
  final raw = _asMap(
    _asMap(_asMap(_snapshotData(payload)['document'])['raw'])['data'],
  );
  final ids = <String>{};
  for (final block in _asMap(raw['blocks']).values.map(_asMap)) {
    if (block['ty'] == 'grid' || block['ty'] == 'calendar') {
      final viewId = _asString(_asMap(block['data'])['view_id']);
      if (viewId.isNotEmpty) {
        ids.add(viewId);
      }
    }
  }
  return ids;
}

DocumentDataPB _documentDataPbFromRaw(
  Map<String, dynamic> raw, {
  required Map<String, String> localUrls,
}) {
  final pageId = _asString(raw['page_id']);
  final blocksJson = _asMap(raw['blocks']);
  if (pageId.isEmpty || !blocksJson.containsKey(pageId)) {
    throw const FormatException('Document snapshot has no page block');
  }

  final blocks = <String, BlockPB>{};
  for (final entry in blocksJson.entries) {
    final block = _asMap(entry.value);
    final id = _asString(block['id'], fallback: entry.key);
    final ty = _asString(block['ty']);
    blocks[id] = BlockPB.create()
      ..id = id
      ..ty = ty
      ..data = jsonEncode(
        _localizeBlockData(ty, _asMap(block['data']), localUrls),
      )
      ..childrenId = _asString(block['children'])
      ..parentId = _asString(block['parent'])
      ..externalId = _asString(block['external_id'])
      ..externalType = _asString(block['external_type']);
  }

  final rawMeta = _asMap(raw['meta']);
  final childrenMap = <String, ChildrenPB>{};
  for (final entry in _asMap(rawMeta['children_map']).entries) {
    childrenMap[entry.key] = ChildrenPB.create()
      ..children.addAll(_asStringList(entry.value));
  }
  final textMap = <String, String>{};
  for (final entry in _asMap(rawMeta['text_map']).entries) {
    final value = entry.value;
    textMap[entry.key] = value is String ? value : jsonEncode(value);
  }

  return DocumentDataPB.create()
    ..pageId = pageId
    ..blocks.addAll(blocks)
    ..meta = (MetaPB.create()
      ..childrenMap.addAll(childrenMap)
      ..textMap.addAll(textMap));
}

/// Replaces remote URLs in a block's data. An image or file block whose URL
/// became a local path is switched to the local source type, so the editor
/// reads the file instead of trying the network.
Map<String, dynamic> _localizeBlockData(
  String ty,
  Map<String, dynamic> data,
  Map<String, String> localUrls,
) {
  if (localUrls.isEmpty) {
    return data;
  }
  final localized = Map<String, dynamic>.from(
    _replaceUrls(data, localUrls) as Map,
  );
  final urlChanged = localized['url'] != data['url'];
  if (urlChanged && ty == 'image') {
    localized['image_type'] = _localImageType;
  }
  if (urlChanged && ty == 'file') {
    localized['url_type'] = _localFileUrlType;
  }
  return localized;
}

Object? _replaceUrls(Object? node, Map<String, String> localUrls) {
  if (node is String) {
    return localUrls[node] ?? node;
  }
  if (node is Map) {
    return node.map(
      (key, value) => MapEntry(key, _replaceUrls(value, localUrls)),
    );
  }
  if (node is List) {
    return [for (final item in node) _replaceUrls(item, localUrls)];
  }
  return node;
}

/// Rewrites a `database_id` inside type options (relation fields) when it
/// names the source database.
Map<String, dynamic> _remapDatabaseIds(
  Map<String, dynamic> typeOptions, {
  required String from,
  required String to,
}) {
  return typeOptions.map((key, value) {
    final option = _asMap(value);
    if (option['database_id'] == from) {
      return MapEntry(key, {...option, 'database_id': to});
    }
    return MapEntry(key, value);
  });
}

Map<String, dynamic> _summaryViewFor(
  List<Map<String, dynamic>> summaryViews,
  String viewId,
) {
  for (final view in summaryViews) {
    if (_asString(view['viewId']) == viewId) {
      return view;
    }
  }
  return const {};
}

Map<String, dynamic> _viewJson({
  required Map<String, dynamic> rawView,
  required Map<String, dynamic> summaryView,
  required String viewId,
  required String databaseId,
  required Map<String, String> rowIds,
}) {
  final rowOrders = <Map<String, dynamic>>[];
  for (final order in _asList(rawView['row_orders']).map(_asMap)) {
    final rowId = rowIds[_asString(order['id'])];
    if (rowId != null) {
      rowOrders.add({
        'id': rowId,
        'height': _asInt(order['height']) ?? _defaultRowHeight,
      });
    }
  }
  return {
    'id': viewId,
    'database_id': databaseId,
    'name': _asString(
      rawView['name'],
      fallback: _asString(summaryView['name'], fallback: 'Grid'),
    ),
    'layout': _asInt(rawView['layout']) ?? _asInt(summaryView['layout']) ?? 0,
    'layout_settings': _asMap(rawView['layout_settings']),
    'filters': _asList(rawView['filters']),
    'group_settings': _asList(rawView['groups']),
    'sorts': _asList(rawView['sorts']),
    'row_orders': rowOrders,
    'field_orders': _asList(rawView['field_orders']),
    'field_settings': _asMap(rawView['field_settings']),
    'created_at': _asInt(rawView['created_at']) ?? 0,
    'modified_at': _asInt(rawView['modified_at']) ?? 0,
    'is_inline': false,
  };
}

ViewLayoutPB _layoutFor(int layout) {
  switch (layout) {
    case 1:
      return ViewLayoutPB.Board;
    case 2:
      return ViewLayoutPB.Calendar;
    default:
      return ViewLayoutPB.Grid;
  }
}

Map<String, dynamic> _snapshotData(Map<String, dynamic> payload) {
  final data = payload['data'];
  return data is Map<String, dynamic> ? data : payload;
}

Map<String, dynamic> _asMap(Object? value) {
  return value is Map<String, dynamic> ? value : const <String, dynamic>{};
}

List<dynamic> _asList(Object? value) {
  return value is List ? value : const <dynamic>[];
}

List<String> _asStringList(Object? value) {
  if (value is String) {
    return value.isEmpty ? const [] : [value];
  }
  return _asList(value).whereType<String>().toList();
}

String _asString(Object? value, {String fallback = ''}) {
  if (value == null) {
    return fallback;
  }
  if (value is String) {
    return value.isEmpty ? fallback : value;
  }
  return value.toString();
}

int? _asInt(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value);
  }
  return null;
}
