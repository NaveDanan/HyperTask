// Re-checks every bundled media asset against assets/local_templates/manifest.json:
// the file exists, its size matches, its SHA-256 matches the manifest and the
// file name, and its leading bytes are the type it claims. Each template preview
// must point at a bundled image. Read-only; exits 1 and lists every problem.
//
// Usage (from frontend/appflowy_flutter):
//   node scripts/local_templates/verify_media.mjs

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBundleableAsset, isImageBytes } from './local_template_rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '..', 'assets', 'local_templates');

const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
const problems = [];
let totalBytes = 0;

for (const asset of manifest.media) {
  const file = join(outDir, asset.path);
  try {
    const info = await stat(file);
    const bytes = await readFile(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    totalBytes += bytes.length;
    if (info.size !== asset.bytes) problems.push(`${asset.path}: size ${info.size}, manifest ${asset.bytes}`);
    if (sha256 !== asset.sha256) problems.push(`${asset.path}: sha256 ${sha256}, manifest ${asset.sha256}`);
    if (!asset.path.includes(asset.sha256)) problems.push(`${asset.path}: file name is not its sha256`);
    if (!isBundleableAsset(bytes, asset.contentType)) problems.push(`${asset.path}: not a ${asset.contentType || 'known'} file (served HTML or another type)`);
  } catch (error) {
    problems.push(`${asset.path}: ${error.message}`);
  }
}

const mediaByUrl = new Map(manifest.media.map((asset) => [asset.url, asset]));
for (const entry of manifest.templates) {
  if (!entry.available) continue;
  const url = entry.preview?.imageUrl;
  if (entry.preview == null) {
    problems.push(`${entry.publishName}: no preview`);
  } else if (url) {
    const asset = mediaByUrl.get(url);
    if (!asset || !isImageBytes(await readFile(join(outDir, asset.path)), asset.contentType)) {
      problems.push(`${entry.publishName}: preview image is not a bundled image`);
    }
  }
}

if (manifest.inventory.mediaBytes !== totalBytes) {
  problems.push(`inventory.mediaBytes ${manifest.inventory.mediaBytes}, files total ${totalBytes}`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`verified ${manifest.media.length} media assets, ${totalBytes} bytes\n`);
}
