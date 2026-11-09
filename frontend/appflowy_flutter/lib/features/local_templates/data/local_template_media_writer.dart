import 'dart:io';
import 'dart:typed_data';

import 'package:appflowy/plugins/document/presentation/editor_plugins/file/file_util.dart';
import 'package:appflowy/plugins/document/presentation/editor_plugins/image/image_util.dart';
import 'package:flowy_infra/uuid.dart';
import 'package:path/path.dart' as p;

import 'local_template_models.dart';

/// Copies one bundled media asset into the user's local data folder and
/// returns the durable path. Imported blocks point at that path, so the editor
/// reads the user's copy and never the bundled asset or a remote URL.
typedef LocalTemplateMediaWriter = Future<String> Function(
  LocalTemplateMediaAsset asset,
  Uint8List bytes,
);

/// Saves through the same helpers the editor uses for pasted and uploaded
/// files: [saveImageToLocalStorage] for images and covers, and
/// [saveFileToLocalStorage] for attachments. Those helpers copy a file on disk,
/// so the bytes go through a temporary file first.
Future<String> saveLocalTemplateMedia(
  LocalTemplateMediaAsset asset,
  Uint8List bytes,
) async {
  final temp = File(
    p.join(
      Directory.systemTemp.path,
      'local_template_${uuid()}${p.extension(asset.path)}',
    ),
  );
  await temp.writeAsBytes(bytes, flush: true);
  try {
    final saved = asset.isImage
        ? await saveImageToLocalStorage(temp.path)
        : await saveFileToLocalStorage(temp.path);
    if (saved == null) {
      throw FileSystemException('Could not save bundled media', asset.path);
    }
    return saved;
  } finally {
    if (temp.existsSync()) {
      await temp.delete();
    }
  }
}
