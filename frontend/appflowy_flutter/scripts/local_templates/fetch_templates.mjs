// Downloads the public AppFlowy template catalog and each template's published
// snapshot into assets/local_templates/.
//
// Usage (from frontend/appflowy_flutter):
//   node --use-system-ca scripts/local_templates/fetch_templates.mjs
//
// --use-system-ca makes Node trust the OS certificate store, which corporate
// TLS-inspection setups need. Certificate checks stay on.
//
// Output:
//   assets/local_templates/manifest.json         catalog, categories, availability inventory, media list
//   assets/local_templates/payloads/<name>.json  raw snapshot exactly as served
//   assets/local_templates/media/<sha256>.<ext>  every image, file and cover a payload references
//
// Each media file must really be the type the server declared (an image or a
// PDF by its leading bytes). The site answers some file-storage URLs with its
// HTML shell and a 200 status, which would otherwise be stored as an image.
//
// Only read requests are made. Unavailable templates are recorded in the
// manifest with a blocker instead of a payload file, so they are never shown as
// downloaded. A media asset that cannot be downloaded fails the whole run: the
// store must stay fully offline, so a partial media set is not written.

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreview, isBundleableAsset, isImageBytes } from './local_template_rules.mjs';

const API_BASE = 'https://beta.appflowy.cloud/api/template-center';
const PUBLISHED_BASE = 'https://beta.appflowy.cloud/api/workspace/v2/published';
const SITE_ORIGIN = 'https://appflowy.com';
const REQUEST_DELAY_MS = 150;
const MAX_ATTEMPTS = 3;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '..', 'assets', 'local_templates');
const payloadDir = join(outDir, 'payloads');
const mediaDir = join(outDir, 'media');

// Hosts that serve the images and files the templates embed. Plain web links
// (link previews, references) are not assets and are left alone.
const ASSET_HOST_PATTERNS = [
  /^https:\/\/beta\.appflowy\.cloud\/api\/file_storage\//,
  /^https:\/\/images\.unsplash\.com\//,
];

const EXTENSION_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

const headers = {
  Accept: 'application/json, text/plain, */*',
  Origin: SITE_ORIGIN,
  Referer: `${SITE_ORIGIN}/templates`,
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/// Returns { status, body } where body is the raw text. Retries transient failures.
async function getText(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      const body = await response.text();
      // 5xx and rate limits are transient; anything else is a real answer.
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return { status: response.status, body };
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(REQUEST_DELAY_MS * attempt * 4);
  }
  throw new Error(`GET ${url} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

async function getJson(url) {
  const { status, body } = await getText(url);
  if (status !== 200) {
    throw new Error(`GET ${url} returned HTTP ${status}`);
  }
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
    throw new Error(`GET ${url} did not return an API envelope`);
  }
  return parsed.data;
}

function categoryName(categoriesById, id) {
  return categoriesById.get(id)?.name ?? null;
}

function isAssetUrl(value) {
  return typeof value === 'string' && ASSET_HOST_PATTERNS.some((p) => p.test(value));
}

/// Every asset URL in a snapshot, in first-seen order. Walks the whole tree so
/// block data, page covers, row covers and embedded render trees are all covered.
function collectAssetUrls(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectAssetUrls(item, found);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectAssetUrls(value, found);
  } else if (isAssetUrl(node)) {
    found.add(node);
  }
  return found;
}

/// Returns { bytes, contentType } for a binary asset. Retries transient failures.
async function getBinary(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': headers['User-Agent'], Accept: '*/*' },
      });
      if (response.status === 200) {
        const bytes = Buffer.from(await response.arrayBuffer());
        return { bytes, contentType: (response.headers.get('content-type') ?? '').split(';')[0].trim() };
      }
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`HTTP ${response.status}`);
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(REQUEST_DELAY_MS * attempt * 4);
  }
  throw new Error(`GET ${url} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

function extensionFor(url, contentType) {
  const fromType = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (fromType) return fromType;
  const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : 'bin';
}

function mediaKindFor(contentType) {
  return contentType === 'application/pdf' ? 'file' : 'image';
}

async function main() {
  const fetchedAt = new Date().toISOString();

  const categoriesData = await getJson(`${API_BASE}/category`);
  await sleep(REQUEST_DELAY_MS);
  const templatesData = await getJson(`${API_BASE}/template`);

  const categories = categoriesData.categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    bgColor: c.bg_color,
    description: c.description ?? '',
    categoryType: c.category_type,
    priority: c.priority,
  }));
  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  const catalog = templatesData.templates;
  const templates = [];
  const payloadData = new Map();

  // Start from clean payload and media directories so removed templates and
  // unreferenced assets do not linger.
  await rm(payloadDir, { recursive: true, force: true });
  await mkdir(payloadDir, { recursive: true });
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });

  for (const item of catalog) {
    const publish = item.publish_info;
    const publishName = publish.publish_name;
    const entry = {
      viewId: item.view_id,
      name: item.name,
      description: item.description ?? '',
      viewUrl: item.view_url,
      creator: { name: item.creator?.name ?? '', avatarUrl: item.creator?.avatar_url ?? '' },
      primaryCategoryId: item.primary_category_id,
      primaryCategory: categoryName(categoriesById, item.primary_category_id),
      categoryIds: (item.categories ?? []).map((c) => c.id),
      categoryNames: (item.categories ?? []).map((c) => c.name),
      isFeatured: Boolean(item.is_featured),
      isNew: Boolean(item.is_new_template),
      publishNamespace: publish.namespace,
      publishName,
      createdAt: item.created_at,
      lastUpdatedAt: item.last_updated_at,
      kind: null,
      payload: null,
      payloadSha256: null,
      available: false,
      blocker: null,
      mediaUrls: [],
      preview: null,
    };

    if (publish.unpublished_timestamp) {
      entry.blocker = 'Unpublished on appflowy.com; the snapshot endpoint is not offered.';
      templates.push(entry);
      continue;
    }
    if (!publish.duplicate_enabled) {
      entry.blocker = 'Duplication is disabled for this template.';
      templates.push(entry);
      continue;
    }

    await sleep(REQUEST_DELAY_MS);
    const snapshotUrl = `${PUBLISHED_BASE}/${publish.namespace}/${publishName}/snapshot`;
    const { status, body } = await getText(snapshotUrl);
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }

    if (status !== 200 || !parsed?.data) {
      const reason = parsed?.message ?? `HTTP ${status}`;
      entry.blocker = `Snapshot unavailable: ${reason}`;
      templates.push(entry);
      continue;
    }

    const kind = parsed.data.kind;
    if (kind !== 'document' && kind !== 'database') {
      entry.blocker = `Unsupported snapshot kind: ${kind}`;
      templates.push(entry);
      continue;
    }

    // Stored as served, re-serialised with stable indentation so diffs stay readable.
    const payloadText = `${JSON.stringify(parsed, null, 1)}\n`;
    const payloadPath = `payloads/${publishName}.json`;
    await writeFile(join(outDir, payloadPath), payloadText, 'utf8');

    payloadData.set(publishName, parsed.data);
    entry.kind = kind;
    entry.payload = payloadPath;
    entry.payloadSha256 = createHash('sha256').update(payloadText).digest('hex');
    entry.mediaUrls = [...collectAssetUrls(parsed.data)];
    entry.available = true;
    templates.push(entry);
    process.stdout.write(`ok   ${kind.padEnd(8)} ${publishName}\n`);
  }

  for (const entry of templates.filter((t) => !t.available)) {
    process.stdout.write(`skip ${entry.name} (${entry.publishName}): ${entry.blocker}\n`);
  }

  // Download each distinct asset once, store it under its checksum, and record
  // which templates reference it.
  const mediaByUrl = new Map();
  for (const entry of templates.filter((t) => t.available)) {
    for (const url of entry.mediaUrls) {
      if (!mediaByUrl.has(url)) mediaByUrl.set(url, { url, referencedBy: [] });
      mediaByUrl.get(url).referencedBy.push(entry.publishName);
    }
  }
  const media = [];
  const mediaFailures = [];
  const usableImageUrls = new Set();
  for (const asset of mediaByUrl.values()) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const { bytes, contentType } = await getBinary(asset.url);
      if (!isBundleableAsset(bytes, contentType)) {
        throw new Error(`not the ${contentType || 'unknown'} it claims to be (served HTML or another type)`);
      }
      if (isImageBytes(bytes, contentType)) usableImageUrls.add(asset.url);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const ext = extensionFor(asset.url, contentType);
      const path = `media/${sha256}.${ext}`;
      await writeFile(join(outDir, path), bytes);
      media.push({
        url: asset.url,
        path,
        sha256,
        bytes: bytes.length,
        contentType,
        kind: mediaKindFor(contentType),
        referencedBy: [...new Set(asset.referencedBy)],
      });
      process.stdout.write(`media ${String(bytes.length).padStart(9)} ${path}\n`);
    } catch (error) {
      mediaFailures.push(`${asset.url}: ${error.message}`);
    }
  }
  if (mediaFailures.length > 0) {
    throw new Error(
      `${mediaFailures.length} media asset(s) could not be downloaded; manifest not written:\n  ${mediaFailures.join('\n  ')}`,
    );
  }

  for (const entry of templates.filter((t) => t.available)) {
    entry.preview = buildPreview({
      kind: entry.kind,
      data: payloadData.get(entry.publishName),
      categoryColor: categoriesById.get(entry.primaryCategoryId)?.bgColor ?? null,
      usableImageUrls,
    });
  }

  const available = templates.filter((t) => t.available);
  const mediaBytes = media.reduce((sum, m) => sum + m.bytes, 0);
  const manifest = {
    schemaVersion: 3,
    source: {
      catalogUrl: `${API_BASE}/template`,
      categoryUrl: `${API_BASE}/category`,
      snapshotUrlPattern: `${PUBLISHED_BASE}/{publishNamespace}/{publishName}/snapshot`,
      siteUrl: `${SITE_ORIGIN}/templates`,
      fetchedAt,
    },
    inventory: {
      catalogCount: catalog.length,
      availableCount: available.length,
      unavailableCount: templates.length - available.length,
      documentCount: available.filter((t) => t.kind === 'document').length,
      databaseCount: available.filter((t) => t.kind === 'database').length,
      mediaCount: media.length,
      mediaBytes,
    },
    categories,
    media,
    templates,
  };

  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `\nwrote ${available.length}/${catalog.length} payloads and ${media.length} media assets (${mediaBytes} bytes) to ${outDir}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});

