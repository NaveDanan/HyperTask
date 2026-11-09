import 'dart:io';
import 'package:appflowy/plugins/document/presentation/editor_plugins/image/image_util.dart';
import 'package:path/path.dart' as path;

final _savedGeneratedImages = <String, String>{};

/// Uses the existing local image storage API before editor/chat rendering.
Future<String> persistGeneratedImageMarkdown(
  String markdown, {
  Future<String?> Function(String)? saveImage,
}) async {
  final matches =
      RegExp(r'!\[([^\]]*)\]\((file:[^)]*)\)').allMatches(markdown).toList();
  var result = markdown;
  for (final match in matches.reversed) {
    final url = match.group(2)!;
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'file') continue;
    final original = uri.toFilePath(windows: Platform.isWindows);
    // Only generated artifacts pass through this storage migration.
    if (path.basename(path.dirname(original)) != 'ai_generated_images') {
      continue;
    }
    var saved = _savedGeneratedImages[url];
    if (saved == null) {
      saved = await (saveImage ?? saveImageToLocalStorage)(original);
      if (saved == null) {
        throw StateError(
          'Could not save the generated image to local image storage.',
        );
      }
      _savedGeneratedImages[url] = saved;
    }
    final replacement =
        '![${match.group(1)}](${Uri.file(saved, windows: Platform.isWindows)})';
    result = result.replaceRange(match.start, match.end, replacement);
  }
  return result;
}
