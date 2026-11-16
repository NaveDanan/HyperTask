import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const markerName = '.hyper-dev-jwt-enabled';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const failure = (message) => new Error(message);

/** Development identities only: signature, issuer, audience and expiry are deliberately ignored. */
export function hyperDecodeDevelopmentJwt(token) {
  if (typeof token !== 'string' || token.length > 32768) throw failure('Development JWT must be a compact token of at most 32 KiB.');
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts.every(part => /^[A-Za-z0-9_-]*$/.test(part))) throw failure('Development JWT must have three base64url segments.');
  let header, claims;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch { throw failure('Development JWT header and claims must be JSON objects.'); }
  if (!header || Array.isArray(header) || typeof header !== 'object' || !claims || Array.isArray(claims) || typeof claims !== 'object') throw failure('Development JWT header and claims must be JSON objects.');
  let email = [claims.email, claims.preferred_username].find(value => typeof value === 'string' && value.length <= 254 && emailPattern.test(value));
  if (!email) {
    if (typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 1024) throw failure('Development JWT needs an email, preferred_username email, or subject.');
    email = 'dev-' + createHash('sha256').update(JSON.stringify([typeof claims.iss === 'string' ? claims.iss : '', claims.sub])).digest('hex').slice(0, 32) + '@hypertask.test';
  }
  return { email: email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name.slice(0, 128) : 'Development user' };
}

function envValues(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.trimStart().startsWith('#') && line.includes('=')).map(line => {
    const index = line.indexOf('=');
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [line.slice(0, index).trim(), value];
  }));
}

async function configuration(directory) {
  const root = path.resolve(directory.startsWith('~/') ? path.join(os.homedir(), directory.slice(2)) : directory);
  const values = envValues(await fs.readFile(path.join(root, '.env'), 'utf8'));
  const server = new URL(values.SERVER_ORIGIN);
  if (server.protocol !== 'http:' || server.username || server.password || server.pathname !== '/' || server.search || server.hash) throw failure('This development bridge requires the HTTP development deployment.');
  const port = Number(values.HTTP_PORT || server.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw failure('Invalid development deployment port.');
  if (!values.JWT_SECRET) throw failure('Development deployment signing key is missing.');
  return { root, values, origin: server.origin, loopback: 'http://127.0.0.1:' + port };
}

function serviceToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ aud: 'authenticated', role: 'service_role', sub: '00000000-0000-0000-0000-000000000000', iat: now, exp: now + 120 });
  return message + '.' + createHmac('sha256', secret).update(message).digest('base64url');
}

export async function hyperDevJwtCommand(action, directory, input = {}, request = fetch) {
  const config = await configuration(directory);
  const marker = path.join(config.root, markerName);
  if (action === 'enable') {
    await fs.writeFile(marker, JSON.stringify({ environment: 'development', origin: config.origin }), { mode: 0o600 });
    return { enabled: true, server_origin: config.origin };
  }
  let optIn;
  try { optIn = JSON.parse(await fs.readFile(marker, 'utf8')); } catch { throw failure('Development JWT is disabled on this server. Run the launcher once with --enable-server.'); }
  if (optIn.environment !== 'development' || optIn.origin !== config.origin) throw failure('Development JWT opt-in does not match this deployment.');
  if (action === 'status') return { enabled: true, server_origin: config.origin };
  if (action !== 'exchange') throw failure('Unknown development JWT command.');
  const identity = hyperDecodeDevelopmentJwt(input.jwt);
  const call = (url, options = {}) => request(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const generated = await call(config.loopback + '/gotrue/admin/generate_link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceToken(config.values.JWT_SECRET) },
    body: JSON.stringify({ type: 'magiclink', email: identity.email, data: { name: identity.name }, redirect_to: config.origin + '/app' }),
  });
  if (!generated.ok) throw failure('Development session creation failed (HTTP ' + generated.status + ').');
  const linkData = await generated.json();
  const actionLink = linkData.action_link || linkData.properties?.action_link;
  if (typeof actionLink !== 'string') throw failure('Development authentication returned no verification link.');
  const link = new URL(actionLink);
  if (link.origin !== config.origin || !['/verify', '/gotrue/verify'].includes(link.pathname)) throw failure('Development verification link targeted an unexpected deployment.');
  const verified = await call(config.loopback + '/gotrue/verify' + link.search);
  let session;
  if (verified.ok) {
    try { session = await verified.json(); } catch { throw failure('Development authentication returned no session.'); }
  } else if ([301, 302, 303, 307, 308].includes(verified.status)) {
    const location = new URL(verified.headers.get('location') || '', config.origin);
    const nativeCallback = ['appflowy-flutter:', 'hypertask-flutter:'].includes(location.protocol) && !location.username && !location.password && !location.port && ['', 'login-callback'].includes(location.hostname) && ['', '/'].includes(location.pathname);
    if (location.origin !== config.origin && !nativeCallback) throw failure('Development authentication redirected outside this deployment.');
    session = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  } else throw failure('Development verification failed (HTTP ' + verified.status + ').');
  const expires = Number(session.expires_in);
  if (typeof session.access_token !== 'string' || !session.access_token || typeof session.refresh_token !== 'string' || !session.refresh_token || !Number.isSafeInteger(expires) || expires <= 0 || expires > 86400) throw failure('Development authentication returned an invalid session.');
  const profile = await call(config.loopback + '/gotrue/user', { headers: { Authorization: 'Bearer ' + session.access_token } });
  if (!profile.ok || (await profile.json()).email?.toLowerCase() !== identity.email) throw failure('Development session identity did not match the requested user.');
  return { server_origin: config.origin, identity_email: identity.email, access_token: session.access_token, refresh_token: session.refresh_token, token_type: 'bearer', expires_in: expires, expires_at: Math.floor(Date.now() / 1000) + expires };
}

export async function hyperDevJwtRemoteMain() {
  try {
    let text = '';
    for await (const chunk of process.stdin) { text += chunk; if (text.length > 40000) throw failure('Development request is too large.'); }
    const result = await hyperDevJwtCommand(process.argv[2], process.argv[1], text ? JSON.parse(text) : {});
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error && /^(Development|This development|Invalid development|Unknown development)/.test(error.message) ? error.message : 'Development authentication helper failed.';
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  }
}
