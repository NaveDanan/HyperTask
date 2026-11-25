import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { HYPER_BOTS_TOOLS } from '@shared/HyperBots';
import { HyperOutlookLogo, HyperJiraLogo, HyperBotToolLogo } from './HyperBotBrandLogos';
import { hyperBotToolProvider } from './HyperBotToolProvider';
import { HyperBotToolsForm } from './HyperBotTools';
import { HYPER_BOTS_DEFAULT_SETTINGS as settings } from '@shared/HyperBots';

it('maps every catalog tool by its group, including Outlook calendar and mail', () => {
  const expected = { 'outlook-calendar': 'outlook', 'outlook-mail': 'outlook', jira: 'jira', newsletter: 'newsletter' };
  for (const [name, tool] of Object.entries(HYPER_BOTS_TOOLS)) expect(hyperBotToolProvider(name)).toBe(expected[tool.group]);
});
it('does not guess a logo for unknown or prototype tool names', () => {
  for (const name of ['', 'outlook_unknown', 'jira_unknown', '__proto__', 'constructor', 'toString']) {
    expect(hyperBotToolProvider(name)).toBeNull();
    expect(renderToStaticMarkup(<HyperBotToolLogo tool={name} />)).toBe('');
  }
});
it('keeps repeated SVG instances decorative and all gradient references unique', () => {
  const html = renderToStaticMarkup(<><HyperOutlookLogo /><HyperOutlookLogo size={16} className="custom-logo" /><HyperJiraLogo /><HyperJiraLogo size={16} /></>);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
  expect(ids).toHaveLength(8);
  expect(new Set(ids).size).toBe(ids.length);
  const references = [...html.matchAll(/url[(]#([^)]+)[)]/g)];
  expect(references).toHaveLength(12);
  for (const match of references) expect(ids).toContain(match[1]);
  expect(html.match(/aria-hidden="true"/g)).toHaveLength(4);
  expect(html.match(/focusable="false"/g)).toHaveLength(4);
  expect(html).toContain('width="14" height="14"');
  expect(html).toContain('width="16" height="16"');
  expect(html).toContain('hb-brand-logo custom-logo');
});
it('decorates every tools row without changing its switch label', () => {
  const html = renderToStaticMarkup(<HyperBotToolsForm settings={settings} bot={settings.bots[0]!} onChange={() => {}} />);
  expect(html.match(/\bhb-brand-logo\b/g)).toHaveLength(Object.keys(HYPER_BOTS_TOOLS).length);
  for (const tool of Object.values(HYPER_BOTS_TOOLS)) expect(html).toContain('aria-label="' + tool.label + '"');
});
