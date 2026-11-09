import 'dart:typed_data';
import 'dart:io';

import 'package:appflowy/features/local_templates/data/local_template_converter.dart';
import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import 'local_template_test_support.dart';

void main() {
  late LocalTemplateManifest manifest;
  late LocalTemplateRepository repository;

  setUpAll(() async {
    manifest = await loadBundledManifest();
    repository = LocalTemplateRepository(source: FileLocalTemplateSource());
  });

  group('bundled media', () {
    test('matches the inventory and totals the recorded bytes', () {
      expect(manifest.media, hasLength(20));
      expect(manifest.inventory.mediaCount, manifest.media.length);
      expect(
        manifest.inventory.mediaBytes,
        manifest.media.fold<int>(0, (sum, m) => sum + m.bytes),
      );
    });

    test('every asset is a file on disk with the recorded size', () {
      for (final asset in manifest.media) {
        final file = File('assets/local_templates/${asset.path}');
        expect(file.existsSync(), isTrue, reason: asset.path);
        expect(file.lengthSync(), asset.bytes, reason: asset.path);
      }
    });

    test('names every file by its SHA-256 and keeps the source URL', () {
      final pattern = RegExp(r'^media/[0-9a-f]{64}\.[a-z0-9]+$');
      for (final asset in manifest.media) {
        expect(asset.path, matches(pattern), reason: asset.path);
        expect(asset.path, contains(asset.sha256), reason: asset.url);
        expect(asset.url, startsWith('https://'));
        expect(asset.referencedBy, isNotEmpty, reason: asset.url);
      }
    });

    test('classifies PDFs as files and everything else as images', () {
      for (final asset in manifest.media) {
        final isPdf = asset.contentType == 'application/pdf';
        expect(asset.kind, isPdf ? 'file' : 'image', reason: asset.path);
        expect(asset.isImage, !isPdf);
      }
    });

    test('loads the bytes the manifest describes', () async {
      for (final asset in manifest.media) {
        final bytes = await repository.loadMedia(asset);
        expect(bytes.length, asset.bytes, reason: asset.path);
      }
    });

    test('rejects HTML even when advertised as an image', () async {
      const asset = LocalTemplateMediaAsset(
        url: 'https://example.invalid/image.webp',
        path: 'media/bad.webp',
        sha256: '',
        bytes: 0,
        contentType: 'image/webp',
        kind: 'image',
        referencedBy: [],
      );
      final repository = LocalTemplateRepository(source: _HtmlMediaSource());
      await expectLater(repository.loadMedia(asset), throwsFormatException);
    });

    test('refuses bytes whose size differs from the manifest', () async {
      final asset = manifest.media.first;
      final lying = LocalTemplateRepository(source: _ExtraByteSource());

      await expectLater(
        lying.loadMedia(asset),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('every payload reference', () {
    test('is bundled, and every bundled asset is referenced by a payload', () {
      final bundled = {for (final m in manifest.media) m.url};
      final referenced = <String>{};

      for (final entry in manifest.availableTemplates) {
        final payload = readBundledPayload(entry.publishName);
        final urls = remoteAssetUrlsIn(payload);
        expect(entry.mediaUrls.toSet(), urls, reason: entry.publishName);
        expect(bundled, containsAll(urls), reason: entry.publishName);
        referenced.addAll(urls);
        for (final url in urls) {
          expect(
            manifest.mediaForUrl(url)!.referencedBy,
            contains(entry.publishName),
            reason: url,
          );
        }
      }

      expect(referenced, bundled, reason: 'no orphaned media files');
    });
  });
}

/// Serves one byte more than the file holds, to test the size check.
class _ExtraByteSource extends FileLocalTemplateSource {
  @override
  Future<Uint8List> readMedia(String mediaPath) async {
    final bytes = await super.readMedia(mediaPath);
    return Uint8List.fromList([...bytes, 0]);
  }
}

class _HtmlMediaSource extends FileLocalTemplateSource {
  @override
  Future<Uint8List> readMedia(String mediaPath) async =>
      Uint8List.fromList('<html>web app shell</html>'.codeUnits);
}
