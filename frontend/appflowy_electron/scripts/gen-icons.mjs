// Generates src/renderer/icons/flowy-svgs.ts from the Flutter app's generated icon table
// (appflowy_flutter/lib/generated/flowy_svgs.g.dart), so icons keep their FlowySvgs names
// (e.g. FlowySvgs.add_s), and records each SVG's intrinsic size.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dartTable = path.resolve(root, '../appflowy_flutter/lib/generated/flowy_svgs.g.dart');
const iconRoot = path.resolve(root, '../resources/flowy_icons');
const out = path.join(root, 'src/renderer/icons/flowy-svgs.ts');

const entries = [];
for (const match of fs.readFileSync(dartTable, 'utf8').matchAll(/static const (\w+) = FlowySvgData\('assets\/flowy_icons\/([^']+)'\);/g)) {
  const [, name, relative] = match;
  const file = path.join(iconRoot, relative);
  if (!fs.existsSync(file)) {
    console.warn(`missing ${relative}`);
    continue;
  }
  const svg = fs.readFileSync(file, 'utf8');
  const tag = svg.match(/<svg[^>]*>/)?.[0] ?? '';
  const num = (attr) => {
    const value = tag.match(new RegExp(`\\b${attr}="([\\d.]+)(?:px)?"`))?.[1];
    return value ? Number(value) : undefined;
  };
  const viewBox = tag.match(/viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/);
  const folderSize = Number(relative.split('/')[0].replace('x', '')) || 16;
  const width = num('width') ?? (viewBox ? Number(viewBox[1]) : folderSize);
  const height = num('height') ?? (viewBox ? Number(viewBox[2]) : folderSize);
  entries.push(`  ${name}: { path: '${relative}', width: ${width}, height: ${height} },`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  [
    '// Generated from appflowy_flutter/lib/generated/flowy_svgs.g.dart by scripts/gen-icons.mjs. Do not edit.',
    'export interface FlowySvgData {',
    '  /** Path below frontend/resources/flowy_icons. */',
    '  path: string;',
    '  width: number;',
    '  height: number;',
    '}',
    '',
    'export const FlowySvgs = {',
    ...entries,
    '} as const satisfies Record<string, FlowySvgData>;',
    '',
    'export type FlowySvgName = keyof typeof FlowySvgs;',
    '',
  ].join('\n'),
);
console.log(`${entries.length} icons`);
