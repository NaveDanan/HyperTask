import { hyperAdminSectionFromPath } from '../admin-governance/HyperAdminNavigation';
export function hyperConversationDestination(id: string, intent?: { path: string }) {
  const path = intent?.path ?? (id.includes('/') || id.includes('?') ? id : undefined);
  const head = id.replace(/^\//, '').split(/[/?]/)[0];
  const aliases: Record<string, string> = { 'approvals-inbox': 'approvals', 'computer-browser': 'computer', onboarding: 'setup' };
  let sectionId = aliases[head] ?? head;
  if (path) {
    const url = new URL(path, 'https://native.invalid');
    if (url.origin !== 'https://native.invalid') return { sectionId: 'settings', path: '/settings' };
    const pathname = url.pathname;
    if (/^\/(?:settings\/|capabilities\/)?memory(?:\/|$)/.test(pathname)) sectionId = 'memory';
    const admin = /^\/admin\/(providers|credentials|plugins|skills|proactive|playground|computers)(?:\/|$)/.exec(pathname);
    if (admin) sectionId = `admin-${admin[1]}`;
    if (/^\/admin\/components(?:\/|$)/.test(pathname)) sectionId = 'components-admin';
    if (/^\/settings\/components-gallery(?:\/|$)/.test(pathname)) sectionId = 'components-gallery';
    if (/^\/s\//.test(pathname)) sectionId = 'screens';
    if (/^\/(?:admin\/)?learning(?:\/|$)/.test(pathname)) sectionId = 'learning';
    if (/^\/settings\/learning(?:\/|$)/.test(pathname)) sectionId = 'personal-learning';
    if (/^\/settings\/plugins(?:\/|$)/.test(pathname)) sectionId = 'connections';
    if (/^\/settings\/skills(?:\/|$)/.test(pathname)) sectionId = 'skills';
    if (/^\/bots\/[^/]+/.test(pathname)) sectionId = /\/computer(?:\/|$)/.test(pathname) ? 'bot-computer' : 'bot';

    if (/\/setup(?:\/|$)/.test(pathname)) sectionId = 'setup';
    if (/\/onboarding(?:\/|$)/.test(pathname)) sectionId = 'home';
    if (/\/browsers(?:\/|$)/.test(pathname)) sectionId = 'connected-browsers';
    if (/\/browser(?:\/|$)/.test(pathname)) sectionId = 'browser';
    if (/\/notifications(?:\/|$)|\/approvals(?:\/|$)/.test(pathname)) sectionId = 'approvals';
    const adminSection = hyperAdminSectionFromPath(pathname);
    if (adminSection) sectionId = adminSection;
  }
  // Keep unknown allocations, including screens, explicit. Redirecting to Home would discard intent.
  return { sectionId, ...(path ? { path } : {}) };
}
