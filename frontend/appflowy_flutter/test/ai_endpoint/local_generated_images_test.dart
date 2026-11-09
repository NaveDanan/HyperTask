import 'dart:io';
import 'package:appflowy/ai/service/local_generated_images.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as path;

void main() {
  test('Migrates generated file Markdown through local image storage',
      () async {
    final root = await Directory.systemTemp.createTemp('appflowy-ai-image-');
    final original =
        path.join(root.path, 'ai_generated_images', 'generated.png');
    final saved = path.join(root.path, 'images', 'saved.png');
    final source = File(original);
    await source.parent.create(recursive: true);
    await source.writeAsBytes([137, 80, 78, 71]);
    var calls = 0;
    try {
      final markdown = 'Before\n![Generated image](${source.uri})\nAfter';
      final migrated = await persistGeneratedImageMarkdown(
        markdown,
        saveImage: (input) async {
          calls++;
          expect(input, original);
          await File(saved).parent.create(recursive: true);
          await File(input).copy(saved);
          return saved;
        },
      );
      expect(migrated, 'Before\n![Generated image](${File(saved).uri})\nAfter');
      expect(await File(saved).exists(), true);
      expect(calls, 1);
      expect(
        await persistGeneratedImageMarkdown(
          markdown,
          saveImage: (_) async => throw StateError('must use cache'),
        ),
        migrated,
      );
    } finally {
      await root.delete(recursive: true);
    }
  });
  test('Does not migrate arbitrary file links or network images', () async {
    const markdown =
        '![Remote](https://internal.example/image.png)\n[File](file:///C:/notes.txt)';
    expect(
      await persistGeneratedImageMarkdown(
        markdown,
        saveImage: (_) async => throw StateError('no image migration needed'),
      ),
      markdown,
    );
  });
  test('Reports local storage failure', () async {
    final root =
        await Directory.systemTemp.createTemp('appflowy-ai-image-failure-');
    try {
      final file =
          File(path.join(root.path, 'ai_generated_images', 'failed.png'));
      await expectLater(
        persistGeneratedImageMarkdown(
          '![Generated](${file.uri})',
          saveImage: (_) async => null,
        ),
        throwsStateError,
      );
    } finally {
      await root.delete(recursive: true);
    }
  });
}
