import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { parse } from '@babel/parser';
import { Button } from '@/components/ui/button';

it('uses Base UI non-submit defaults unless a form action explicitly submits', () => {
  expect(renderToStaticMarkup(<Button>Action</Button>)).toContain('type="button"');
  expect(renderToStaticMarkup(<Button type="submit">Save</Button>)).toContain('type="submit"');
});
it('gives every added form Button without a click or custom render action an explicit type', () => {
  const root = fileURLToPath(new URL('.', import.meta.url)), missing: string[] = [];
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { inspect(path); continue; }
      if (!entry.name.endsWith('.tsx') || entry.name.endsWith('.test.tsx')) continue;
      const source = readFileSync(path, 'utf8'), tree = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      function visit(node: any, inForm = false) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) visit(child, inForm); return; }
        const opening = node.type === 'JSXElement' ? node.openingElement : node.type === 'JSXOpeningElement' ? node : undefined;
        if (opening?.name?.name === 'form') inForm = true;
        if (inForm && node.type === 'JSXOpeningElement' && opening?.name?.name === 'Button') {
          const attributes: string[] = opening.attributes.map((attribute: any) => attribute.type === 'JSXAttribute' ? attribute.name.name : 'spread');
          if (!attributes.some(name => ['type', 'onClick', 'render', 'spread'].includes(name))) {
            missing.push(`${relative(root, path)}:${opening.loc.start.line}: ${source.slice(opening.start, opening.end)}`);
          }
        }
        for (const value of Object.values(node)) visit(value, inForm);
      }
      visit(tree);
    }
  }
  inspect(root);
  expect(missing).toEqual([]);
});
