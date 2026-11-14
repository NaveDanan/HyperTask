/** OpenBot API route families reachable through the main-owned tunnel. Each parity area owns its slot. */
const HYPER_OPENBOT_ROUTE_FAMILIES: readonly string[] = [
  'channels', 'agents', 'bots', 'plugins', 'models', 'attachments', 'threads', 'copilotkit', 'skills', 'connections', 'approvals', 'decisions', 'capabilities',
  // slot: conversations
  /* conversations */
  // slot: routines
  /* routines */
  // slot: memory
  /* memory */
  // slot: bot-tabs
  /* bot-tabs */
  // slot: approvals-inbox
  /* approvals-inbox */
  // slot: vault
  /* vault */
  // slot: computer-browser
  /* computer-browser */
  // slot: screens
  /* screens */
  // slot: settings
  /* settings */
  // slot: admin-governance
  /* admin-governance */
  // slot: admin-platform
  /* admin-platform */
  // slot: onboarding
  /* onboarding */
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
  if (typeof path !== 'string' || !path.startsWith('/api/') || /[\\#]|%25|%2f|%5c|%2e|\.\./i.test(path)) return false;
  const url = new URL(path, 'http://127.0.0.1:3010');
  if (url.origin !== 'http://127.0.0.1:3010') return false;
  if (HYPER_OPENBOT_EXACT_ROUTES.some(route => route.test(url.pathname))) return true;
  return FAMILY.test(url.pathname);
}
