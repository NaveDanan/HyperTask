import 'dart:convert';
import 'dart:io';

import 'package:appflowy/plugins/document/presentation/editor_plugins/parsers/sub_page_node_parser.dart';
import 'package:appflowy/plugins/document/presentation/editor_plugins/image/common.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:appflowy/plugins/document/presentation/editor_plugins/plugins.dart';
import 'package:appflowy_backend/log.dart';
import 'package:appflowy_editor/appflowy_editor.dart';
import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:share_plus/share_plus.dart';

Document customMarkdownToDocument(
  String markdown, {
  double? tableWidth,
}) {
  return markdownToDocument(
    markdown,
    markdownParsers: [
      const _LocalMarkdownImageParser(),
      const MarkdownCodeBlockParser(),
      MarkdownSimpleTableParser(tableWidth: tableWidth),
    ],
  );
}

Future<String> customDocumentToMarkdown(
  Document document, {
  String path = '',
  AsyncValueSetter<Archive>? onArchive,
  String lineBreak = '',
}) async {
  final List<Future<ArchiveFile>> fileFutures = [];

  /// create root Archive and directory
  final id = document.root.id,
      archive = Archive(),
      resourceDir = ArchiveFile('$id/', 0, null)..isFile = false,
      fileName = p.basenameWithoutExtension(path),
      dirName = resourceDir.name;

  String markdown = '';
  try {
    markdown = documentToMarkdown(
      document,
      lineBreak: lineBreak,
      customParsers: [
        const MathEquationNodeParser(),
        const CalloutNodeParser(),
        const ToggleListNodeParser(),
        CustomImageNodeFileParser(fileFutures, dirName),
        CustomMultiImageNodeFileParser(fileFutures, dirName),
        GridNodeParser(fileFutures, dirName),
        BoardNodeParser(fileFutures, dirName),
        CalendarNodeParser(fileFutures, dirName),
        const CustomParagraphNodeParser(),
        const SubPageNodeParser(),
        const SimpleTableNodeParser(),
        const LinkPreviewNodeParser(),
        const FileBlockNodeParser(),
      ],
    );
  } catch (e) {
    Log.error('documentToMarkdown error: $e');
  }

  /// create resource directory
  if (fileFutures.isNotEmpty) archive.addFile(resourceDir);

  for (final fileFuture in fileFutures) {
    archive.addFile(await fileFuture);
  }

  /// add markdown file to Archive
  final dataBytes = utf8.encode(markdown);
  archive.addFile(ArchiveFile('$fileName-$id.md', dataBytes.length, dataBytes));

  if (archive.isNotEmpty && path.isNotEmpty) {
    if (onArchive == null) {
      final zipEncoder = ZipEncoder();
      final zip = zipEncoder.encode(archive);
      if (zip != null) {
        final zipFile = await File(path).writeAsBytes(zip);
        if (Platform.isIOS) {
          await Share.shareUri(zipFile.uri);
          await zipFile.delete();
        } else if (Platform.isAndroid) {
          await Share.shareXFiles([XFile(zipFile.path)]);
          await zipFile.delete();
        }
        Log.info('documentToMarkdownFiles to $path');
      }
    } else {
      await onArchive.call(archive);
    }
  }
  return markdown;
}

/// Render generated file images with the same local image block used by imports.
class _LocalMarkdownImageParser extends CustomMarkdownParser {
  const _LocalMarkdownImageParser();
  @override
  List<Node> transform(
    md.Node element,
    List<CustomMarkdownParser> parsers, {
    MarkdownListType listType = MarkdownListType.unknown,
    int? startNumber,
  }) {
    if (element is! md.Element) return [];
    md.Element? image;
    if (element.tag == 'img') {
      image = element;
    } else if (element.children?.length == 1 &&
        element.children!.first is md.Element) {
      final child = element.children!.first as md.Element;
      if (child.tag == 'img') image = child;
    }
    final src = image?.attributes['src'];
    if (src == null) return [];
    final uri = Uri.tryParse(src);
    if (uri == null || !uri.isScheme('file')) return [];
    return [
      customImageNode(url: uri.toFilePath()),
    ];
  }
}
