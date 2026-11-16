import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hyperDecodeDevelopmentJwt, hyperDevJwtCommand } from './HyperDevJwtExchange.mjs';

const jwt = claims => Buffer.from('{"alg":"none"}').toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.';
const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) { for (const file of ['.env', '.hyper-dev-jwt-enabled']) await fs.unlink(path.join(root, file)).catch(() => {}); await fs.rmdir(root); } });
async function setup() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-dev-jwt-test-')); roots.push(root); await fs.writeFile(path.join(root, '.env'), 'SERVER_ORIGIN=http://dev.example.test:8080\nHTTP_PORT=8080\nJWT_SECRET=test-only-key\n'); return root; }

test('accepts unsigned, expired and foreign-issuer tokens as development identities only', () => {
  assert.deepEqual(hyperDecodeDevelopmentJwt(jwt({ email: 'Employee@Example.test', name: 'Employee', role: 'service_role', exp: 1, iss: 'foreign' })), { email: 'employee@example.test', name: 'Employee' });
  assert.equal(hyperDecodeDevelopmentJwt(jwt({ preferred_username: 'employee@example.test' })).email, 'employee@example.test');
});
test('uses stable separate synthetic identities for subject-only tokens', () => {
  const a = hyperDecodeDevelopmentJwt(jwt({ sub: 'one', iss: 'a' })).email;
  assert.equal(a, hyperDecodeDevelopmentJwt(jwt({ sub: 'one', iss: 'a' })).email);
  assert.notEqual(a, hyperDecodeDevelopmentJwt(jwt({ sub: 'one', iss: 'b' })).email);
  assert.match(a, /^dev-[a-f0-9]+@hypertask.test$/);
});
test('rejects malformed or oversized identity input', () => {
  for (const value of ['not-a-jwt', jwt({}), 'a'.repeat(33000), 'e30.W10.']) assert.throws(() => hyperDecodeDevelopmentJwt(value));
});
test('refuses exchange until this development deployment explicitly opts in', async () => {
  const root = await setup();
  await assert.rejects(hyperDevJwtCommand('exchange', root, { jwt: jwt({ sub: 'one' }) }), /disabled/);
  await hyperDevJwtCommand('enable', root);
  await fs.writeFile(path.join(root, '.env'), 'SERVER_ORIGIN=http://other.example.test:8080\nJWT_SECRET=test-only-key\n');
  await assert.rejects(hyperDevJwtCommand('status', root), /does not match/);
});
test('obtains a real session through loopback without forwarding privilege claims', async () => {
  const root = await setup(); await hyperDevJwtCommand('enable', root);
  const calls = [];
  const request = async (url, options) => {
    calls.push({url, options});
    assert.ok(url.startsWith('http://127.0.0.1:8080/gotrue/'));
    assert.equal(options.redirect, 'manual');
    if (url.endsWith('generate_link')) {
      assert.deepEqual(JSON.parse(options.body), { type: 'magiclink', email: 'employee@example.test', data: { name: 'Employee' }, redirect_to: 'http://dev.example.test:8080/app' });
      return Response.json({ action_link: 'http://dev.example.test:8080/verify?token=synthetic' });
    }
    if (url.includes('/verify?')) return new Response(null, { status: 303, headers: { location: 'http://dev.example.test:8080/app#access_token=actual-session&refresh_token=actual-refresh&expires_in=7200' } });
    return Response.json({ email: 'employee@example.test' });
  };
  const result = await hyperDevJwtCommand('exchange', root, { jwt: jwt({ email: 'employee@example.test', name: 'Employee', role: 'service_role' }) }, request);
  assert.equal(result.access_token, 'actual-session'); assert.equal(result.identity_email, 'employee@example.test'); assert.equal(calls.length, 3);
});
test('accepts the existing native callback without following its redirect', async () => {
  const root = await setup(); await hyperDevJwtCommand('enable', root);
  const result = await hyperDevJwtCommand('exchange', root, { jwt: jwt({ sub: 'one' }) }, async (url) => {
    if (url.endsWith('generate_link')) return Response.json({ action_link: 'http://dev.example.test:8080/verify?token=synthetic' });
    if (url.includes('/verify?')) return new Response(null, { status: 303, headers: { location: 'appflowy-flutter://login-callback#access_token=actual-session&refresh_token=actual-refresh&expires_in=7200' } });
    return Response.json({ email: hyperDecodeDevelopmentJwt(jwt({ sub: 'one' })).email });
  });
  assert.equal(result.access_token, 'actual-session');
});

test('never follows a generated authentication link to another server', async () => {
  const root = await setup(); await hyperDevJwtCommand('enable', root);
  let calls = 0;
  await assert.rejects(hyperDevJwtCommand('exchange', root, { jwt: jwt({ sub: 'one' }) }, async () => { calls++; return Response.json({ action_link: 'http://elsewhere.test/verify?token=synthetic' }); }), /unexpected deployment/);
  assert.equal(calls, 1);
});
