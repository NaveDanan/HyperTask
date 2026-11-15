import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { HyperSharedApprovalFields } from './HyperPluginGrants';

it('does not offer named membership when the server proposal has no named people', () => {
  const html = renderToStaticMarkup(<HyperSharedApprovalFields value={{ audience: 'team', outsideInput: false, members: [] }} onChange={vi.fn()} />);
  expect(html).not.toContain('value="people"');
});
it('displays server-proposed named members without an arbitrary membership editor', () => {
  const html = renderToStaticMarkup(<HyperSharedApprovalFields value={{ audience: 'people', outsideInput: false, members: [{ kind: 'user', value: 'server-user' }, { kind: 'group', value: 'server-group' }] }} onChange={vi.fn()} />);
  expect(html).toContain('server-user'); expect(html).toContain('server-group');
  expect(html).not.toContain('comma separated'); expect(html).not.toContain('type="text"');
});
it('keeps each Bot audience editor in its own radio group within a shared mode-switch dialog', () => {
  const markup = renderToStaticMarkup(<>
    <HyperSharedApprovalFields value={{ audience: 'owner', outsideInput: false, members: [] }} onChange={vi.fn()} />
    <HyperSharedApprovalFields value={{ audience: 'team', outsideInput: true, members: [] }} onChange={vi.fn()} />
  </>);
  const names = [...markup.matchAll(/type="radio"[^>]*name="([^"]+)"/g)].map(match => match[1]);
  expect(names).toHaveLength(4);
  expect(names[0]).toBe(names[1]); expect(names[2]).toBe(names[3]); expect(names[0]).not.toBe(names[2]);
  expect([...markup.matchAll(/type="radio"[^>]*checked=""/g)]).toHaveLength(2);
});
