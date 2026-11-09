import 'dart:io';
import 'package:appflowy/plugins/document/presentation/editor_plugins/image/common.dart';
import 'package:appflowy/plugins/document/presentation/editor_plugins/plugins.dart';
import 'package:appflowy/shared/markdown_to_document.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('generated file images decode to local image blocks', () {
    final path = Platform.isWindows ? r'C:\images\Generated picture.png' : '/tmp/Generated picture.png';
    final uri = Uri.file(path, windows: Platform.isWindows);
    final document = customMarkdownToDocument('![Generated image]($uri)');
    final image = document.root.children.firstWhere((node) => node.type == CustomImageBlockKeys.type);
    expect(image.attributes[CustomImageBlockKeys.url], path);
    expect(image.attributes[CustomImageBlockKeys.imageType], CustomImageType.local.toIntValue());
  });
}
