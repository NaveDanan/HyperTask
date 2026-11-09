import 'dart:convert';
import 'dart:io';

import 'package:appflowy/features/local_templates/data/local_template_converter.dart';
import 'package:appflowy_backend/protobuf/flowy-document/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-folder/protobuf.dart';
import 'package:flutter_test/flutter_test.dart';

import 'local_template_test_support.dart';

/// Minimal document envelope with the same shape as the site's snapshot.
Map<String, dynamic> _documentPayload({
  required Map<String, dynamic> blocks,
  required Map<String, dynamic> meta,
  String pageId = 'page',
}) {
  return {
    'data': {
      'kind': 'document',
      'document': {
        'raw': {
          'data': {
            'page_id': pageId,
            'blocks': blocks,
            'meta': meta,
          },
        },
      },
    },
  };
}

/// Map of every remote asset URL in [payload] to a distinct local path.
Map<String, String> _localizeEverything(Map<String, dynamic> payload) {
  final urls = remoteAssetUrlsIn(payload).toList()..sort();
  return {
    for (var i = 0; i < urls.length; i++) urls[i]: '/user/media/$i.bin',
  };
}

Map<String, dynamic> _databaseJson(LocalTemplateDatabaseImport result) {
  return jsonDecode(utf8.decode(result.initialData)) as Map<String, dynamic>;
}

List<Map<String, dynamic>> _maps(Object? value) {
  return (value as List).cast<Map<String, dynamic>>();
}

int _layoutNumber(ViewLayoutPB layout) {
  if (layout == ViewLayoutPB.Board) return 1;
  if (layout == ViewLayoutPB.Calendar) return 2;
  return 0;
}

Map<String, dynamic> _rawDatabase(Map<String, dynamic> payload) {
  final data = payload['data'] as Map<String, dynamic>;
  return (data['database'] as Map<String, dynamic>)['raw']
      as Map<String, dynamic>;
}

void main() {
  group('uuidV5', () {
    test('matches the RFC 4122 name-based vector', () {
      expect(
        uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org'),
        '886313e1-3b8a-5372-9b90-0c9aee199e5d',
      );
    });

    test('derives the row page id the snapshot stores for each row', () {
      final raw = _rawDatabase(readBundledPayload(
          'Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a'));
      final rowIds = (raw['rows'] as Map<String, dynamic>).keys;
      final pageIds = (raw['row_documents'] as Map<String, dynamic>).keys;

      final derived =
          rowIds.map(rowDocumentIdForRow).where(pageIds.contains).toList();

      expect(derived, unorderedEquals(pageIds));
    });
  });

  group('documentDataPbFromSnapshot', () {
    test('maps blocks, children, text deltas, and page id', () {
      final payload = _documentPayload(
        pageId: 'p',
        blocks: {
          'p': {
            'children': 'c0',
            'data': {},
            'external_id': '',
            'external_type': '',
            'id': 'p',
            'parent': '',
            'ty': 'page',
          },
          'b1': {
            'children': 'c1',
            'data': {'checked': true},
            'external_id': 'x',
            'external_type': 'text',
            'id': 'b1',
            'parent': 'p',
            'ty': 'todo_list',
          },
        },
        meta: {
          'children_map': {
            'c0': ['b1'],
            'c1': <String>[],
          },
          'text_map': {
            'x': '[{"insert":"hi"}]',
          },
        },
      );

      final document = documentDataPbFromSnapshot(payload);

      expect(document.pageId, 'p');
      expect(document.blocks.keys, unorderedEquals(['p', 'b1']));
      final block = document.blocks['b1']!;
      expect(block.ty, 'todo_list');
      expect(jsonDecode(block.data), {'checked': true});
      expect(block.childrenId, 'c1');
      expect(block.parentId, 'p');
      expect(block.externalId, 'x');
      expect(block.externalType, 'text');
      expect(document.meta.childrenMap['c0']!.children, ['b1']);
      expect(document.meta.textMap['x'], '[{"insert":"hi"}]');
    });

    test('encodes non-string text deltas as JSON', () {
      final payload = _documentPayload(
        pageId: 'p',
        blocks: {
          'p': {
            'children': 'c0',
            'data': {},
            'id': 'p',
            'parent': '',
            'ty': 'page',
          },
        },
        meta: {
          'children_map': {'c0': <String>[]},
          'text_map': {
            'x': [
              {'insert': 'hi'},
            ],
          },
        },
      );

      final document = documentDataPbFromSnapshot(payload);

      expect(jsonDecode(document.meta.textMap['x']!), [
        {'insert': 'hi'},
      ]);
    });

    test('throws when the page block is missing', () {
      final payload = _documentPayload(
        pageId: 'missing',
        blocks: {
          'other': {'children': 'c0', 'data': {}, 'id': 'other', 'ty': 'page'},
        },
        meta: {'children_map': {}, 'text_map': {}},
      );

      expect(
        () => documentDataPbFromSnapshot(payload),
        throwsA(isA<FormatException>()),
      );
    });

    test('keeps every block of a real snapshot and survives a round trip', () {
      final payload = readBundledPayload('Weekly-To-Do-List');
      final raw = (payload['data'] as Map<String, dynamic>)['document']['raw']
          ['data'] as Map<String, dynamic>;
      final rawBlocks = raw['blocks'] as Map<String, dynamic>;
      final rawText = raw['meta']['text_map'] as Map<String, dynamic>;

      final document = documentDataPbFromSnapshot(payload);
      final decoded = DocumentDataPB.fromBuffer(document.writeToBuffer());

      expect(decoded.pageId, raw['page_id']);
      expect(decoded.blocks, hasLength(rawBlocks.length));
      expect(decoded.meta.textMap, hasLength(rawText.length));
      for (final block in decoded.blocks.values) {
        if (block.childrenId.isNotEmpty) {
          expect(
            decoded.meta.childrenMap.containsKey(block.childrenId),
            isTrue,
            reason: block.id,
          );
        }
      }
    });

    test('replaces remote images, files and covers with local paths', () {
      final payload = readBundledPayload('Business-Overview-One-Pager');
      final localUrls = _localizeEverything(payload);

      final document = documentDataPbFromSnapshot(
        payload,
        localUrls: localUrls,
      );
      final blocks = [
        for (final b in document.blocks.values) jsonDecode(b.data)
      ];

      expect(remoteAssetUrlsIn(blocks), isEmpty);
      final image = document.blocks.values.firstWhere((b) => b.ty == 'image');
      final imageData = jsonDecode(image.data) as Map<String, dynamic>;
      expect(imageData['url'], startsWith('/user/media/'));
      expect(imageData['image_type'], 0, reason: 'local image');
      final page = document.blocks.values.firstWhere((b) => b.ty == 'page');
      expect(
        (jsonDecode(page.data) as Map<String, dynamic>)['cover_selection'],
        startsWith('/user/media/'),
      );
    });

    test('leaves plain web links alone', () {
      final payload = readBundledPayload(
          'Simple-Startup-Company-Home-54f9981f-b467-42ed-91f7-f4baa829fe14');
      final document = documentDataPbFromSnapshot(
        payload,
        localUrls: _localizeEverything(payload),
      );

      final preview = document.blocks.values.firstWhere(
        (b) => b.ty == 'link_preview',
      );
      expect(
        jsonDecode(preview.data),
        {'url': 'https://github.com/AppFlowy-IO/AppFlowy'},
      );
    });
  });

  group('databaseImportFromSnapshot', () {
    test('rebuilds fields with their types and select options', () {
      final payload = readBundledPayload('Bug-Tracker-13a84186');
      final result = databaseImportFromSnapshot(payload);
      final json = _databaseJson(result);

      final fields = _maps(json['fields']);
      expect(fields, hasLength(7));
      final source = fields.firstWhere((f) => f['name'] == 'Source');
      expect(source['field_type'], 3, reason: 'single select stays typed');
      final sourceOptions = (jsonDecode(
        (source['type_options'] as Map)['3']['content'] as String,
      )['options'] as List)
          .cast<Map<String, dynamic>>();
      expect(sourceOptions.map((o) => o['name']), contains('Internal'));

      final primary = fields.singleWhere((f) => f['is_primary'] == true);
      expect(primary['name'], 'Description');
      expect(fields.map((f) => f['field_type']), contains(2));
    });

    test('keeps every select cell pointing at an option of its field', () {
      final payload = readBundledPayload('Bug-Tracker-13a84186');
      final json = _databaseJson(databaseImportFromSnapshot(payload));
      final fields = _maps(json['fields']);
      final rows = _maps(json['rows']);

      for (final field in fields.where((f) => f['field_type'] == 3)) {
        final content =
            (field['type_options'] as Map)['3']['content'] as String;
        final optionIds = (jsonDecode(content)['options'] as List)
            .map((o) => o['id'])
            .toSet();
        for (final row in rows) {
          final cell = (row['cells'] as Map)[field['id']] as Map?;
          final id = cell?['data'];
          if (id is String && id.isNotEmpty) {
            expect(optionIds, contains(id), reason: field['name'] as String);
          }
        }
      }
    });

    test('rebuilds every view with its layout, row order and field settings',
        () {
      final payload = readBundledPayload('Bug-Tracker-13a84186');
      final result = databaseImportFromSnapshot(payload);
      final json = _databaseJson(result);
      final rowIds = _maps(json['rows']).map((r) => r['id']).toSet();
      final fieldIds = _maps(json['fields']).map((f) => f['id']).toSet();

      final views = _maps(json['views']);
      expect(views.map((v) => v['layout']), unorderedEquals([0, 1]));
      for (final view in views) {
        final order = _maps(view['row_orders']);
        expect(order, hasLength(8));
        expect(order.map((o) => o['id']), everyElement(isIn(rowIds)));
        final fieldOrder = _maps(view['field_orders']).map((f) => f['id']);
        expect(fieldOrder, everyElement(isIn(fieldIds)));
        expect(view['database_id'], json['database_id']);
      }
      expect(_layoutNumber(result.layout), views.first['layout']);
    });

    test('keeps calendar layout settings for the calendar view', () {
      final payload = readBundledPayload(
          'Daily-Journal-706323c0-f8bf-49be-b73b-059b10f7ac96');
      final json = _databaseJson(databaseImportFromSnapshot(payload));

      final calendar = _maps(json['views']).firstWhere((v) => v['layout'] == 2);
      final settings = calendar['layout_settings'] as Map<String, dynamic>;
      expect(settings['2']['field_id'], 'JCXYO7');
      expect(
        _maps(json['fields']).any((f) => f['id'] == 'JCXYO7'),
        isTrue,
        reason: 'the calendar date field exists',
      );
    });

    test('gives every database, view and row a fresh id on each import', () {
      final payload = readBundledPayload('Bug-Tracker-13a84186');
      final first = _databaseJson(databaseImportFromSnapshot(payload));
      final second = _databaseJson(databaseImportFromSnapshot(payload));

      expect(first['database_id'], isNot(second['database_id']));
      final firstRows = _maps(first['rows']).map((r) => r['id']).toSet();
      final secondRows = _maps(second['rows']).map((r) => r['id']).toSet();
      expect(firstRows.intersection(secondRows), isEmpty);
      final snapshotRows =
          _rawDatabase(payload)['rows'] as Map<String, dynamic>;
      expect(firstRows.intersection(snapshotRows.keys.toSet()), isEmpty);
      // Field ids stay: they are only unique inside one database.
      expect(
        _maps(first['fields']).map((f) => f['id']),
        _maps(second['fields']).map((f) => f['id']),
      );
    });

    test('counts relation targets that point outside the database', () {
      final payload = readBundledPayload('Opportunities-20e79978');
      final result = databaseImportFromSnapshot(payload);
      final json = _databaseJson(result);

      final relation =
          _maps(json['fields']).firstWhere((f) => f['field_type'] == 10);
      expect(
        (relation['type_options'] as Map)['10']['database_id'],
        '01cdd149-0f42-479d-b8c2-b39cc1c0a2a4',
        reason: 'the target database is not in the template, so it is kept',
      );
      expect(result.fidelity.relationFieldCount, 1);

      var expectedUnresolved = 0;
      for (final row in _rawDatabase(payload)['rows'].values) {
        for (final cell in (row['data']['cells'] as Map).values) {
          if (cell['field_type'] == 10) {
            expectedUnresolved += (cell['data'] as List).length;
          }
        }
      }
      expect(result.fidelity.unresolvedRelationCellCount, expectedUnresolved);
    });

    test('keeps rollup and formula fields as stored and reports them', () {
      final payload = readBundledPayload('project-completion-tracker');
      final result = databaseImportFromSnapshot(payload);
      final json = _databaseJson(result);

      final types = _maps(json['fields']).map((f) => f['field_type']).toList();
      expect(types, contains(16), reason: 'rollup kept');
      expect(types, contains(19), reason: 'formula kept');
      final expected = types.where((t) => t is int && t > 14).length;
      expect(result.fidelity.unsupportedFieldCount, expected);
    });

    test('recreates the page of every row that has one', () {
      final payload = readBundledPayload(
          'Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a');
      final result = databaseImportFromSnapshot(payload);
      final rowIds =
          _maps(_databaseJson(result)['rows']).map((r) => r['id']).toSet();

      expect(result.rowDocuments, hasLength(2));
      for (final page in result.rowDocuments) {
        expect(rowIds, contains(page.rowId));
        expect(page.documentId, rowDocumentIdForRow(page.rowId));
        expect(page.document.blocks, isNotEmpty);
      }
    });

    test('counts row comments that the import does not restore', () {
      final payload = readBundledPayload('Bug-Tracker-13a84186');
      final result = databaseImportFromSnapshot(payload);

      var expected = 0;
      for (final row in _rawDatabase(payload)['rows'].values) {
        if ((row['comment'] as Map).isNotEmpty) expected += 1;
      }
      expect(result.fidelity.droppedCommentCount, expected);
    });

    test('reports the counts a reviewer needs to judge fidelity', () {
      final result = databaseImportFromSnapshot(
        readBundledPayload('Bug-Tracker-13a84186'),
      );

      expect(result.fidelity.fieldCount, 7);
      expect(result.fidelity.rowCount, 8);
      expect(result.fidelity.viewCount, 2);
      expect(result.fidelity.hiddenViewCount, 1,
          reason: 'unnamed internal view');
      expect(result.fidelity.rowDocumentCount, 0);
    });

    test('throws for a database snapshot without fields', () {
      final payload = {
        'data': {
          'kind': 'database',
          'database': {
            'views': <Object>[],
            'raw': {
              'database': {'fields': <String, dynamic>{}, 'views': {}},
              'rows': <String, dynamic>{},
            },
          },
        },
      };

      expect(
        () => databaseImportFromSnapshot(payload),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('every bundled payload', () {
    test('imports without any remote asset URL left in the output', () {
      final files = Directory('assets/local_templates/payloads')
          .listSync()
          .whereType<File>()
          .where((f) => f.path.endsWith('.json'));
      expect(files, isNotEmpty);

      for (final file in files) {
        final payload =
            jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
        final localUrls = _localizeEverything(payload);
        final kind = (payload['data'] as Map<String, dynamic>)['kind'];
        final reason = file.path;

        if (kind == 'document') {
          final document = documentDataPbFromSnapshot(
            payload,
            localUrls: localUrls,
          );
          final blocks = [
            for (final b in document.blocks.values) jsonDecode(b.data),
          ];
          expect(remoteAssetUrlsIn(blocks), isEmpty, reason: reason);
        } else {
          final result = databaseImportFromSnapshot(
            payload,
            localUrls: localUrls,
          );
          expect(
            remoteAssetUrlsIn(_databaseJson(result)),
            isEmpty,
            reason: reason,
          );
          for (final page in result.rowDocuments) {
            final blocks = [
              for (final b in page.document.blocks.values) jsonDecode(b.data),
            ];
            expect(remoteAssetUrlsIn(blocks), isEmpty, reason: reason);
          }
        }
      }
    });

    test('embedded database blocks point at views the snapshot does not carry',
        () {
      final payload = readBundledPayload(
          'Fundraising-tracker-4c488d3f-0aa2-4da8-99a5-9198afdeb97c');
      final embedded = embeddedDatabaseViewIdsIn(payload);

      expect(embedded, {'a4210294-e883-40da-b24e-f433f5e5813f'});
      final everyDatabaseViewId = Directory('assets/local_templates/payloads')
          .listSync()
          .whereType<File>()
          .map((f) => jsonDecode(f.readAsStringSync()) as Map<String, dynamic>)
          .where((p) => (p['data'] as Map)['kind'] == 'database')
          .expand((p) => (_rawDatabase(p)['database'] as Map)['views'].keys)
          .toSet();
      expect(everyDatabaseViewId, isNot(contains(embedded.single)));
    });
  });
}
