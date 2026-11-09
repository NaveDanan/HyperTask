// Derives the preview of every available template from the bundled store, with
// no network access. Use it to bring an existing manifest up to date after the
// preview rules change, without re-fetching the catalog.
//
// Writes `preview` into each entry of assets/local_templates/manifest.json and
// sets schemaVersion to 3. fetch_templates.mjs already does this on refresh.
//
// Usage (from frontend/appflowy_flutter):
//   node scripts/local_templates/build_previews.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreview, isBundleableAsset, isImageBytes } from './local_template_rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '..', 'assets', 'local_templates');
const manifestPath = join(outDir, 'manifest.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const usableImageUrls = new Set();
const unusable = [];

for (const asset of manifest.media) {
  const bytes = await readFile(join(outDir, asset.path));
  if (!isBundleableAsset(bytes, asset.contentType)) {
    unusable.push(`${asset.path} (${asset.contentType || 'unknown'})`);
    continue;
  }
  if (isImageBytes(bytes, asset.contentType)) usableImageUrls.add(asset.url);
}

const categoryBgById = new Map(manifest.categories.map((c) => [c.id, c.bgColor]));

for (const entry of manifest.templates) {
  if (!entry.available) {
    entry.preview = null;
    continue;
  }
  const payload = JSON.parse(await readFile(join(outDir, entry.payload), 'utf8'));
  entry.preview = buildPreview({
    kind: entry.kind,
    data: payload.data,
    categoryColor: categoryBgById.get(entry.primaryCategoryId) ?? null,
    usableImageUrls,
  });
}

manifest.schemaVersion = 3;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const withImage = manifest.templates.filter((t) => t.preview?.imageUrl).length;
const available = manifest.templates.filter((t) => t.available).length;
process.stdout.write(
  `previews for ${available} templates: ${withImage} with a bundled image, ${available - withImage} with a content summary\n`,
);
if (unusable.length > 0) {
  process.stdout.write(`not usable as images, excluded from previews:\n  ${unusable.join('\n  ')}\n`);
}
