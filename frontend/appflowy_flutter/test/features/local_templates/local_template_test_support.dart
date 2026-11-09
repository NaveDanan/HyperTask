import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:appflowy/features/local_templates/data/local_template_import_service.dart';
import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy_backend/protobuf/flowy-document/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-error/errors.pb.dart';
import 'package:appflowy_backend/protobuf/flowy-folder/protobuf.dart';
import 'package:appflowy_result/appflowy_result.dart';

/// Reads the real bundled store from disk. `flutter test` runs with the
/// package root as the working directory, so the relative root resolves.
class FileLocalTemplateSource implements LocalTemplateSource {
  FileLocalTemplateSource([this.root = 'assets/local_templates']);

  final String root;
  int manifestReads = 0;
  final List<String> payloadReads = [];
  final List<String> mediaReads = [];

  @override
  Future<String> readManifest() async {
    manifestReads += 1;
    return File('$root/manifest.json').readAsString();
  }

  @override
  Future<String> readPayload(String payloadPath) async {
    payloadReads.add(payloadPath);
    return File('$root/$payloadPath').readAsString();
  }

  @override
  Future<Uint8List> readMedia(String mediaPath) async {
    mediaReads.add(mediaPath);
    return File('$root/$mediaPath').readAsBytes();
  }
}

/// Serves the real store, but with a manifest whose media list is empty. Used
/// to check that an import refuses a template whose media is not bundled.
class ManifestWithoutMediaSource extends FileLocalTemplateSource {
  ManifestWithoutMediaSource() : super();

  @override
  Future<String> readManifest() async {
    final json = jsonDecode(await super.readManifest()) as Map<String, dynamic>;
    json['media'] = <Object?>[];
    return jsonEncode(json);
  }
}

Future<LocalTemplateManifest> loadBundledManifest() async {
  final repository = LocalTemplateRepository(source: FileLocalTemplateSource());
  return repository.loadManifest();
}

/// Snapshot JSON of a bundled payload, as stored.
Map<String, dynamic> readBundledPayload(String publishName) {
  final file = File('assets/local_templates/payloads/$publishName.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

LocalTemplateEntry entryNamed(
  LocalTemplateManifest manifest,
  String publishName,
) {
  return manifest.templates.firstWhere((t) => t.publishName == publishName);
}

/// Stands in for the real media writer, which copies into the app's data
/// folder through the editor's helpers. Records what it was asked to write.
class FakeMediaWriter {
  final List<String> writtenPaths = [];

  Future<String> call(LocalTemplateMediaAsset asset, Uint8List bytes) async {
    writtenPaths.add(asset.path);
    return '/user/AppFlowyData/${asset.kind == 'image' ? 'images' : 'files'}/'
        '${asset.path.split('/').last}';
  }
}

/// Records calls to the import API and answers with a fixed result.
class FakeImportPages {
  FakeImportPages({this.result});

  FlowyResult<RepeatedViewPB, FlowyError>? result;
  final List<String> parentViewIds = [];
  final List<List<ImportItemPayloadPB>> itemBatches = [];

  Future<FlowyResult<RepeatedViewPB, FlowyError>> call(
    String parentViewId,
    List<ImportItemPayloadPB> items,
  ) async {
    parentViewIds.add(parentViewId);
    itemBatches.add(items);
    return result ?? FlowyResult.success(RepeatedViewPB());
  }
}

/// Records database creation, row page creation and row flags.
class FakeBackend {
  FakeBackend({this.createDatabaseResult, this.createDocumentResult});

  FlowyResult<ViewPB, FlowyError>? createDatabaseResult;
  FlowyResult<void, FlowyError>? createDocumentResult;

  final List<({String parentViewId, String name, ViewLayoutPB layout})>
      databases = [];
  final List<Uint8List> initialData = [];
  final List<String> documentIds = [];
  final List<DocumentDataPB> documents = [];
  final List<(String, String)> rowFlags = [];

  Future<FlowyResult<ViewPB, FlowyError>> createDatabase({
    required String parentViewId,
    required String name,
    required ViewLayoutPB layout,
    required Uint8List initialData,
  }) async {
    databases.add((parentViewId: parentViewId, name: name, layout: layout));
    this.initialData.add(initialData);
    return createDatabaseResult ??
        FlowyResult.success(ViewPB()..id = 'view-${databases.length}');
  }

  Future<FlowyResult<void, FlowyError>> createDocument(
    String documentId,
    DocumentDataPB document,
  ) async {
    documentIds.add(documentId);
    documents.add(document);
    return createDocumentResult ?? FlowyResult.success(null);
  }

  Future<FlowyResult<void, FlowyError>> markRowHasDocument(
    String databaseViewId,
    String rowId,
  ) async {
    rowFlags.add((databaseViewId, rowId));
    return FlowyResult.success(null);
  }
}

/// An importer whose every backend call is a fake, so tests never reach the
/// app's storage or the native backend.
LocalTemplateImporter fakeImporter({
  required LocalTemplateRepository repository,
  required FakeImportPages pages,
  FakeBackend? backend,
  FakeMediaWriter? media,
}) {
  final fakeBackend = backend ?? FakeBackend();
  return LocalTemplateImporter(
    repository: repository,
    importPages: pages.call,
    createDatabase: fakeBackend.createDatabase,
    createDocument: fakeBackend.createDocument,
    markRowHasDocument: fakeBackend.markRowHasDocument,
    writeMedia: (media ?? FakeMediaWriter()).call,
  );
}
