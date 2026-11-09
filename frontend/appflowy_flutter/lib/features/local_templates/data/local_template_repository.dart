import 'dart:convert';

import 'package:flutter/services.dart';

import 'local_template_models.dart';

/// Where the bundled manifest, payloads and media come from. The app uses
/// [AssetLocalTemplateSource]; tests can provide their own.
abstract class LocalTemplateSource {
  Future<String> readManifest();

  /// [payloadPath] is relative to the local templates root.
  Future<String> readPayload(String payloadPath);

  /// [mediaPath] is relative to the local templates root.
  Future<Uint8List> readMedia(String mediaPath);
}

class AssetLocalTemplateSource implements LocalTemplateSource {
  const AssetLocalTemplateSource({
    this.root = 'assets/local_templates',
    this.bundle,
  });

  static const defaultRoot = 'assets/local_templates';

  final String root;

  /// Defaults to [rootBundle] when null.
  final AssetBundle? bundle;

  AssetBundle get _bundle => bundle ?? rootBundle;

  @override
  Future<String> readManifest() => _bundle.loadString('$root/manifest.json');

  @override
  Future<String> readPayload(String payloadPath) =>
      _bundle.loadString('$root/$payloadPath');

  @override
  Future<Uint8List> readMedia(String mediaPath) async {
    final data = await _bundle.load('$root/$mediaPath');
    return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  }
}

/// Read-only access to the downloaded template store.
class LocalTemplateRepository {
  LocalTemplateRepository({required LocalTemplateSource source})
      : _source = source;

  final LocalTemplateSource _source;
  LocalTemplateManifest? _manifest;
  final Map<String, Future<Uint8List?>> _previewImages = {};

  /// Parses the manifest once and caches it.
  Future<LocalTemplateManifest> loadManifest() async {
    final cached = _manifest;
    if (cached != null) {
      return cached;
    }
    final text = await _source.readManifest();
    final json = jsonDecode(text);
    if (json is! Map<String, dynamic>) {
      throw const FormatException('Local template manifest must be an object');
    }
    final manifest = LocalTemplateManifest.fromJson(json);
    _manifest = manifest;
    return manifest;
  }

  /// Loads the raw snapshot exactly as stored, loading it on demand.
  Future<Map<String, dynamic>> loadPayload(LocalTemplateEntry entry) async {
    final path = entry.payloadPath;
    if (!entry.isAvailable || path == null) {
      throw LocalTemplateUnavailableException(entry);
    }
    final text = await _source.readPayload(path);
    final json = jsonDecode(text);
    if (json is! Map<String, dynamic>) {
      throw FormatException('Payload ${entry.publishName} must be an object');
    }
    return json;
  }

  /// Loads the bundled bytes of [asset]. Throws a [FormatException] when the
  /// bundled file's size differs from the manifest, which means the store is
  /// out of step with its manifest. The SHA-256 is checked by the fetch script.
  Future<Uint8List> loadMedia(LocalTemplateMediaAsset asset) async {
    final bytes = await _source.readMedia(asset.path);
    if (asset.bytes != 0 && bytes.length != asset.bytes) {
      throw FormatException(
        'Media ${asset.path} is ${bytes.length} bytes; manifest says ${asset.bytes}',
      );
    }
    if (!_matchesMediaType(bytes, asset.contentType)) {
      throw FormatException(
          'Media ${asset.path} is not a valid ${asset.contentType} file');
    }
    return bytes;
  }

  /// Bytes of the bundled image at [imageUrl], for a preview card. Resolves to
  /// null when the URL is not a bundled image (for example a file that the
  /// site served as HTML). Cached per URL, so a rebuilt grid reads it once.
  Future<Uint8List?> loadPreviewImage(String imageUrl) {
    return _previewImages.putIfAbsent(
      imageUrl,
      () => _readPreviewImage(imageUrl),
    );
  }

  Future<Uint8List?> _readPreviewImage(String imageUrl) async {
    final manifest = await loadManifest();
    final asset = manifest.mediaForUrl(imageUrl);
    if (asset == null ||
        !asset.isImage ||
        !asset.contentType.startsWith('image/')) {
      return null;
    }
    return loadMedia(asset);
  }
}

// Reject HTML shells before copying assets to the workspace. The refresh
// script applies these signatures at download time too.
bool _matchesMediaType(Uint8List bytes, String contentType) {
  bool startsWith(List<int> signature) =>
      bytes.length >= signature.length &&
      List.generate(signature.length, (i) => bytes[i] == signature[i])
          .every((matches) => matches);
  switch (contentType) {
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return startsWith([0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return startsWith([0x52, 0x49, 0x46, 0x46]) &&
          bytes.length >= 12 &&
          bytes[8] == 0x57 &&
          bytes[9] == 0x45 &&
          bytes[10] == 0x42 &&
          bytes[11] == 0x50;
    case 'application/pdf':
      return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]);
    default:
      return false;
  }
}
