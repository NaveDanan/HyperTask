/** Fixed tunnel paths only, checked after canonical URL normalization and decoding. */
export function hyperOpenBotPathAllowed(path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith('/api/') || /[\\#]|%25|%2f|%5c|%2e|\.\./i.test(path)) return false;
  const url = new URL(path, 'http://127.0.0.1:3010');
  return url.origin === 'http://127.0.0.1:3010' && /^\/api\/(channels|agents|bots|plugins|models|attachments|threads|copilotkit|skills|connections|approvals|decisions|capabilities)(?:[/?]|$)/.test(url.pathname);
}
