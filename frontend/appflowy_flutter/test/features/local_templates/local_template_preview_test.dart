import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy/features/local_templates/presentation/local_template_card.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'local_template_test_support.dart';

/// A 1x1 PNG, so widget tests can show a real image without reading assets.
final Uint8List _pixelPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
);

void main() {
  late LocalTemplateManifest manifest;

  setUpAll(() async {
    manifest = await loadBundledManifest();
  });

  group('bundled previews', () {
    test('every available template has a preview, and no unavailable one does',
        () {
      for (final entry in manifest.templates) {
        if (entry.isAvailable) {
          expect(entry.preview, isNotNull, reason: entry.publishName);
        } else {
          expect(entry.preview, isNull, reason: entry.publishName);
        }
      }
    });

    test('an image preview is a bundled image the template itself references',
        () {
      final withImage =
          manifest.templates.where((t) => t.preview?.hasImage == true);

      expect(withImage, isNotEmpty);
      for (final entry in withImage) {
        final url = entry.preview!.imageUrl!;
        final asset = manifest.mediaForUrl(url);
        expect(asset, isNotNull, reason: '${entry.publishName} is not bundled');
        expect(asset!.isImage, isTrue, reason: entry.publishName);
        expect(asset.contentType, startsWith('image/'),
            reason: entry.publishName);
        expect(entry.mediaUrls, contains(url), reason: entry.publishName);
        expect(
          entry.preview!.source,
          anyOf(LocalTemplatePreviewSource.cover,
              LocalTemplatePreviewSource.image),
          reason: entry.publishName,
        );
      }
    });

    test('no preview points at a file the site served as HTML', () {
      for (final entry in manifest.templates) {
        final url = entry.preview?.imageUrl;
        if (url == null) continue;
        final asset = manifest.mediaForUrl(url)!;
        expect(
          asset.contentType,
          isNot('text/html'),
          reason: '${entry.publishName} would show the site shell as an image',
        );
      }
    });

    test('a content preview names what the template contains', () {
      final content = manifest.templates.where(
        (t) =>
            t.isAvailable &&
            t.preview?.source == LocalTemplatePreviewSource.content,
      );

      expect(content, isNotEmpty);
      for (final entry in content) {
        expect(entry.preview!.hasImage, isFalse, reason: entry.publishName);
        // A database always has field names. A document may have neither a
        // heading nor a colour (the catalog gives some categories none), and
        // then the card shows the kind icon on a neutral surface.
        if (entry.kind == LocalTemplateKind.database) {
          expect(entry.preview!.highlights, isNotEmpty,
              reason: entry.publishName);
        }
      }
    });

    test('summaries are short enough to fit a card', () {
      for (final entry in manifest.templates) {
        for (final text in entry.preview?.highlights ?? const <String>[]) {
          expect(text.length, lessThanOrEqualTo(60), reason: entry.publishName);
          expect(text.trim(), text, reason: entry.publishName);
        }
      }
    });

    testWidgets('every bundled preview image decodes', (tester) async {
      final repository = LocalTemplateRepository(
        source: FileLocalTemplateSource(),
      );
      final urls = {
        for (final t in manifest.templates)
          if (t.preview?.hasImage == true) t.preview!.imageUrl!,
      };
      expect(urls.length, greaterThan(0));

      await tester.runAsync(() async {
        for (final url in urls) {
          final bytes = await repository.loadPreviewImage(url);
          expect(bytes, isNotNull, reason: url);
          final codec = await ui.instantiateImageCodec(bytes!, targetWidth: 64);
          final frame = await codec.getNextFrame();
          expect(frame.image.width, greaterThan(0), reason: url);
          frame.image.dispose();
          codec.dispose();
        }
      });
    });
  });

  group('LocalTemplatePreview.fromJson', () {
    test('reads a cover with its colour and no highlights', () {
      final preview = LocalTemplatePreview.fromJson({
        'source': 'cover',
        'imageUrl': 'https://example.test/cover.png',
        'color': '#ffe8e0ff',
        'highlights': <String>[],
      });

      expect(preview.source, LocalTemplatePreviewSource.cover);
      expect(preview.imageUrl, 'https://example.test/cover.png');
      expect(preview.colorArgb, 0xffe8e0ff);
      expect(preview.hasImage, isTrue);
    });

    test('reads a content summary with its highlights', () {
      final preview = LocalTemplatePreview.fromJson({
        'source': 'content',
        'imageUrl': null,
        'color': '#fffff5f5',
        'highlights': ['Project', 'Status'],
      });

      expect(preview.source, LocalTemplatePreviewSource.content);
      expect(preview.hasImage, isFalse);
      expect(preview.highlights, ['Project', 'Status']);
    });

    test('treats an unknown source as a content summary', () {
      final preview = LocalTemplatePreview.fromJson({
        'source': 'screenshot',
        'imageUrl': 'https://example.test/x.png',
      });

      expect(preview.source, LocalTemplatePreviewSource.content);
      expect(preview.hasImage, isFalse);
    });

    test('ignores a colour that is not #AARRGGBB', () {
      final preview = LocalTemplatePreview.fromJson({
        'source': 'content',
        'color': '0xffe8e0ff',
      });

      expect(preview.colorArgb, isNull);
    });
  });

  group('LocalTemplateRepository.loadPreviewImage', () {
    test('returns the bundled bytes once per URL', () async {
      final source = FileLocalTemplateSource();
      final repository = LocalTemplateRepository(source: source);
      final entry = entryNamed(manifest, 'Business-Overview-One-Pager');
      final url = entry.preview!.imageUrl!;

      final first = repository.loadPreviewImage(url);
      final second = repository.loadPreviewImage(url);

      expect(identical(first, second), isTrue);
      final bytes = await first;
      expect(bytes, isNotNull);
      expect(bytes!.length, manifest.mediaForUrl(url)!.bytes);
      expect(source.mediaReads, hasLength(1));
    });

    test('returns null for a URL that is not bundled', () async {
      final repository = LocalTemplateRepository(
        source: FileLocalTemplateSource(),
      );

      expect(
        await repository
            .loadPreviewImage('https://example.test/not-bundled.png'),
        isNull,
      );
    });

    test('returns null for a bundled PDF attachment', () async {
      final repository = LocalTemplateRepository(
        source: FileLocalTemplateSource(),
      );
      final fileAsset = manifest.media.firstWhere(
        (asset) => asset.contentType == 'application/pdf',
      );

      expect(await repository.loadPreviewImage(fileAsset.url), isNull);
    });
  });

  group('LocalTemplateCard', () {
    Widget host(Widget child) {
      return MaterialApp(
        builder: (context, child) => AppFlowyTheme(
          data: AppFlowyDefaultTheme().light(),
          child: child!,
        ),
        home: Scaffold(
          body: SizedBox(width: 320, height: 300, child: child),
        ),
      );
    }

    testWidgets('shows the template image when it has one', (tester) async {
      final entry = entryNamed(manifest, 'Business-Overview-One-Pager');
      final requested = <String>[];

      await tester.pumpWidget(
        host(
          LocalTemplateCard(
            entry: entry,
            importing: false,
            onImport: () {},
            loadPreviewImage: (url) async {
              requested.add(url);
              return _pixelPng;
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(requested, [entry.preview!.imageUrl]);
      expect(find.byType(Image), findsOneWidget);
      expect(
        find.bySemanticsLabel('Preview of ${entry.name}'),
        findsOneWidget,
      );
    });

    testWidgets('shows the content summary when the template has no image',
        (tester) async {
      final entry = entryNamed(manifest, 'Bug-Tracker-13a84186');

      await tester.pumpWidget(
        host(
          LocalTemplateCard(
            entry: entry,
            importing: false,
            onImport: () {},
            loadPreviewImage: (_) async => null,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Image), findsNothing);
      for (final field in entry.preview!.highlights) {
        expect(find.text(field), findsWidgets);
      }
      expect(
        find.bySemanticsLabel(
          RegExp(
            'Preview of ${RegExp.escape(entry.name)}\\. No image in the published template\\. Contains: ',
          ),
        ),
        findsOneWidget,
      );
    });

    testWidgets('falls back to the summary when the image cannot be read',
        (tester) async {
      final entry = entryNamed(manifest, 'Business-Overview-One-Pager');

      await tester.pumpWidget(
        host(
          LocalTemplateCard(
            entry: entry,
            importing: false,
            onImport: () {},
            loadPreviewImage: (_) async => Future.error(
              const FormatException('unreadable'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Image), findsNothing);
      expect(
        find.bySemanticsLabel(
            RegExp('Preview of ${RegExp.escape(entry.name)}')),
        findsOneWidget,
      );
    });

    testWidgets('keeps import working and disabled for unavailable templates',
        (tester) async {
      final available = entryNamed(manifest, 'Bug-Tracker-13a84186');
      var imported = 0;

      await tester.pumpWidget(
        host(
          LocalTemplateCard(
            entry: available,
            importing: false,
            onImport: () => imported += 1,
            loadPreviewImage: (_) async => null,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Import'));
      await tester.pump();
      expect(imported, 1);

      final unavailable = manifest.templates.firstWhere((t) => !t.isAvailable);
      await tester.pumpWidget(
        host(
          LocalTemplateCard(
            entry: unavailable,
            importing: false,
            onImport: () => imported += 1,
            loadPreviewImage: (_) async => null,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Import'));
      await tester.pump();
      expect(imported, 1);
    });
  });
}
