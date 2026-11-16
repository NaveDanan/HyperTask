/** Pinned upstream DesktopReturn emits only openbot://open. No credential exchange exists. */
export function hyperClassifyBrowserReturn(raw: string): 'ordinary' | 'return' | 'reject' {
  let classified = raw;
  try { classified = decodeURIComponent(raw); } catch { /* Raw malformed return is rejected below. */ }
  let sensitiveHost = false;
  try {
    const parsed = new URL(classified);
    sensitiveHost = parsed.protocol === 'hypertask-flutter:' && !['login-callback', 'invitation-callback'].includes(parsed.hostname) && /(?:callback|connections|desktop-return|^open$)/i.test(parsed.hostname);
  } catch { /* Prefix classification still consumes malformed known callbacks. */ }
  if (!sensitiveHost && !/^openbot:/i.test(classified) && !/^hypertask-flutter:\/\/(?:open|desktop-return|connections|connection-callback|oauth-callback)(?:[/?#:]|$)/i.test(classified)) return 'ordinary';
  if (raw.length > 2048 || /[\s\\%]/.test(raw)) return 'reject';
  try {
    const url = new URL(raw);
    return url.protocol === 'openbot:' && url.hostname === 'open' && !url.port && !url.username && !url.password && !url.pathname && !url.search && !url.hash ? 'return' : 'reject';
  } catch { return 'reject'; }
}
