/// Models for the offline template store.
///
/// The manifest is written by `scripts/local_templates/fetch_templates.mjs`
/// and mirrors the public template-center catalog at appflowy.com/templates.
library;

enum LocalTemplateKind {
  document,
  database;

  static LocalTemplateKind? fromManifest(String? value) {
    switch (value) {
      case 'document':
        return LocalTemplateKind.document;
      case 'database':
        return LocalTemplateKind.database;
      default:
        return null;
    }
  }
}

class LocalTemplateCategory {
  const LocalTemplateCategory({
    required this.id,
    required this.name,
    required this.icon,
    required this.bgColor,
    required this.description,
    required this.categoryType,
    required this.priority,
  });

  factory LocalTemplateCategory.fromJson(Map<String, dynamic> json) {
    return LocalTemplateCategory(
      id: json['id'] as String,
      name: json['name'] as String,
      icon: json['icon'] as String? ?? '',
      bgColor: json['bgColor'] as String? ?? '',
      description: json['description'] as String? ?? '',
      categoryType: (json['categoryType'] as num?)?.toInt() ?? 0,
      priority: (json['priority'] as num?)?.toInt() ?? 0,
    );
  }

  final String id;
  final String name;
  final String icon;
  final String bgColor;
  final String description;

  /// 0 for use-case categories (Engineering, Marketing, ...), 1 for feature
  /// categories (Docs, Wiki, Database, ...). Mirrors the site's grouping.
  final int categoryType;
  final int priority;
}

/// Where a template's preview comes from. Written by the preview rules in
/// `scripts/local_templates/local_template_rules.mjs`.
enum LocalTemplatePreviewSource {
  /// The page cover of the template, a real image bundled from the snapshot.
  cover,

  /// The first image block of the template, bundled from the snapshot.
  image,

  /// No image. A summary of the template's own content on its colour.
  content;

  static LocalTemplatePreviewSource? fromManifest(String? value) {
    switch (value) {
      case 'cover':
        return LocalTemplatePreviewSource.cover;
      case 'image':
        return LocalTemplatePreviewSource.image;
      case 'content':
        return LocalTemplatePreviewSource.content;
      default:
        return null;
    }
  }
}

/// The preview card for one template. Built from the template's own snapshot,
/// so it is never invented imagery.
class LocalTemplatePreview {
  const LocalTemplatePreview({
    required this.source,
    this.imageUrl,
    this.colorArgb,
    this.highlights = const [],
  });

  factory LocalTemplatePreview.fromJson(Map<String, dynamic> json) {
    final source = LocalTemplatePreviewSource.fromManifest(
      json['source'] as String?,
    );
    return LocalTemplatePreview(
      source: source ?? LocalTemplatePreviewSource.content,
      imageUrl: json['imageUrl'] as String?,
      colorArgb: _argbFromHex(json['color'] as String?),
      highlights: _stringList(json['highlights']),
    );
  }

  final LocalTemplatePreviewSource source;

  /// Remote URL the snapshot referenced. Resolve it with
  /// [LocalTemplateMediaAsset] through the manifest. Null for [content].
  final String? imageUrl;

  /// Background colour as ARGB, from the template's cover or its category.
  /// Null when the catalog gives no colour.
  final int? colorArgb;

  /// Headings (documents) or field names (databases), in display order.
  final List<String> highlights;

  bool get hasImage =>
      imageUrl != null && source != LocalTemplatePreviewSource.content;
}

class LocalTemplateEntry {
  const LocalTemplateEntry({
    required this.viewId,
    required this.name,
    required this.description,
    required this.viewUrl,
    required this.creatorName,
    required this.primaryCategoryId,
    required this.categoryIds,
    required this.categoryNames,
    required this.isFeatured,
    required this.isNew,
    required this.publishNamespace,
    required this.publishName,
    required this.kind,
    required this.payloadPath,
    required this.payloadSha256,
    required this.blocker,
    this.mediaUrls = const [],
    this.preview,
  });

  factory LocalTemplateEntry.fromJson(Map<String, dynamic> json) {
    final creator = json['creator'] as Map<String, dynamic>? ?? const {};
    return LocalTemplateEntry(
      viewId: json['viewId'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      viewUrl: json['viewUrl'] as String? ?? '',
      creatorName: creator['name'] as String? ?? '',
      primaryCategoryId: json['primaryCategoryId'] as String?,
      categoryIds: _stringList(json['categoryIds']),
      categoryNames: _stringList(json['categoryNames']),
      isFeatured: json['isFeatured'] as bool? ?? false,
      isNew: json['isNew'] as bool? ?? false,
      publishNamespace: json['publishNamespace'] as String? ?? '',
      publishName: json['publishName'] as String? ?? '',
      kind: LocalTemplateKind.fromManifest(json['kind'] as String?),
      payloadPath: json['payload'] as String?,
      payloadSha256: json['payloadSha256'] as String?,
      blocker: json['blocker'] as String?,
      mediaUrls: _stringList(json['mediaUrls']),
      preview: json['preview'] is Map<String, dynamic>
          ? LocalTemplatePreview.fromJson(
              json['preview'] as Map<String, dynamic>,
            )
          : null,
    );
  }

  final String viewId;
  final String name;
  final String description;
  final String viewUrl;
  final String creatorName;
  final String? primaryCategoryId;
  final List<String> categoryIds;
  final List<String> categoryNames;
  final bool isFeatured;
  final bool isNew;
  final String publishNamespace;
  final String publishName;

  /// Null when the template has no payload.
  final LocalTemplateKind? kind;

  /// Path relative to `assets/local_templates/`. Null when unavailable.
  final String? payloadPath;
  final String? payloadSha256;

  /// Why the payload could not be downloaded. Null when [isAvailable].
  final String? blocker;

  /// Remote asset URLs the snapshot references. The import swaps each one for
  /// its bundled copy from [LocalTemplateManifest.media].
  final List<String> mediaUrls;

  /// Null when the manifest predates previews, or the template is unavailable.
  final LocalTemplatePreview? preview;

  bool get isAvailable => kind != null && payloadPath != null;

  bool matchesCategory(String? categoryId) {
    if (categoryId == null) {
      return true;
    }
    return categoryIds.contains(categoryId);
  }

  /// Case-insensitive match against name, description, and category names.
  bool matchesQuery(String query) {
    final needle = query.trim().toLowerCase();
    if (needle.isEmpty) {
      return true;
    }
    return name.toLowerCase().contains(needle) ||
        description.toLowerCase().contains(needle) ||
        categoryNames.any((c) => c.toLowerCase().contains(needle));
  }
}

/// One image, file or cover bundled under `assets/local_templates/media/`.
class LocalTemplateMediaAsset {
  const LocalTemplateMediaAsset({
    required this.url,
    required this.path,
    required this.sha256,
    required this.bytes,
    required this.contentType,
    required this.kind,
    required this.referencedBy,
  });

  factory LocalTemplateMediaAsset.fromJson(Map<String, dynamic> json) {
    return LocalTemplateMediaAsset(
      url: json['url'] as String,
      path: json['path'] as String,
      sha256: json['sha256'] as String? ?? '',
      bytes: (json['bytes'] as num?)?.toInt() ?? 0,
      contentType: json['contentType'] as String? ?? '',
      kind: json['kind'] as String? ?? 'image',
      referencedBy: _stringList(json['referencedBy']),
    );
  }

  /// The remote URL the snapshot referenced. Used only to find the bundled copy.
  final String url;

  /// Path relative to `assets/local_templates/`.
  final String path;
  final String sha256;
  final int bytes;
  final String contentType;

  /// `image` for pictures and covers, `file` for attachments such as PDFs.
  final String kind;
  final List<String> referencedBy;

  bool get isImage => kind == 'image';
}

class LocalTemplateInventory {
  const LocalTemplateInventory({
    required this.catalogCount,
    required this.availableCount,
    required this.unavailableCount,
    required this.documentCount,
    required this.databaseCount,
    this.mediaCount = 0,
    this.mediaBytes = 0,
  });

  factory LocalTemplateInventory.fromJson(Map<String, dynamic> json) {
    return LocalTemplateInventory(
      catalogCount: (json['catalogCount'] as num?)?.toInt() ?? 0,
      availableCount: (json['availableCount'] as num?)?.toInt() ?? 0,
      unavailableCount: (json['unavailableCount'] as num?)?.toInt() ?? 0,
      documentCount: (json['documentCount'] as num?)?.toInt() ?? 0,
      databaseCount: (json['databaseCount'] as num?)?.toInt() ?? 0,
      mediaCount: (json['mediaCount'] as num?)?.toInt() ?? 0,
      mediaBytes: (json['mediaBytes'] as num?)?.toInt() ?? 0,
    );
  }

  final int catalogCount;
  final int availableCount;
  final int unavailableCount;
  final int documentCount;
  final int databaseCount;
  final int mediaCount;
  final int mediaBytes;
}

class LocalTemplateManifest {
  const LocalTemplateManifest({
    required this.schemaVersion,
    required this.fetchedAt,
    required this.inventory,
    required this.categories,
    required this.templates,
    this.media = const [],
  });

  factory LocalTemplateManifest.fromJson(Map<String, dynamic> json) {
    final source = json['source'] as Map<String, dynamic>? ?? const {};
    return LocalTemplateManifest(
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 0,
      fetchedAt: DateTime.tryParse(source['fetchedAt'] as String? ?? ''),
      inventory: LocalTemplateInventory.fromJson(
        json['inventory'] as Map<String, dynamic>? ?? const {},
      ),
      categories: (json['categories'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(LocalTemplateCategory.fromJson)
          .toList(),
      templates: (json['templates'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(LocalTemplateEntry.fromJson)
          .toList(),
      media: (json['media'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(LocalTemplateMediaAsset.fromJson)
          .toList(),
    );
  }

  final int schemaVersion;
  final DateTime? fetchedAt;
  final LocalTemplateInventory inventory;
  final List<LocalTemplateCategory> categories;

  /// Every catalog entry, including unavailable ones, in catalog order.
  final List<LocalTemplateEntry> templates;

  /// Every bundled media asset. Empty when the manifest predates media bundling.
  final List<LocalTemplateMediaAsset> media;

  /// The bundled copy of [url], or null when that URL was not bundled.
  LocalTemplateMediaAsset? mediaForUrl(String url) {
    for (final asset in media) {
      if (asset.url == url) {
        return asset;
      }
    }
    return null;
  }

  List<LocalTemplateEntry> get availableTemplates =>
      templates.where((t) => t.isAvailable).toList();

  LocalTemplateCategory? categoryById(String id) {
    for (final category in categories) {
      if (category.id == id) {
        return category;
      }
    }
    return null;
  }

  /// Filters catalog entries by category (null means all) and free-text query.
  List<LocalTemplateEntry> filter({String? categoryId, String query = ''}) {
    return templates
        .where((t) => t.matchesCategory(categoryId) && t.matchesQuery(query))
        .toList();
  }
}

class LocalTemplateUnavailableException implements Exception {
  const LocalTemplateUnavailableException(this.entry);

  final LocalTemplateEntry entry;

  @override
  String toString() =>
      'LocalTemplateUnavailableException: ${entry.name} has no payload: '
      '${entry.blocker ?? 'unknown blocker'}';
}

/// Parses '#AARRGGBB' (the manifest form) into an ARGB int. Null otherwise.
int? _argbFromHex(String? value) {
  if (value == null || !RegExp(r'^#[0-9a-fA-F]{8}$').hasMatch(value)) {
    return null;
  }
  return int.parse(value.substring(1), radix: 16);
}

List<String> _stringList(Object? value) {
  return (value as List? ?? const []).whereType<String>().toList();
}
