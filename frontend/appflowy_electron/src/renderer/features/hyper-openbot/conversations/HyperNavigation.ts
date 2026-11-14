export function hyperConversationDestination(id: string, intent?: { path: string }) {
  const path = intent?.path ?? (id.includes('/') || id.includes('?') ? id : undefined);
  const head = id.replace(/^\//, '').split(/[/?]/)[0];
  const aliases: Record<string, string> = { 'approvals-inbox': 'approvals', 'computer-browser': 'computer', onboarding: 'setup' };
  let sectionId = aliases[head] ?? head;
  if (path) {
    const url = new URL(path, 'https://native.invalid');
    if (url.origin !== 'https://native.invalid') return { sectionId: 'settings', path: '/settings' };
    const pathname = url.pathname;
    if (/\/setup(?:\/|$)/.test(pathname)) sectionId = 'setup';
    if (/\/onboarding(?:\/|$)/.test(pathname)) sectionId = 'home';
    if (/\/browsers(?:\/|$)/.test(pathname)) sectionId = 'connected-browsers';
    if (/\/browser(?:\/|$)/.test(pathname)) sectionId = 'browser';
    if (/\/notifications(?:\/|$)|\/approvals(?:\/|$)/.test(pathname)) sectionId = 'approvals';
  }
  // Keep unknown allocations, including screens, explicit. Redirecting to Home would discard intent.
  return { sectionId, ...(path ? { path } : {}) };
}
