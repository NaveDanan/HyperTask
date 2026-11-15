import { expect, it } from 'vitest';
import { HYPER_OPENBOT_SECTIONS } from '../HyperOpenBotSections';
import { HYPER_SETTINGS_DESTINATIONS } from './HyperSettingsSection';
import { HYPER_SETTINGS_DESTINATION_IDS, hyperSettingsDestination } from './HyperSettingsNavigation';

it('uses registered canonical IDs for every More settings destination', () => {
  const ids = new Set(['conversations', 'bots', 'skills', 'connections', ...HYPER_OPENBOT_SECTIONS.map(section => section.id)]);
  for (const id of Object.values(HYPER_SETTINGS_DESTINATION_IDS)) expect(ids.has(id), id).toBe(true);
  for (const [, id] of HYPER_SETTINGS_DESTINATIONS) expect(ids.has(id), id).toBe(true);
});
it.each([
  ['/settings/notifications', 'approvals'],
  ['/settings/approvals', 'approvals'],
  ['/settings/setup', 'setup'],
  ['/settings/computer', 'computer'],
  ['/settings/browsers', 'connected-browsers'],
])('routes %s to canonical %s without losing the nested path', (path, sectionId) => {
  expect(hyperSettingsDestination(path, 'personal')).toEqual({ sectionId, path });
});
