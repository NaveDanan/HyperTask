/** OpenBot API route families reachable through the main-owned tunnel. Each parity area owns its slot. */
const HYPER_OPENBOT_ROUTE_FAMILIES: readonly string[] = [
  'channels', 'agents', 'bots', 'plugins', 'models', 'attachments', 'threads', 'copilotkit', 'skills', 'connections', 'approvals', 'decisions', 'capabilities',
  // slot: conversations
  'groups', 'team-bots', 'me', 'delivery', 'audio', 'voice',
  // slot: routines
  'routines', 'responsibilities', 'proactive/settings', 'proactive/suggestions', 'tasks',
  // slot: memory
  'memory', 'admin/learning', 'settings/learning', 'recorder/recordings$', 'admin/enterprise$', 'admin/enterprise/capabilities', 'admin/enterprise/settings/skillSharing$',
  // slot: bot-tabs
  'team-bots', 'me', 'delivery', 'tasks', 'proactive/suggestions', 'routines',
  // slot: approvals-inbox
  'delivery', 'team-bots/consents$',
  // slot: vault
  'passwords', 'sign-in-requests', 'admin/credentials',
  // slot: computer-browser
  'computers', 'browser', 'recorder', 'host-access',
  // slot: screens
  /* screens */
  // slot: settings
  'settings/instructions', 'settings/preferences', 'me', 'proactive/settings', 'responsibilities/sources/github', 'admin/audit-events', 'v2/organizations/default/bots',
  // slot: admin-governance
  'me', 'admin/people', 'admin/enterprise', 'admin/identity-providers', 'admin/audit-events', 'admin/what-if', 'auth/sso/register', 'computers/policy', 'computers/policy-dry-run', 'computers/policy-translate',
  // slot: admin-platform
  /* admin-platform */
  // slot: onboarding
  'me', 'setup', 'settings/preferences', 'route',
];
/** Exact paths outside the families above. */
const HYPER_OPENBOT_EXACT_ROUTES: readonly RegExp[] = [
  /^\/api\/admin\/enterprise\/me$/,
  /^\/api\/computers\/[^/]+\/(status|screenshot)$/,
  // slot: exact routes
];
const FAMILY = new RegExp(`^\\/api\\/(${HYPER_OPENBOT_ROUTE_FAMILIES.join('|')})(?:[/?]|$)`);

/** Fixed tunnel paths only, checked after canonical URL normalization and decoding. */
export function hyperOpenBotPathAllowed(path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith('/api/') || /[\\#]/.test(path)) return false;
  // Queries carry opaque recording cursors and nested workspace paths, never route segments.
  if (/%25|%2f|%5c|%2e|\.\./i.test(path.split('?')[0])) return false;
  const url = new URL(path, 'http://127.0.0.1:3010');
  if (url.origin !== 'http://127.0.0.1:3010') return false;
  if (HYPER_OPENBOT_EXACT_ROUTES.some(route => route.test(url.pathname))) return true;
  return FAMILY.test(url.pathname);
}
