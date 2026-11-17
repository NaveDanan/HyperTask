import { expect, it, vi } from 'vitest';
import { SettingsError } from './settings-error';
import { HyperBotsToolError } from './HyperBotsRuntime';
import { HyperBotsTools, hyperBotsConnections, hyperBotsJiraBinding, hyperBotsJiraTool, hyperBotsOutlookTool, hyperBotsReadJira, type HyperBotsJiraAccess } from './HyperBotsConnectors';

const event = (subject: string, start: string, extra: object = {}) => ({
  id: 'AB', subject, start, end: new Date(Date.parse(start) + 3600000).toISOString(), allDay: false, location: 'Room 1', body: 'x'.repeat(400),
  organizer: 'Dana', isOrganizer: false, responseStatus: 0, attendeeCount: 25, busyStatus: 2, isRecurring: false, recurrenceState: 0, isCancelled: false, isPrivate: false, joinUrl: null, lastModified: '2026-11-01T00:00:00Z',
  attendees: Array.from({ length: 25 }, (_, i) => ({ name: `P${i}`, email: `p${i}@corp.example`, type: 1, response: 0 })), ...extra,
});
const signal = new AbortController().signal;
const failsWith = async (run: Promise<unknown>, kind: string, pattern?: RegExp) => {
  const error = await run.then(() => null, e => e);
  expect(error).toBeInstanceOf(HyperBotsToolError);
  expect((error as HyperBotsToolError).kind).toBe(kind);
  if (pattern) expect((error as Error).message).toMatch(pattern);
  return error as Error;
};

it('outlook_list_events validates args strictly and reads a sorted, compact calendar', async () => {
  const request = vi.fn(async () => [event('Late', '2026-11-18T10:00:00Z'), event('Early', '2026-11-17T09:00:00Z', { body: '' })]);
  const tool = hyperBotsOutlookTool({ request } as never);
  expect(tool.access).toBe('read');
  for (const args of [{ start: '2026-11-17T00:00:00Z' }, { start: '2026-11-17T00:00:00Z', end: '2026-11-16T00:00:00Z' }, { start: '2026-11-01T00:00:00Z', end: '2026-12-05T00:00:00Z' },
    { start: '2026-11-17', end: '2026-11-18' }, { start: '2026-11-17T00:00:00Z', end: '2026-11-18T00:00:00Z', max: 51 }, { start: '2026-11-17T00:00:00Z', end: '2026-11-18T00:00:00Z', extra: 1 }]) {
    expect(() => tool.parse(args)).toThrow(HyperBotsToolError);
  }
  const args = tool.parse({ start: '2026-11-17T00:00:00Z', end: '2026-11-19T00:00:00+02:00' });
  expect(args).toEqual({ start: '2026-11-17T00:00:00.000Z', end: '2026-11-18T22:00:00.000Z', max: 20 });
  const rows = await tool.run(args, signal) as any[];
  expect(request).toHaveBeenCalledWith('list', { start: '2026-11-17T00:00:00.000Z', end: '2026-11-18T22:00:00.000Z' });
  expect(rows.map(r => r.subject)).toEqual(['Early', 'Late']);
  expect(rows[0]).not.toHaveProperty('preview');
  expect(rows[1]).toMatchObject({ allDay: false, location: 'Room 1', organizer: 'Dana', attendees: expect.arrayContaining(['P0 <p0@corp.example>']) });
  expect(rows[1].attendees).toHaveLength(20);
  expect(rows[1].preview.length).toBeLessThanOrEqual(301);
  expect(await tool.run(tool.parse({ start: '2026-11-17T00:00:00Z', end: '2026-11-19T00:00:00Z', max: 1 }), signal)).toHaveLength(1);
  request.mockRejectedValueOnce(new SettingsError('unsupported', 'Classic Outlook for Windows is required.'));
  await failsWith(tool.run(args, signal), 'refused', /Classic Outlook/);
});

const ACCESS: HyperBotsJiraAccess = { userId: '42', baseUrl: 'https://jira.corp.example/jira', projectKey: 'OPS', authType: 'personalAccessToken', username: '', authorization: 'Bearer pat-secret-123' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function jira(fetch: (...args: any[]) => Promise<Response>, access: HyperBotsJiraAccess = ACCESS) {
  const spy = vi.fn(fetch);
  return { spy, tool: hyperBotsJiraTool({ access: async () => access, fetch: spy as never, timeoutMs: 1000 }) };
}

it('jira_create_issue posts the exact request to the configured project only', async () => {
  const { spy, tool } = jira(async () => json(201, { id: '1', key: 'OPS-7' }));
  expect(tool.access).toBe('write');
  expect(() => tool.parse({ summary: 'x', projectKey: 'OTHER' })).toThrow(HyperBotsToolError);
  for (const args of [{}, { summary: '' }, { summary: 'a\nb' }, { summary: 'x'.repeat(256) }, { summary: 'x', labels: Array(11).fill('a') }, { summary: 'x', labels: ['has space'] }, { summary: 'x', description: 'd'.repeat(20001) }]) {
    expect(() => tool.parse(args)).toThrow(HyperBotsToolError);
  }
  const args = tool.parse({ summary: 'Fix login', description: 'Details', labels: ['bots'] });
  expect(tool.summarize(args)).toBe('Create Jira Task: "Fix login"');
  expect(await tool.run(args, signal)).toEqual({ key: 'OPS-7', url: 'https://jira.corp.example/jira/browse/OPS-7' });
  const [url, init] = spy.mock.calls[0]!;
  expect(url).toBe('https://jira.corp.example/jira/rest/api/2/issue');
  expect(init).toMatchObject({ method: 'POST', redirect: 'manual', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer pat-secret-123', 'X-Atlassian-Token': 'no-check', 'user-agent': 'HyperTask' } });
  expect(JSON.parse(init.body)).toEqual({ fields: { project: { key: 'OPS' }, summary: 'Fix login', issuetype: { name: 'Task' }, description: 'Details', labels: ['bots'] } });
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

it('jira refusals are refused, lost requests are transport, never retried and never leak the secret', async () => {
  let h = jira(async () => json(400, { errorMessages: ['Bad pat-secret-123'], errors: { summary: 'required' } }));
  let error = await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'refused', /HTTP 400.*Bad \[redacted\]; summary: required/);
  expect(error.message).not.toContain('pat-secret-123');
  expect(h.spy).toHaveBeenCalledTimes(1);
  h = jira(async () => new Response(null, { status: 302, headers: { location: 'https://sso.example/login' } }));
  await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'refused', /SSO or login redirect/);
  h = jira(async () => { throw new TypeError('fetch failed: connect ECONNRESET Bearer pat-secret-123'); });
  error = await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'transport', /Jira request failed/);
  expect(error.message).not.toContain('pat-secret-123');
  expect(h.spy).toHaveBeenCalledTimes(1);
  h = jira(async () => { throw new TypeError('Invalid header value: "Basic dXNlcjpzM2NyZXQhIQ=="'); }, { ...ACCESS, authorization: 'Basic ' + Buffer.from('user:s3cret!!').toString('base64') });
  error = await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'transport', /headers were rejected/);
  expect(error.message).not.toMatch(/dXNlcjpzM2NyZXQhIQ|s3cret/);
  h = jira((_url, init) => new Promise((_, reject) => { if (init.signal.aborted) reject(init.signal.reason); init.signal.addEventListener('abort', () => reject(init.signal.reason)); }));
  const controller = new AbortController();
  const pending = h.tool.run(h.tool.parse({ summary: 'x' }), controller.signal);
  await vi.waitFor(() => expect(h.spy).toHaveBeenCalled());
  controller.abort(new Error('stopped'));
  await failsWith(pending, 'transport');
  const stopped = new AbortController();
  stopped.abort();
  h = jira(async () => json(201, { key: 'OPS-1' }));
  await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), stopped.signal), 'refused', /before the Jira request was sent/);
  expect(h.spy).not.toHaveBeenCalled();
  h = jira(async () => new Response('<html>ok</html>', { status: 200 }));
  await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'transport', /no issue key/);
});

it('a jira 5xx (gateway timeout, server error) is an unknown outcome, not a refusal; 4xx stays refused', async () => {
  for (const status of [500, 502, 504]) {
    const h = jira(async () => json(status, { errorMessages: ['upstream pat-secret-123 timeout'] }));
    const error = await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'transport', new RegExp(`HTTP ${status}.*may have been created`));
    expect(error.message).not.toContain('pat-secret-123');
    expect(h.spy).toHaveBeenCalledTimes(1);
  }
  const h = jira(async () => json(429, { errorMessages: ['slow down'] }));
  await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'refused', /HTTP 429/);
});

it('hyperBotsReadJira mirrors the Jira tab settings and credential account id', async () => {
  const values: Record<string, unknown> = { 'hypertask.jira.42.config': JSON.stringify({ baseUrl: ' jira.corp.example/jira/ ', projectKey: ' ops ', authType: 'basic', username: 'dana' }) };
  const prefs = { get: vi.fn(async (key: string) => values[key]) };
  const credentials = { read: vi.fn(async (id: string) => id === '42|https://jira.corp.example/jira|OPS|basic|dana' ? { username: 'dana', secret: 'tok' } : null) };
  expect(await hyperBotsReadJira(prefs, credentials, '42')).toEqual({ userId: '42', baseUrl: 'https://jira.corp.example/jira', projectKey: 'OPS', authType: 'basic', username: 'dana', authorization: 'Basic ' + Buffer.from('dana:tok').toString('base64') });
  values['hypertask.jira.42.config'] = { baseUrl: 'https://jira.corp.example/jira', projectKey: 'OPS', username: '' };
  credentials.read.mockImplementation(async (id: string) => id === '42|https://jira.corp.example/jira|OPS|personalAccessToken|' ? { username: '', secret: 'pat' } : null);
  expect((await hyperBotsReadJira(prefs, credentials, '42')).authorization).toBe('Bearer pat');
  await expect(hyperBotsReadJira(prefs, credentials, '7')).rejects.toThrow('Set up Jira in the Jira tab (URL, project and token).');
  credentials.read.mockResolvedValue(null);
  await expect(hyperBotsReadJira(prefs, credentials, '42')).rejects.toThrow('Set up Jira in the Jira tab');
});

it('the registry keeps tools by name and gives specs in the requested order', () => {
  const outlook = hyperBotsOutlookTool({ request: vi.fn() } as never), jiraTool = jira(async () => json(201, {})).tool;
  const tools = new HyperBotsTools([outlook, jiraTool]);
  expect(tools.get('jira_create_issue')).toBe(jiraTool);
  expect(tools.get('nope')).toBeUndefined();
  expect(tools.specs(['jira_create_issue', 'nope', 'outlook_list_events']).map(s => s.function.name)).toEqual(['jira_create_issue', 'outlook_list_events']);
  expect(() => new HyperBotsTools([outlook, outlook])).toThrow(/Duplicate/);
});

it('connections are checked independently, bounded, and say where to fix them', async () => {
  const ok = await hyperBotsConnections({
    endpoint: async () => ({ baseUrl: 'https://ai.example/v1', apiKey: 'k', defaultModel: 'gpt-x' }),
    outlook: { request: vi.fn(async () => ({ available: true, userName: 'Dana', email: 'dana@corp.example' })) } as never,
    jira: async () => ACCESS,
  });
  expect(ok).toEqual({
    model: { ready: true, detail: 'gpt-x at https://ai.example/v1', defaultModel: 'gpt-x' },
    outlook: { ready: true, detail: 'Classic Outlook is available' },
    jira: { ready: true, detail: 'OPS at https://jira.corp.example/jira', projectKey: 'OPS' },
  });
  const bad = await hyperBotsConnections({
    endpoint: async () => { throw new Error('No endpoint file.'); },
    outlook: { request: vi.fn(() => new Promise(() => {})) } as never,
    jira: async () => { throw new Error('Set up Jira in the Jira tab (URL, project and token).'); },
  }, 50);
  expect(bad.model).toMatchObject({ ready: false, problem: expect.stringContaining('Settings → AI') });
  expect(bad.outlook).toMatchObject({ ready: false, problem: expect.stringContaining('Classic Outlook') });
  expect(bad.jira).toEqual({ ready: false, problem: 'Set up Jira in the Jira tab (URL, project and token).' });
});

// Audit #10: the status check is the approved exception; it may say Outlook answers, never who the owner is.
it('audit #10: the Outlook connection check exposes availability only, never the owner name or address', async () => {
  const request = vi.fn(async () => ({ available: true, userName: 'Dana Owner', email: 'dana@corp.example' }));
  const result = await hyperBotsConnections({ endpoint: async () => ({ baseUrl: 'https://ai.example/v1', apiKey: 'k', defaultModel: 'gpt-x' }), outlook: { request } as never, jira: async () => ACCESS });
  expect(request.mock.calls).toEqual([['status', undefined]]);
  expect(result.outlook).toEqual({ ready: true, detail: 'Classic Outlook is available' });
  expect(JSON.stringify(result)).not.toMatch(/Dana|dana@corp/);
});

// Audit #8: redaction happens before clipping, for every credential form.
it('audit #8: a Jira error whose token crosses the 500-character clip leaks no prefix of it', async () => {
  for (const status of [400, 502]) {
    const h = jira(async () => json(status, { errorMessages: ['x'.repeat(490) + 'pat-secret-123 trailing'] }));
    const error = await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), status === 400 ? 'refused' : 'transport');
    expect(error.message).not.toMatch(/pat-s|secret-1/);
    expect(error.message).toContain('[redac');
  }
  const h = jira(async () => new Response('y'.repeat(495) + 'pat-secret-123', { status: 418 }));
  expect((await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), 'refused')).message).not.toMatch(/pat-s/);
});

it('audit #8: Basic credentials are redacted as the header value, the base64 credential and the raw secret', async () => {
  const basic = 'Basic ' + Buffer.from('dana:s3cr"et!!').toString('base64'), b64 = basic.slice(6);
  const echo = `auth=${basic}; cred=${b64}; raw=s3cr"et!!; json=${JSON.stringify('s3cr"et!!')}; url=${encodeURIComponent('s3cr"et!!')}`;
  const cases: Array<[string, () => Promise<Response>]> = [['refused', async () => json(401, { errorMessages: [echo] })], ['transport', async () => { throw new TypeError(`connect ECONNRESET ${echo}`); }]];
  for (const [kind, fetch] of cases) {
    const h = jira(fetch, { ...ACCESS, authType: 'basic', username: 'dana', authorization: basic });
    const error = await failsWith(h.tool.run(h.tool.parse({ summary: 'x' }), signal), kind);
    expect(error.message).not.toMatch(/s3cr|ZGFuYTpzM2Ny/);
  }
});

// Audit #4: what the owner approves is the account, server and project; the write goes exactly there.
it('audit #4: jira bind names the destination, fingerprints it without the secret, and the run uses what was bound', async () => {
  let current: HyperBotsJiraAccess = ACCESS;
  const spy = vi.fn(async () => json(201, { key: 'OPS-9' }));
  const tool = hyperBotsJiraTool({ access: async () => current, fetch: spy as never });
  const args = tool.parse({ summary: 'Fix login' });
  const first = await tool.bind(args, signal);
  expect(first.destination).toBe('Jira project OPS at https://jira.corp.example/jira as token');
  expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(first.fingerprint).not.toContain('pat-secret');
  // A rotated token for the same account and project is the same destination.
  current = { ...ACCESS, authorization: 'Bearer rotated-999' };
  expect((await tool.bind(args, signal)).fingerprint).toBe(first.fingerprint);
  // A different project, server, account or HyperTask user is a different destination.
  for (const change of [{ projectKey: 'SEC' }, { baseUrl: 'https://other.example' }, { authType: 'basic' as const, username: 'eve' }, { userId: '7' }]) {
    current = { ...ACCESS, ...change };
    expect((await tool.bind(args, signal)).fingerprint).not.toBe(first.fingerprint);
  }
  // Bound to OPS; the Jira tab then switches to SEC before run(): the write still goes to the bound destination.
  current = ACCESS;
  await tool.bind(args, signal);
  current = { ...ACCESS, projectKey: 'SEC', authorization: 'Bearer other-user' };
  await tool.run(args, signal);
  const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body)).fields.project).toEqual({ key: 'OPS' });
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer pat-secret-123');
  // Without a fresh bind, run() resolves the access again.
  await tool.run(args, signal);
  expect(JSON.parse(String((spy.mock.calls[1] as unknown as [string, RequestInit])[1].body)).fields.project).toEqual({ key: 'SEC' });
  await expect(hyperBotsJiraTool({ access: async () => { throw new Error('Set up Jira in the Jira tab (URL, project and token).'); } }).bind(args, signal)).rejects.toThrow(/Set up Jira/);
  expect(await hyperBotsOutlookTool({ request: vi.fn() } as never).bind({}, signal)).toEqual({ destination: 'Outlook calendar on this PC', fingerprint: 'outlook:local-classic' });
});

it('audit #4: hyperBotsReadJira binds each account to its own Jira settings and destination', async () => {
  const values: Record<string, unknown> = {
    'hypertask.jira.1.config': { baseUrl: 'https://a.example', projectKey: 'AAA', username: '' },
    'hypertask.jira.2.config': { baseUrl: 'https://b.example', projectKey: 'BBB', username: '' },
  };
  const prefs = { get: async (key: string) => values[key] };
  const credentials = { read: async (id: string) => ({ username: '', secret: 'tok-' + id.split('|')[0] }) };
  const a = await hyperBotsReadJira(prefs, credentials, '1'), b = await hyperBotsReadJira(prefs, credentials, '2');
  expect([a.authorization, b.authorization]).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  expect(hyperBotsJiraBinding(a).destination).toBe('Jira project AAA at https://a.example as token');
  expect(hyperBotsJiraBinding(a).fingerprint).not.toBe(hyperBotsJiraBinding(b).fingerprint);
});
