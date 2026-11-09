// Generates src/renderer/theme/color-schemes.ts from the Flutter built-in FlowyColorSchemes
// (packages/flowy_infra/lib/colorscheme/*.dart), so every color stays identical.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(root, '../appflowy_flutter/packages/flowy_infra/lib/colorscheme');
const out = path.join(root, 'src/renderer/theme/color-schemes.ts');

const schemes = { Default: 'default_colorscheme.dart', Dandelion: 'dandelion.dart', Lemonade: 'lemonade.dart', Lavender: 'lavender.dart' };

// Constants shared across files (ColorSchemeConstants.x is referenced by other schemes).
const constants = new Map([
  ['Colors.white', '#FFFFFF'],
  ['Colors.black', '#000000'],
  ['Colors.transparent', '#00000000'],
]);

function toCss(argb) {
  const value = argb.replace(/^0x/i, '').padStart(8, '0').toUpperCase();
  const alpha = value.slice(0, 2);
  const rgb = value.slice(2);
  return alpha === 'FF' ? `#${rgb}` : `#${rgb}${alpha}`;
}

function evaluate(expression, file) {
  const expr = expression.trim().replace(/^const\s+/, '');
  let m = expr.match(/^Color\((0x[0-9a-fA-F]+)\)$/);
  if (m) return toCss(m[1]);
  m = expr.match(/^Color\.fromRGBO\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (m) {
    const alpha = Math.round(Number(m[4]) * 255).toString(16).padStart(2, '0').toUpperCase();
    const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0').toUpperCase()).join('');
    return `#${hex}${alpha}`;
  }
  const value = constants.get(`${file}:${expr}`) ?? constants.get(expr);
  if (value) return value;
  throw new Error(`Cannot evaluate "${expression}" in ${file}`);
}

const result = {};
for (const [name, fileName] of Object.entries(schemes)) {
  const source = fs.readFileSync(path.join(dir, fileName), 'utf8');
  for (const m of source.matchAll(/(?:static )?const (_?\w+) = (Color(?:\.fromRGBO)?\([^)]*\));/g)) {
    const value = evaluate(m[2], fileName);
    constants.set(`${fileName}:${m[1]}`, value);
    if (fileName === 'default_colorscheme.dart') constants.set(`ColorSchemeConstants.${m[1]}`, value);
  }
  result[name] = {};
  for (const m of source.matchAll(/const \w+ColorScheme\.(light|dark)\(\)\s*:\s*super\(([\s\S]*?)\);/g)) {
    const fields = {};
    for (const f of m[2].matchAll(/(\w+):\s*((?:[^,\n(]|\([^)]*\))+?)\s*(?:,|$)/g)) {
      fields[f[1]] = evaluate(f[2], fileName);
    }
    result[name][m[1]] = fields;
  }
}

const body = JSON.stringify(result, null, 2).replace(/"(\w+)":/g, '$1:').replace(/"/g, "'");
fs.writeFileSync(
  out,
  `// Generated from appflowy_flutter/packages/flowy_infra/lib/colorscheme by scripts/gen-colorschemes.mjs. Do not edit.
export type FlowyColorScheme = Record<string, string>;

export const builtInColorSchemes: Record<string, { light: FlowyColorScheme; dark: FlowyColorScheme }> = ${body};
`,
);
console.log(Object.entries(result).map(([n, s]) => `${n}: ${Object.keys(s.light).length}/${Object.keys(s.dark).length}`).join(', '));
