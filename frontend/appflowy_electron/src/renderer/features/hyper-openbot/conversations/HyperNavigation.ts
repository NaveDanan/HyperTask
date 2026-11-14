export function hyperConversationDestination(id: string, intent?: { path: string }) {
  const path = intent?.path;
  const aliases: Record<string, string> = { 'approvals-inbox': 'approvals', 'computer-browser': 'computer', onboarding: 'home', screens: 'home' };
  let sectionId = aliases[id] ?? id;
  if (path) {
    const pathname = new URL(path, 'https://native.invalid').pathname;
    if (/\/setup(?:\/|$)/.test(pathname)) sectionId = 'setup';
    if (/\/browsers(?:\/|$)/.test(pathname)) sectionId = 'connected-browsers';
    if (/\/browser(?:\/|$)/.test(pathname)) sectionId = 'browser';
    if (/\/notifications(?:\/|$)|\/approvals(?:\/|$)/.test(pathname)) sectionId = 'approvals';
  }
  return { sectionId, ...(path ? { path } : {}) };
}
