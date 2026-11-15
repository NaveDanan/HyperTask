// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// routes/_authed/settings/{skills,_personal/plugins.$,_personal/skills_.new,_personal/skills_.$slug}.tsx
// lib/manage-paths.ts; components/settings/settings-sidebar.tsx
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
export const HYPER_SETTINGS_DESTINATION_IDS = {
  notifications: 'approvals', vault: 'vault', accounts: 'connections', computer: 'computer',
  approvals: 'approvals', memory: 'memory', skills: 'skills', apps: 'connections', setup: 'setup', gallery: 'components-gallery',
} as const;
export type HyperSettingsContext = HyperOpenBotSectionContext & {
  navigate?: (sectionId: string, intent?: { path: string }) => void;
};
/** Preserve new/slug/tool intent for the parent section router. Never use these as external URLs. */
export function hyperSettingsDestination(path: string, edition: 'personal' | 'team') {
  const url = new URL(path, 'https://settings.invalid');
  if (url.origin !== 'https://settings.invalid' || !/^\/settings(?:\/|$)/.test(url.pathname)) return { sectionId: 'settings', path: '/settings' };
  const rest = url.pathname.replace(/^\/settings\/?/, '');
  if (rest === 'skills') return { sectionId: 'skills', path: '/skills' + url.search };
  if (rest.startsWith('skills/')) return edition === 'personal' ? { sectionId: 'skills', path: `/${rest}${url.search}` } : { sectionId: 'settings', path: '/settings' };
  if (rest === 'connected-accounts' || rest.startsWith('connected-accounts/')) return { sectionId: 'connections', path: `/connections${rest.slice('connected-accounts'.length)}${url.search}` };
  if (rest === 'plugins' || rest.startsWith('plugins/')) {
    if (edition !== 'personal') return { sectionId: 'settings', path: '/settings' };
    const tail = rest.slice('plugins'.length).replace(/^\/+|\/+$/g, '');
    return { sectionId: 'connections', path: tail === 'composio' || tail === 'arcade' ? `/connections/browse/${tail}` : `/connections${tail ? `/${tail}` : ''}` };
  }
  const sectionId = ({ notifications: HYPER_SETTINGS_DESTINATION_IDS.notifications, approvals: HYPER_SETTINGS_DESTINATION_IDS.approvals, vault: 'vault', passwords: 'vault', credentials: 'vault', computer: HYPER_SETTINGS_DESTINATION_IDS.computer, browsers: 'connected-browsers', 'this-computer': 'computer', memory: 'memory', learning: 'personal-learning', setup: HYPER_SETTINGS_DESTINATION_IDS.setup, 'components-gallery': HYPER_SETTINGS_DESTINATION_IDS.gallery } as Record<string, string>)[rest.split('/')[0]];
  if (sectionId) return { sectionId, path: url.pathname + url.search };
  return { sectionId: 'settings', path: rest === 'activity' && edition === 'personal' ? url.pathname + url.search : '/settings' };
}
