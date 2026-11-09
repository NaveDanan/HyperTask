import 'dart:convert';

import 'package:appflowy/features/local_templates/data/local_template_converter.dart';
import 'package:appflowy/features/local_templates/data/local_template_import_service.dart';
import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy_backend/protobuf/flowy-document/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-error/errors.pb.dart';
import 'package:appflowy_backend/protobuf/flowy-folder/protobuf.dart';
import 'package:appflowy_result/appflowy_result.dart';
import 'package:flutter_test/flutter_test.dart';

import 'local_template_test_support.dart';

void main() {
  late LocalTemplateManifest manifest;
  late LocalTemplateRepository repository;
  late FakeImportPages fakeImport;
  late FakeBackend backend;
  late FakeMediaWriter writer;
  late LocalTemplateImporter importer;

  LocalTemplateImporter buildImporter({
    LocalTemplateRepository? repo,
    FakeBackend? fakeBackend,
  }) {
    final b = fakeBackend ?? backend;
    return LocalTemplateImporter(
      repository: repo ?? repository,
      importPages: fakeImport.call,
      createDatabase: b.createDatabase,
      createDocument: b.createDocument,
      markRowHasDocument: b.markRowHasDocument,
      writeMedia: writer.call,
    );
  }

  setUpAll(() async {
    manifest = await loadBundledManifest();
  });

  setUp(() {
    repository = LocalTemplateRepository(source: FileLocalTemplateSource());
    fakeImport = FakeImportPages();
    backend = FakeBackend();
    writer = FakeMediaWriter();
    importer = buildImporter();
  });

  group('buildDocumentImportItem', () {
    test('builds a document item from DocumentDataPB bytes', () async {
      final entry = entryNamed(manifest, 'Weekly-To-Do-List');

      final item = await importer.buildDocumentImportItem(entry);

      expect(item.name, 'Weekly To-Do List');
      expect(item.viewLayout, ViewLayoutPB.Document);
      expect(item.importType, ImportTypePB.Markdown);
      final document = DocumentDataPB.fromBuffer(item.data);
      expect(document.blocks.containsKey(document.pageId), isTrue);
    });

    test('copies each referenced asset once and points blocks at the copy',
        () async {
      final entry = entryNamed(manifest, 'Business-Overview-One-Pager');

      final item = await importer.buildDocumentImportItem(entry);

      expect(writer.writtenPaths, hasLength(entry.mediaUrls.length));
      expect(writer.writtenPaths.toSet(), hasLength(entry.mediaUrls.length));
      final document = DocumentDataPB.fromBuffer(item.data);
      final blocks = [
        for (final block in document.blocks.values) jsonDecode(block.data),
      ];
      expect(remoteAssetUrlsIn(blocks), isEmpty);
      expect(
        blocks,
        contains(
          predicate<Object?>(
            (b) => b is Map && b['image_type'] == 0,
            'a local image block',
          ),
        ),
      );
    });

    test('rejects a template without a payload before any backend call',
        () async {
      final unavailable = manifest.templates.firstWhere((t) => !t.isAvailable);

      await expectLater(
        importer.buildDocumentImportItem(unavailable),
        throwsA(isA<LocalTemplateUnavailableException>()),
      );
      expect(fakeImport.itemBatches, isEmpty);
      expect(writer.writtenPaths, isEmpty);
    });

    test('refuses a template whose media is missing from the bundle', () async {
      final stripped = LocalTemplateRepository(
        source: ManifestWithoutMediaSource(),
      );
      final entry = entryNamed(manifest, 'Business-Overview-One-Pager');

      await expectLater(
        buildImporter(repo: stripped).buildDocumentImportItem(entry),
        throwsA(isA<LocalTemplateMissingMediaException>()),
      );
      expect(fakeImport.itemBatches, isEmpty);
    });
  });

  group('buildDatabaseImport', () {
    test('builds a typed database with no remote URL left', () async {
      final entry = entryNamed(manifest, 'Bug-Tracker-13a84186');

      final result = await importer.buildDatabaseImport(entry);

      expect(result.layout, anyOf(ViewLayoutPB.Grid, ViewLayoutPB.Board));
      expect(result.fidelity.fieldCount, 7);
      expect(result.fidelity.rowCount, 8);
      expect(result.rowDocuments, isEmpty);
    });
  });

  group('importTemplate for a database', () {
    test('creates the database through the folder API with its typed data',
        () async {
      final entry = entryNamed(manifest, 'Bug-Tracker-13a84186');

      final result = await importer.importTemplate(
        entry: entry,
        parentViewId: 'workspace-1',
      );

      expect(result.isSuccess, isTrue);
      expect(backend.databases, hasLength(1));
      final created = backend.databases.single;
      expect(created.parentViewId, 'workspace-1');
      expect(created.name, 'Bug Tracker');
      expect(created.layout, isNot(ViewLayoutPB.Document));
      expect(fakeImport.itemBatches, isEmpty, reason: 'no CSV import path');
      expect(backend.initialData.single, isNotEmpty);
    });

    test('creates each row page under its derived id and flags the row',
        () async {
      final entry = entryNamed(
        manifest,
        'Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a',
      );

      final result = await importer.importTemplate(
        entry: entry,
        parentViewId: 'workspace-1',
      );

      expect(result.isSuccess, isTrue);
      expect(backend.documentIds, hasLength(2));
      expect(backend.rowFlags, hasLength(2));
      for (final (view, row) in backend.rowFlags) {
        expect(view, 'view-1');
        expect(backend.documentIds, contains(rowDocumentIdForRow(row)));
      }
    });

    test('returns the failure when the database cannot be created', () async {
      final failing = FakeBackend(
        createDatabaseResult: FlowyResult.failure(FlowyError(msg: 'no space')),
      );
      final localImporter = buildImporter(fakeBackend: failing);
      final entry = entryNamed(manifest, 'Bug-Tracker-13a84186');

      final result = await localImporter.importTemplate(
        entry: entry,
        parentViewId: 'workspace-1',
      );

      expect(result.isFailure, isTrue);
      expect(result.fold((_) => '', (error) => error.msg), 'no space');
      expect(failing.documentIds, isEmpty);
    });

    test('stops and reports the failure when a row page cannot be created',
        () async {
      final failing = FakeBackend(
        createDocumentResult: FlowyResult.failure(FlowyError(msg: 'busy')),
      );
      final localImporter = buildImporter(fakeBackend: failing);
      final entry = entryNamed(
        manifest,
        'Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a',
      );

      final result = await localImporter.importTemplate(
        entry: entry,
        parentViewId: 'workspace-1',
      );

      expect(result.isFailure, isTrue);
      expect(failing.documentIds, hasLength(1));
      expect(failing.rowFlags, isEmpty);
    });

    test('rejects an unavailable database before any backend call', () async {
      final unavailable = manifest.templates.firstWhere(
        (t) => !t.isAvailable,
      );

      await expectLater(
        importer.importTemplate(entry: unavailable, parentViewId: 'w'),
        throwsA(isA<LocalTemplateUnavailableException>()),
      );
      expect(backend.databases, isEmpty);
    });
  });

  group('importTemplate for a document', () {
    test('sends one item under the given parent and returns the result',
        () async {
      final entry = entryNamed(manifest, 'Weekly-To-Do-List');
      fakeImport.result = FlowyResult.success(
        RepeatedViewPB()..items.add(ViewPB()..name = 'Weekly To-Do List'),
      );

      final result = await importer.importTemplate(
        entry: entry,
        parentViewId: 'workspace-1',
      );

      expect(fakeImport.parentViewIds, ['workspace-1']);
      expect(fakeImport.itemBatches, hasLength(1));
      expect(fakeImport.itemBatches.single.single.name, 'Weekly To-Do List');
      expect(result.isSuccess, isTrue);
      expect(backend.databases, isEmpty);
    });

    test('surfaces a backend failure as a failed result', () async {
      final entry = entryNamed(manifest, 'Weekly-To-Do-List');
      fakeImport.result = FlowyResult.failure(FlowyError(msg: 'boom'));

      final result = await importer.importTemplate(
        entry: entry,
        parentViewId: 'workspace-1',
      );

      expect(result.isFailure, isTrue);
      expect(result.fold((_) => '', (error) => error.msg), 'boom');
    });

    test('reads the payload and media from the bundled source only', () async {
      final source = FileLocalTemplateSource();
      final localImporter = buildImporter(
        repo: LocalTemplateRepository(source: source),
      );
      final entry = entryNamed(
        manifest,
        'Business-Overview-One-Pager',
      );

      await localImporter.importTemplate(entry: entry, parentViewId: 'w');

      expect(source.payloadReads, [entry.payloadPath]);
      expect(source.mediaReads.toSet(), hasLength(entry.mediaUrls.length));
      for (final path in source.mediaReads) {
        expect(path, startsWith('media/'));
      }
    });
  });
}
