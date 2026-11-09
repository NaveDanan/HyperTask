// Rules shared by fetch_templates.mjs, build_previews.mjs and verify_media.mjs.
//
// Two jobs:
//   1. Decide whether downloaded bytes really are the image or PDF the server
//      claimed. The site answers some file-storage URLs with its HTML shell and
//      a 200 status, so a status check alone is not enough.
//   2. Derive each template's preview from its own published snapshot: the
//      page cover or the first image block when a real bundled image exists,
//      otherwise a content summary (headings or field names) on the template's
//      own colour. Nothing here invents imagery.

const IMAGE_SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  'image/webp': (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

const PDF_CONTENT_TYPE = 'application/pdf';
const MAX_HIGHLIGHT_LENGTH = 60;
const MAX_HEADINGS = 3;
const MAX_FIELD_NAMES = 4;

/// True when [bytes] start with the signature of [contentType] (a raster image
/// the store can show). SVG and anything unknown are not accepted.
export function isImageBytes(bytes, contentType) {
  const check = IMAGE_SIGNATURES[contentType];
  return Boolean(check) && bytes.length >= 12 && check(bytes);
}

/// True when [bytes] are a PDF. Used for file assets.
export function isPdfBytes(bytes) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

/// True when the bytes match the type the server declared, for the asset's kind.
export function isBundleableAsset(bytes, contentType) {
  if (contentType === PDF_CONTENT_TYPE) return isPdfBytes(bytes);
  return isImageBytes(bytes, contentType);
}

/// Converts a colour to `#AARRGGBB`. Accepts `0xAARRGGBB` (how covers store
/// colours) and `#RRGGBB` or `#AARRGGBB` (how the catalog stores categories).
export function normalizeArgb(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  let hex = null;
  if (/^0x[0-9a-f]{8}$/i.test(trimmed)) hex = trimmed.slice(2);
  else if (/^#[0-9a-f]{8}$/i.test(trimmed)) hex = trimmed.slice(1);
  else if (/^#[0-9a-f]{6}$/i.test(trimmed)) hex = `ff${trimmed.slice(1)}`;
  return hex ? `#${hex.toLowerCase()}` : null;
}

/// Plain text of a rich-text delta, with the zero-width BOM the site inserts
/// removed and whitespace collapsed.
function deltaText(delta) {
  if (!Array.isArray(delta)) return '';
  return delta
    .map((op) => (typeof op?.insert === 'string' ? op.insert : ''))
    .join('')
    .replace(/﻿/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(text) {
  return text.length > MAX_HIGHLIGHT_LENGTH ? `${text.slice(0, MAX_HIGHLIGHT_LENGTH - 1)}…` : text;
}

/// The root page block of a document snapshot (the one with no parent).
function rootPageBlock(blocks) {
  return Object.values(blocks).find((block) => block?.ty === 'page' && block.parent === '');
}

/// The page cover, when it is a bundled image. Covers are either a file URL
/// (uploaded or from Unsplash) or a named asset, colour or gradient.
function coverImageUrl(root, usableImageUrls) {
  const cover = root?.data?.cover_selection;
  return typeof cover === 'string' && usableImageUrls.has(cover) ? cover : null;
}

/// First image block, in the order the snapshot lists its blocks, whose image
/// is bundled and usable.
function firstImageBlockUrl(blocks, usableImageUrls) {
  for (const block of Object.values(blocks)) {
    const url = block?.ty === 'image' ? block.data?.url : null;
    if (typeof url === 'string' && usableImageUrls.has(url)) return url;
  }
  return null;
}

function documentHighlights(blocks) {
  const headings = [];
  const paragraphs = [];
  for (const block of Object.values(blocks)) {
    if (block?.ty === 'heading') headings.push(deltaText(block.data?.delta));
    else if (block?.ty === 'paragraph') paragraphs.push(deltaText(block.data?.delta));
  }
  const usable = (texts) => texts.filter((text) => text.length > 0).map(shorten);
  const fromHeadings = usable(headings).slice(0, MAX_HEADINGS);
  if (fromHeadings.length > 0) return fromHeadings;
  return usable(paragraphs).slice(0, 2);
}

function databaseHighlights(rawDatabase) {
  const fields = Object.values(rawDatabase?.fields ?? {}).filter((f) => typeof f?.name === 'string');
  const primaryFirst = [...fields.filter((f) => f.is_primary), ...fields.filter((f) => !f.is_primary)];
  return primaryFirst
    .map((f) => shorten(f.name.trim()))
    .filter((name) => name.length > 0)
    .slice(0, MAX_FIELD_NAMES);
}

/// The preview for one available template.
///   kind: 'document' | 'database'
///   data: the snapshot's `data` object, as stored in the payload
///   categoryColor: the primary category's catalog colour, or null
///   usableImageUrls: remote URLs whose bundled bytes are real images
export function buildPreview({ kind, data, categoryColor, usableImageUrls }) {
  const categoryArgb = normalizeArgb(categoryColor);
  if (kind === 'database') {
    const rawDatabase = data?.database?.raw?.database;
    return {
      source: 'content',
      imageUrl: null,
      color: categoryArgb,
      highlights: databaseHighlights(rawDatabase),
    };
  }

  const blocks = data?.document?.raw?.data?.blocks ?? {};
  const root = rootPageBlock(blocks);
  const coverType = root?.data?.cover_selection_type;
  const coverColor = coverType === 'CoverType.color' ? normalizeArgb(root?.data?.cover_selection) : null;
  const imageUrl =
    coverImageUrl(root, usableImageUrls) ?? firstImageBlockUrl(blocks, usableImageUrls);
  const source = imageUrl === null ? 'content' : coverImageUrl(root, usableImageUrls) ? 'cover' : 'image';

  return {
    source,
    imageUrl,
    color: coverColor ?? categoryArgb,
    highlights: source === 'content' ? documentHighlights(blocks) : [],
  };
}
