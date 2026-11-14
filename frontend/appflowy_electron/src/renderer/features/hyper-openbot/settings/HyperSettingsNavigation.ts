// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// routes/_authed/settings/{skills,_personal/plugins.$,_personal/skills_.new,_personal/skills_.$slug}.tsx
// lib/manage-paths.ts; components/settings/settings-sidebar.tsx
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
export const HYPER_SETTINGS_DESTINATION_IDS = {
  notifications: 'approvals-inbox', vault: 'vault', accounts: 'vault', computer: 'computer-browser',
  approvals: 'approvals-inbox', memory: 'memory', skills: 'skills', apps: 'connections', setup: 'onboarding', gallery: 'screens',
} as const;
export type HyperSettingsContext = HyperOpenBotSectionContext & {
  navigate?: (sectionId: string, intent?: { path: string }) => void;
};
/** Preserve new/slug/tool intent for the parent section router. Never use these as external URLs. */
export function hyperSettingsDestination(path: string, edition: 'personal' | 'team') {
  const url = new URL(path, 'https://settings.invalid');
  if (url.origin !== 'https://settings.invalid' || !/^\/settings(?:\/|$)/.test(url.pathname)) return { sectionId: 'settings', path: '/settings' };
  const rest = url.pathname.replace(/^\/settings\/?/, '');
  if (rest === 'skills') return { sectionId: 'skills', path: '/skills' };
  if (rest.startsWith('skills/')) return edition === 'personal' ? { sectionId: 'skills', path: `/${rest}` } : { sectionId: 'settings', path: '/settings' };
  if (rest === 'plugins' || rest.startsWith('plugins/')) {
    if (edition !== 'personal') return { sectionId: 'settings', path: '/settings' };
    const tail = rest.slice('plugins'.length).replace(/^\/+|\/+$/g, '');
    return { sectionId: 'connections', path: tail === 'composio' || tail === 'arcade' ? `/connections/browse/${tail}` : `/connections${tail ? `/${tail}` : ''}` };
  }
  const sectionId = ({ notifications: 'approvals-inbox', approvals: 'approvals-inbox', vault: 'vault', passwords: 'vault', credentials: 'vault', 'connected-accounts': 'vault', computer: 'computer-browser', browsers: 'computer-browser', 'this-computer': 'computer-browser', memory: 'memory', learning: 'memory', setup: 'onboarding', 'components-gallery': 'screens' } as Record<string, string>)[rest.split('/')[0]];
  if (sectionId) return { sectionId, path: url.pathname + url.search };
  return { sectionId: 'settings', path: rest === 'activity' && edition === 'personal' ? url.pathname + url.search : '/settings' };
}
