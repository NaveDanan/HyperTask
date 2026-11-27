import { expect, it, onTestFinished, vi } from 'vitest';
import { disk, setup } from './HyperTaskHub.test-support';
import { HyperHubJiraStatusWriter } from './HyperHubJiraStatusWriter';
import { HyperHubNewsletterStatusWriter } from './HyperHubNewsletterStatusWriter';
import { HyperTaskHubWriteback, type HyperHubDocument } from './HyperTaskHubWriteback';
import type { HyperHubStatusIntent, HyperHubWriteSource } from '@shared/HyperTaskHub';
import type { HyperHubWriteTarget } from './HyperHubStatusWriter';
import { hyperHubHash } from './HyperTaskHubStore';

function scenario(source: HyperHubWriteSource = 'newsletter') {
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open(), connection = { baseUrl: 'https://fixture.invalid', authorization: 'Bearer fixture' };
  const person = { accountId: 'me', displayName: 'Owner' };
  const project = { id: 'p', title: 'Project', updated: '1', gantt: { tasks: [
    { id: 't', name: 'Title\n\u202E' + 'x'.repeat(300), resourceId: 'r', status: 'pending', progress: 20, indentLevel: 0 },
    { id: 'sibling', name: 'Other', resourceId: 'other', status: 'pending', progress: 0, indentLevel: 0 },
    { id: 'child', name: 'Child', resourceId: 'other', status: 'pending', progress: 0, indentLevel: 1 },
  ] } };
  const status = (done: boolean) => done ? { id: '2', name: 'Done', statusCategory: { key: 'done' } } :
    { id: '1', name: 'Open', statusCategory: { key: 'new' } };
  const issue = { id: '123', key: 'ENG-2', fields: { project: { key: 'ENG' }, summary: 'Issue', assignee: person, reporter: null,
    updated: '1', status: status(false) } };
  const rows = [{ id: 'go', name: 'Resolve', isGlobal: true, to: status(true), fields: { resolution: { required: true,
    allowedValues: [{ id: 'fix', name: 'Fixed' }] } } }, { id: 'self', name: 'Same', to: status(false), fields: {} },
    { id: 'other', name: 'Other', to: status(true), fields: { summary: { required: true, name: 'Summary' } } }];
  const state = { now: 10_000, readError: 0, writeError: 0, readbackError: false, ambiguous: false, afterWrite: () => {}, trusted: true, switched: false };
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).slice(connection.baseUrl.length), method = init!.method!, body = init!.body && JSON.parse(String(init!.body));
    calls.push({ path, method, body });
    if (method === 'GET' && state.readError) return new Response('private body', { status: state.readError });
    if (method !== 'GET') {
      state.afterWrite();
      if (state.ambiguous) { state.now += 30_000; throw new Error('timeout'); }
      if (state.writeError) return new Response('private body', { status: state.writeError });
      if (state.readbackError) state.readError = 503;
      if (source === 'jira') {
        issue.fields.status = status(true); issue.fields.updated = '2';
        return new Response(null, { status: 204 });
      }
      const row = project.gantt.tasks[0];
      row.status = body.status; if (row.status === 'completed') row.progress = 100;
      project.updated = String(+project.updated + 1);
      return Response.json(row);
    }
    if (path === '/rest/api/2/myself') return Response.json(person);
    if (path.endsWith('transitions.fields')) return Response.json({ transitions: rows });
    if (path === '/rest/api/2/issue/123?fields=summary,status,updated,project,assignee,reporter') return Response.json(issue);
    if (path === '/api/projects/p') return Response.json(project);
    throw new Error('Unexpected URL');
  };
  const writer = source === 'jira' ? new HyperHubJiraStatusWriter(connection, 'bound', fetcher) :
    new HyperHubNewsletterStatusWriter(connection, 'bound', fetcher, (p, r) => p === 'p' && r === 'r');
  const key = source === 'jira' ? { kind: 'jira' as const, instanceId: connection.baseUrl, issueId: '123' } :
    { kind: 'newsletter-task' as const, connectionId: 'newsletter', projectId: 'p', taskId: 't' };
  const target: HyperHubWriteTarget = { key, projectId: source === 'jira' ? 'ENG' : 'p', id: source === 'jira' ?
    hyperHubHash(source, 'me', connection.baseUrl, '123') : hyperHubHash(source, connection.baseUrl, 'p', 't') };
  store.commit(() => true, d => { d.setup = { ...setup, writeBack: { jira: true, newsletter: true },
    newsletterProjects: [{ connectionId: 'newsletter', projectId: 'p', resourceId: 'r' }] }; });
  const doc = { window: {}, frame: {}, trusted: () => state.trusted, confirm: vi.fn<HyperHubDocument['confirm']>(async () => true) };
  const deps = { now: () => state.now, version: () => ({ revision: store.current.revision, scopeGeneration: 1 }),
    signal: new AbortController().signal, publish: vi.fn(), writer: () => writer, validate: async () => !state.switched };
  const wb = new HyperTaskHubWriteback(store, deps);
  const preview = (intent: HyperHubStatusIntent = { kind: 'choose' }) => wb.preview(doc, intent, () => ({ target, taskId: 'card' }));
  const token = async () => { const result = await preview(); if (!result.ok) throw Error(result.code); return result.preview.previewId; };
  const approve = async (id?: string) => wb.approve(doc, id ?? await token(), source === 'jira' ? 'go' : 'completed', source === 'jira' ? 'fix' : undefined);
  const sends = () => calls.filter(c => c.method !== 'GET');
  return { d, deps, state, calls, sends, doc, target, store, wb, token, approve, preview, project, issue, rows };
}
it('writes only the status of a leaf preceding a sibling subtree, reads the project back, and reverses with a second confirmation', async () => {
  const s = scenario();
  const result = await s.approve();
  expect(result).toMatchObject({ outcome: 'succeeded', write: { undoAvailable: true, held: false, observedName: 'completed' } });
  expect(s.calls.map(c => [c.method, c.path])).toEqual([['GET','/api/projects/p'],['GET','/api/projects/p'],['PATCH','/api/projects/p/tasks/t/status'],['GET','/api/projects/p']]);
  expect(s.sends()[0].body).toEqual({ status: 'completed' });
  const box = s.doc.confirm.mock.calls[0][0];
  expect(box).toMatchObject({ buttons: ['Cancel', 'Change in Newsletter'], defaultId: 0, cancelId: 0, noLink: true });
  expect(box.message).not.toMatch(/[\n\u202E]/);
  expect(box.message).toContain('\u2068Project\u2069 · task \u2068t\u2069');
  expect(box.detail).toContain('20% → 100%');
  if (result.outcome !== 'succeeded') throw Error();
  const back = await s.preview({ kind: 'reverse', operationId: result.write.operationId });
  if (!back.ok) throw Error(back.code);
  expect(back.preview.candidates.map(c => c.to.id)).toEqual(['pending']);
  await s.wb.approve(s.doc, back.preview.previewId, 'pending');
  expect(s.doc.confirm).toHaveBeenCalledTimes(2);
  expect(s.project.gantt.tasks[0]).toMatchObject({ status: 'pending', progress: 100 });
  expect(s.sends().map(c => c.body)).toEqual([{ status: 'completed' },{ status: 'pending' }]);
  s.project.gantt.tasks[1].indentLevel = 1;
  expect(await s.preview()).toMatchObject({ ok: false, code: 'not-leaf' });
});
it('posts only the verified Jira transition and listed Resolution after the version check', async () => {
  const s = scenario('jira'), p = await s.preview();
  if (!p.ok) throw Error();
  expect(p.preview.unavailable.map(v => v.reason)).toEqual(['self','required-fields']);
  expect(await s.wb.approve(s.doc, p.preview.previewId, 'go', 'forged')).toMatchObject({ outcome: 'failed', code: 'invalid' });
  const token = await s.token();
  expect(await s.approve(token)).toMatchObject({ outcome: 'succeeded' });
  expect(await s.approve(token)).toMatchObject({ outcome: 'expired' });
  expect(s.sends()).toEqual([{ method: 'POST', path: '/rest/api/2/issue/123/transitions', body: { transition: { id: 'go' }, fields: { resolution: { id: 'fix' } } } }]);
  expect(s.doc.confirm.mock.calls[0][0].detail).toContain('Resolution: \u2068Fixed\u2069\nJira can apply this from any status.');
  expect(s.calls.slice(-3).map(c => c.path)).toEqual(['/rest/api/2/myself','/rest/api/2/issue/123?fields=summary,status,updated,project,assignee,reporter','/rest/api/2/issue/123/transitions?expand=transitions.fields']);
});
it.each([[401,'reconnect'],[403,'forbidden'],[404,'not-found']] as const)('maps HTTP %s without response text', async (status, code) => {
  const s = scenario('jira'); s.state.writeError = status;
  expect(await s.approve()).toMatchObject({ outcome: 'failed', code });
  expect(s.wb.entries[0].view.held).toBe(false);
  s.state.readError = status;
  expect(await s.preview()).toMatchObject({ ok: false, code });
});
it.each([400,409])('rediscovers after Jira HTTP %s and issues a new token only when inputs changed', async status => {
  const s = scenario('jira'); s.state.writeError = status;
  expect(await s.approve()).toMatchObject({ outcome: 'failed', code: 'rejected' });
  s.state.afterWrite = () => { s.issue.fields.updated = '2'; };
  expect(await s.approve()).toMatchObject({ outcome: 'conflict', preview: { versionLabel: '2' } });
  expect(s.sends()).toHaveLength(2);
});
it('rejects the wrong document, expiry, navigation and connection replacement during a dialog', async () => {
  const s = scenario(), id = await s.token();
  expect(await s.wb.approve({ ...s.doc, window: {} }, id, 'completed')).toMatchObject({ code: 'access-denied' });
  s.state.now += 60_000;
  expect(await s.approve(id)).toMatchObject({ outcome: 'expired' });
  s.doc.confirm.mockImplementationOnce(async () => { s.state.trusted = false; return true; });
  expect(await s.approve()).toMatchObject({ code: 'access-denied' });
  s.state.trusted = true;
  s.doc.confirm.mockImplementationOnce(async () => { s.state.switched = true; return true; });
  expect(await s.approve()).toMatchObject({ code: 'scope-changed' });
  expect(s.sends()).toEqual([]);
});
it('opens one dialog per window and persists a claim before the final read', async () => {
  const s = scenario(), ids = await Promise.all([s.token(), s.token()]);
  let finish!: (ok: boolean) => void;
  s.doc.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = s.approve(ids[0]);
  expect(await s.approve(ids[1])).toMatchObject({ outcome: 'cancelled' });
  finish(false);
  expect(await first).toMatchObject({ outcome: 'cancelled' });
  const id = await s.token(), count = s.calls.length;
  vi.spyOn(s.store,'commit').mockImplementationOnce(() => { throw Error('Disk full'); });
  expect(await s.approve(id)).toMatchObject({ outcome: 'failed' });
  expect(s.calls).toHaveLength(count);
  s.deps.publish.mockImplementationOnce(() => { s.store.commit(() => true, d => { d.setup!.writeBack!.newsletter = false; }); });
  expect(await s.approve()).toMatchObject({ outcome: 'failed', code: 'disabled' });
  expect(s.sends()).toHaveLength(0);
});
it('keeps an ambiguous send held at 31 seconds and blocks writes after explicit owner release and a later server commit', async () => {
  const s = scenario(); s.state.ambiguous = true;
  const result = await s.approve();
  if (result.outcome !== 'unknown') throw Error();
  expect(result.write).toMatchObject({ held: true, ownerReleaseAvailable: false, undoAvailable: false });
  const id = result.write.operationId;
  expect(await s.preview()).toMatchObject({ code: 'held' });
  s.state.now += 1000;
  s.state.readError = 503;
  await s.wb.reconcile();
  expect(s.wb.entries[0].view.ownerReleaseAvailable).toBe(false);
  s.state.readError = 0;
  await s.wb.reconcile();
  expect(s.wb.entries[0].view).toMatchObject({ held: true, ownerReleaseAvailable: true, observedName: 'pending' });
  expect(await s.wb.release(s.doc, id)).toMatchObject({ ok: true, write: { held: false, state: 'unknown', undoAvailable: false } });
  s.state.now += 1000; s.project.gantt.tasks[0].status = 'completed'; s.project.updated = '2';
  await s.wb.reconcile();
  expect(await s.preview()).toMatchObject({ code: 'held' });
  expect(s.wb.entries[0].view.observedName).toBe('completed');
  expect(s.sends()).toHaveLength(1);
});
it('retains an acknowledged receipt across readback failure, restart and workspace changes, and refuses stale Undo', async () => {
  const s = scenario(); s.state.readbackError = true;
  const result = await s.approve();
  expect(result).toMatchObject({ outcome: 'succeeded', write: { held: true, readback: 'failed', undoAvailable: false } });
  const restart = new HyperTaskHubWriteback(s.d.open(), s.deps);
  expect(new HyperTaskHubWriteback(s.d.open('account','other'),s.deps).entries).toEqual([]);
  s.state.readError = 0; await restart.reconcile();
  expect(restart.entries[0].view).toMatchObject({ state: 'succeeded', held: false, undoAvailable: true });
  s.project.updated = '3';
  expect(await s.preview({ kind: 'reverse', operationId: restart.entries[0].view.operationId })).toMatchObject({ code: 'revision-conflict' });
  s.store.commit(() => true, d => { const v = Object.values(d.ledger.writes!)[0].view; Object.assign(v, { state: 'pending', held: true, undoAvailable: false }); });
  expect(new HyperTaskHubWriteback(s.d.open(), s.deps).entries[0].view).toMatchObject({ state: 'unknown', held: true });
  expect(s.sends()).toHaveLength(1);
});

it('keeps a late response in its origin partition and serializes a second workspace while the request is in flight', async () => {
  const s = scenario();
  const send = s.deps.writer().send.bind(s.deps.writer());
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const response = new Promise<void>(r => { finish = r; });
  vi.spyOn(s.deps.writer(),'send').mockImplementationOnce(async (...args) => { entered(); await response; return send(...args); });
  const pending = s.approve(); await started;
  const other = s.d.open('account','next');
  other.commit(() => true, draft => { draft.setup = structuredClone(s.store.current.setup); });
  const foreign = new HyperTaskHubWriteback(other,s.deps);
  const p = await foreign.preview(s.doc,{kind:'choose'},()=>({target:s.target,taskId:'other-card'}));
  if (!p.ok) throw Error();
  expect(await foreign.approve(s.doc,p.preview.previewId,'completed')).toMatchObject({outcome:'failed',code:'held'});
  s.state.switched = true;
  finish(); await pending;
  expect(foreign.entries).toEqual([]);
  expect(s.d.open().current.ledger.writes).toEqual(s.store.current.ledger.writes);
  expect(s.wb.entries[0].view).toMatchObject({state:'succeeded',held:true});
  expect(s.sends()).toHaveLength(1);
});
