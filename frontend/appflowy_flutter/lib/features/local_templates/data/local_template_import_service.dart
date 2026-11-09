import 'dart:convert';
import 'dart:typed_data';

import 'package:appflowy/features/local_templates/data/local_template_converter.dart';
import 'package:appflowy/features/local_templates/data/local_template_media_writer.dart';
import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy/workspace/application/settings/share/import_service.dart';
import 'package:appflowy/workspace/application/view/view_service.dart';
import 'package:appflowy_backend/dispatch/dispatch.dart';
import 'package:appflowy_backend/protobuf/flowy-database2/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-document/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-error/errors.pb.dart';
import 'package:appflowy_backend/protobuf/flowy-folder/protobuf.dart';
import 'package:appflowy_result/appflowy_result.dart';

typedef LocalTemplateImportPages
    = Future<FlowyResult<RepeatedViewPB, FlowyError>> Function(
  String parentViewId,
  List<ImportItemPayloadPB> items,
);

typedef LocalTemplateCreateDatabase = Future<FlowyResult<ViewPB, FlowyError>>
    Function({
  required String parentViewId,
  required String name,
  required ViewLayoutPB layout,
  required Uint8List initialData,
});

typedef LocalTemplateCreateDocument = Future<FlowyResult<void, FlowyError>>
    Function(String documentId, DocumentDataPB document);

typedef LocalTemplateMarkRowHasDocument = Future<FlowyResult<void, FlowyError>>
    Function(String databaseViewId, String rowId);

/// A payload references an asset the bundle does not contain. The store is
/// out of step with its manifest, so the template is not imported.
class LocalTemplateMissingMediaException implements Exception {
  const LocalTemplateMissingMediaException(this.entry, this.url);

  final LocalTemplateEntry entry;
  final String url;

  @override
  String toString() =>
      'LocalTemplateMissingMediaException: ${entry.publishName} references '
      '$url, which is not in the bundled media';
}

/// Imports a downloaded template into the workspace. Nothing is fetched from
/// the network: media comes from the bundle, is copied into the user's data
/// folder, and every block is rewritten to point there.
///
/// Documents go through the existing `FolderEventImportData` API. Databases
/// are rebuilt as typed databases: the folder create-view API takes the
/// `DatabaseData` JSON as initial data, then each row's page is created under
/// its derived document id.
class LocalTemplateImporter {
  LocalTemplateImporter({
    required LocalTemplateRepository repository,
    LocalTemplateImportPages? importPages,
    LocalTemplateCreateDatabase? createDatabase,
    LocalTemplateCreateDocument? createDocument,
    LocalTemplateMarkRowHasDocument? markRowHasDocument,
    LocalTemplateMediaWriter? writeMedia,
  })  : _repository = repository,
        _importPages = importPages ?? ImportBackendService.importPages,
        _createDatabase = createDatabase ?? _defaultCreateDatabase,
        _createDocument = createDocument ?? _defaultCreateDocument,
        _markRowHasDocument = markRowHasDocument ?? _defaultMarkRowHasDocument,
        _writeMedia = writeMedia ?? saveLocalTemplateMedia;

  final LocalTemplateRepository _repository;
  final LocalTemplateImportPages _importPages;
  final LocalTemplateCreateDatabase _createDatabase;
  final LocalTemplateCreateDocument _createDocument;
  final LocalTemplateMarkRowHasDocument _markRowHasDocument;
  final LocalTemplateMediaWriter _writeMedia;

  /// Copies every asset the entry references into the user's data folder and
  /// returns the remote URL to local path map used by the converters.
  Future<Map<String, String>> bundleMedia(LocalTemplateEntry entry) async {
    final manifest = await _repository.loadManifest();
    final localUrls = <String, String>{};
    for (final url in entry.mediaUrls) {
      final asset = manifest.mediaForUrl(url);
      if (asset == null) {
        throw LocalTemplateMissingMediaException(entry, url);
      }
      final bytes = await _repository.loadMedia(asset);
      localUrls[url] = await _writeMedia(asset, bytes);
    }
    return localUrls;
  }

  /// Builds the document payload for [entry] without sending it. Copies media
  /// into the user's data folder first.
  Future<ImportItemPayloadPB> buildDocumentImportItem(
    LocalTemplateEntry entry,
  ) async {
    if (!entry.isAvailable || entry.kind != LocalTemplateKind.document) {
      throw LocalTemplateUnavailableException(entry);
    }
    final localUrls = await bundleMedia(entry);
    final payload = await _repository.loadPayload(entry);
    final document = documentDataPbFromSnapshot(payload, localUrls: localUrls);
    _assertDocumentLocal(document);

    // Matches the existing markdown import path: the backend ignores
    // importType for document layouts and reads DocumentDataPB bytes.
    return ImportItemPayloadPB.create()
      ..name = entry.name
      ..data = document.writeToBuffer()
      ..viewLayout = ViewLayoutPB.Document
      ..importType = ImportTypePB.Markdown;
  }

  /// Builds the typed database import for [entry] without sending it.
  Future<LocalTemplateDatabaseImport> buildDatabaseImport(
    LocalTemplateEntry entry,
  ) async {
    if (!entry.isAvailable || entry.kind != LocalTemplateKind.database) {
      throw LocalTemplateUnavailableException(entry);
    }
    final localUrls = await bundleMedia(entry);
    final payload = await _repository.loadPayload(entry);
    final result = databaseImportFromSnapshot(payload, localUrls: localUrls);
    _assertNoRemoteAssets(jsonDecode(utf8.decode(result.initialData)));
    for (final row in result.rowDocuments) {
      _assertDocumentLocal(row.document);
    }
    return result;
  }

  /// Imports [entry] as a new top-level page under [parentViewId].
  ///
  /// Throws [LocalTemplateUnavailableException] for templates without a
  /// payload. Backend failures come back as a failed [FlowyResult].
  Future<FlowyResult<void, FlowyError>> importTemplate({
    required LocalTemplateEntry entry,
    required String parentViewId,
  }) async {
    switch (entry.kind) {
      case LocalTemplateKind.document:
        final item = await buildDocumentImportItem(entry);
        final result = await _importPages(parentViewId, [item]);
        return result.map((_) {});
      case LocalTemplateKind.database:
        return _importDatabase(entry, parentViewId);
      case null:
        throw LocalTemplateUnavailableException(entry);
    }
  }

  Future<FlowyResult<void, FlowyError>> _importDatabase(
    LocalTemplateEntry entry,
    String parentViewId,
  ) async {
    final database = await buildDatabaseImport(entry);
    final created = await _createDatabase(
      parentViewId: parentViewId,
      name: entry.name,
      layout: database.layout,
      initialData: database.initialData,
    );
    if (!created.isSuccess) {
      return created.map((_) {});
    }
    final view = created.getOrThrow();

    for (final row in database.rowDocuments) {
      final createdDocument =
          await _createDocument(row.documentId, row.document);
      if (!createdDocument.isSuccess) {
        return createdDocument;
      }
      // The row's page indicator reads this flag. Failing to set it only hides
      // the indicator, so the import still succeeds.
      await _markRowHasDocument(view.id, row.rowId);
    }
    return FlowyResult.success(null);
  }
}

/// Throws when a remote asset URL is still present. The store must never
/// reference the network at runtime.
void _assertNoRemoteAssets(Object? json) {
  final remote = remoteAssetUrlsIn(json);
  if (remote.isNotEmpty) {
    throw StateError(
      'Template still references remote assets: ${remote.join(', ')}',
    );
  }
}

void _assertDocumentLocal(DocumentDataPB document) {
  for (final block in document.blocks.values) {
    _assertNoRemoteAssets(jsonDecode(block.data));
  }
}

Future<FlowyResult<ViewPB, FlowyError>> _defaultCreateDatabase({
  required String parentViewId,
  required String name,
  required ViewLayoutPB layout,
  required Uint8List initialData,
}) {
  return ViewBackendService.createView(
    parentViewId: parentViewId,
    name: name,
    layoutType: layout,
    initialDataBytes: initialData,
  );
}

Future<FlowyResult<void, FlowyError>> _defaultCreateDocument(
  String documentId,
  DocumentDataPB document,
) {
  final payload = CreateDocumentPayloadPB()
    ..documentId = documentId
    ..initialData = document;
  return DocumentEventCreateDocument(payload).send();
}

Future<FlowyResult<void, FlowyError>> _defaultMarkRowHasDocument(
  String databaseViewId,
  String rowId,
) {
  final payload = UpdateRowMetaChangesetPB()
    ..viewId = databaseViewId
    ..id = rowId
    ..isDocumentEmpty = false;
  return DatabaseEventUpdateRowMeta(payload).send();
}
