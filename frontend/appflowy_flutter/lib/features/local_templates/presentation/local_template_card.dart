import 'dart:typed_data';

import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:flowy_infra_ui/flowy_infra_ui.dart';
import 'package:flutter/material.dart';

/// Loads the bundled bytes of a preview image. Returns null when the URL is
/// not a bundled image.
typedef LocalTemplatePreviewImageLoader = Future<Uint8List?> Function(
  String imageUrl,
);

/// One template in the store grid: its preview, kind, name, description,
/// categories and the import action.
class LocalTemplateCard extends StatelessWidget {
  const LocalTemplateCard({
    super.key,
    required this.entry,
    required this.importing,
    required this.onImport,
    this.loadPreviewImage,
  });

  final LocalTemplateEntry entry;
  final bool importing;
  final VoidCallback onImport;

  /// Null shows every preview as its content summary.
  final LocalTemplatePreviewImageLoader? loadPreviewImage;

  static const previewHeight = 96.0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final available = entry.isAvailable;
    final kindLabel = switch (entry.kind) {
      LocalTemplateKind.document => 'Document',
      LocalTemplateKind.database => 'Database',
      null => 'Unavailable',
    };

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _LocalTemplatePreviewArea(
            entry: entry,
            loadPreviewImage: loadPreviewImage,
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  FlowyText.regular(
                    kindLabel,
                    color: theme.hintColor,
                    fontSize: 12,
                  ),
                  const SizedBox(height: 6),
                  FlowyText.semibold(
                    entry.name,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Expanded(
                    child: FlowyText.regular(
                      available ? entry.description : (entry.blocker ?? ''),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      color: available ? null : theme.hintColor,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: FlowyText.regular(
                          entry.categoryNames.join(', '),
                          overflow: TextOverflow.ellipsis,
                          color: theme.hintColor,
                          fontSize: 12,
                        ),
                      ),
                      if (importing)
                        const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      else
                        FlowyButton(
                          useIntrinsicWidth: true,
                          disable: !available,
                          radius: BorderRadius.circular(8),
                          text: FlowyText.regular('Import'),
                          onTap: available ? onImport : null,
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The top strip of a card. Shows the template's bundled image when it has
/// one. Otherwise, and while the image loads, it shows the template's colour
/// with a summary of its own content.
class _LocalTemplatePreviewArea extends StatelessWidget {
  const _LocalTemplatePreviewArea({
    required this.entry,
    required this.loadPreviewImage,
  });

  final LocalTemplateEntry entry;
  final LocalTemplatePreviewImageLoader? loadPreviewImage;

  @override
  Widget build(BuildContext context) {
    final preview = entry.preview;
    final imageUrl = preview?.imageUrl;
    final loader = loadPreviewImage;
    final summary = _LocalTemplateContentPreview(entry: entry);

    return SizedBox(
      height: LocalTemplateCard.previewHeight,
      width: double.infinity,
      child: preview == null ||
              !preview.hasImage ||
              imageUrl == null ||
              loader == null
          ? summary
          : FutureBuilder<Uint8List?>(
              future: loader(imageUrl),
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return ColoredBox(color: _backgroundColor(context, entry));
                }
                final bytes = snapshot.data;
                if (bytes == null || snapshot.hasError) {
                  return summary;
                }
                return Semantics(
                  image: true,
                  label: 'Preview of ${entry.name}',
                  child: Image.memory(
                    bytes,
                    fit: BoxFit.cover,
                    width: double.infinity,
                    height: LocalTemplateCard.previewHeight,
                    // Decode at roughly the card's width on a 2x screen. The
                    // bundled covers are up to 11 MB, far larger than a card.
                    cacheWidth: 640,
                    gaplessPlayback: true,
                    excludeFromSemantics: true,
                    errorBuilder: (_, __, ___) => summary,
                  ),
                );
              },
            ),
    );
  }
}

/// A preview with no image. It draws the template's colour and its own
/// headings (documents) or field names (databases), so each card still says
/// what the template is.
class _LocalTemplateContentPreview extends StatelessWidget {
  const _LocalTemplateContentPreview({required this.entry});

  final LocalTemplateEntry entry;

  @override
  Widget build(BuildContext context) {
    final background = _backgroundColor(context, entry);
    final ink =
        ThemeData.estimateBrightnessForColor(background) == Brightness.dark
            ? Colors.white
            : Colors.black87;
    final highlights = entry.preview?.highlights ?? const <String>[];
    final isDatabase = entry.kind == LocalTemplateKind.database;

    final content = highlights.isEmpty
        ? Icon(
            entry.kind == LocalTemplateKind.database
                ? Icons.table_chart_outlined
                : Icons.description_outlined,
            size: 28,
            color: ink.withValues(alpha: 0.6),
          )
        : isDatabase
            ? Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final name in highlights) _Chip(label: name, ink: ink),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final heading in highlights)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: FlowyText.semibold(
                        heading,
                        fontSize: 13,
                        color: ink,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              );

    return Semantics(
      container: true,
      label: highlights.isEmpty
          ? 'Preview of ${entry.name}. No image in the published template.'
          : 'Preview of ${entry.name}. No image in the published template. '
              'Contains: ${highlights.join(', ')}.',
      excludeSemantics: true,
      child: ColoredBox(
        color: background,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Align(
            alignment: Alignment.topLeft,
            child: ClipRect(child: content),
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.ink});

  final String label;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: ink.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: FlowyText.medium(
        label,
        fontSize: 12,
        color: ink,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}

/// The template's colour when it has one, otherwise a neutral surface.
Color _backgroundColor(BuildContext context, LocalTemplateEntry entry) {
  final argb = entry.preview?.colorArgb;
  if (argb != null) {
    return Color(argb);
  }
  return Theme.of(context).hoverColor;
}
