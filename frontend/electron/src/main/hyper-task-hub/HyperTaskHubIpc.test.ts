import { expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { net, safeStorage, dialog, BrowserWindow } from 'electron';
import { UserProfilePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/hyper-folder/workspace_pb';
import type { HyperHubSnapshot } from '@shared/HyperTaskHub';
import { HyperTaskHubChannel as C } from '@shared/HyperTaskHub';
import { disk, setup } from './HyperTaskHub.test-support';
const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => Promise<unknown>>());
vi.mock('electron', () => ({ ipcMain: { handle: (k: string, fn: never) => handlers.set(k, fn) }, safeStorage: {}, net: {}, shell: {}, dialog: { showMessageBox: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() } }));
import { registerHyperTaskHubIpc } from './HyperTaskHubIpc';

it('checks sender and schema on every live channel before reading an identity', async () => {
  const sender = { mainFrame: {} };
  const options = { directory: '', window: () => ({ webContents: sender }) as never, request: vi.fn(), prefs: { get: vi.fn() }, credentials: { read: vi.fn() } };
  registerHyperTaskHubIpc(options);
  expect([...handlers.keys()].sort()).toEqual(Object.values(C).filter(c => c !== C.Snapshot).sort());
  for (const [channel, fn] of handlers) {
    const rejection = channel === C.ApproveStatus ? { outcome: 'failed' } : { ok: false };
    expect(await fn({ sender, senderFrame: {} }, undefined)).toMatchObject({ ...rejection, code: 'access-denied' });
    expect(await fn({ sender, senderFrame: sender.mainFrame }, { arbitrary: 'input' })).toMatchObject({ ...rejection, code: 'invalid' });
  }
  expect(options.request).not.toHaveBeenCalled();
  const v = { scopeGeneration: 0, expectedRevision: 0 };
  const weights = { age: 10, unblocking: 20, importance: 25, slack: 45 };
  const valid = [
    [C.PreviewStatus, { ...v, intent: { kind: 'choose' }, handle: 'opaque' }],
    [C.ApproveStatus, { previewId: 'preview', candidateId: 'candidate' }],
    [C.DiscardStatus, { previewId: 'preview' }], [C.ReleaseHold, { ...v, operationId: 'op' }],
    [C.PreviewWeights, { ...v, seq: 1, draft: weights }], [C.SaveWeights, { ...v, weights }],
    [C.PreviewMirror, { ...v, taskId: '71b1b822-1e1b-428a-9bbc-000000000031' }], [C.ApplyMirror, { token: 'token' }],
  ] as const;
  for (const [channel, args] of valid) {
    expect(await handlers.get(channel)!({ sender, senderFrame: sender.mainFrame }, args)).toEqual({
      ...(channel === C.ApproveStatus ? { outcome: 'failed' } : { ok: false }),
      code: 'unavailable', revision: 0, scopeGeneration: 0,
    });
  }
  expect(options.request).toHaveBeenCalledTimes(valid.length);
});

it('routes setup options, day feedback and Focus visibility through the live registry', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now: new Date('2026-11-29T07:00Z') }); onTestFinished(() => { vi.useRealTimers(); });
  const d = disk(); onTestFinished(d.cleanup);
  Object.assign(safeStorage, d.encryption);
  const sender = { mainFrame: {}, send: vi.fn() }, event = { sender, senderFrame: sender.mainFrame };
  const calendar = vi.fn(async (op: string, value?: { start: string; end: string; storeId: string }) =>
    op === 'hub.store' ? 'AA' : { ...value, exhausted: true, completeness: 'complete', events: [] });
  let active = true;
  const hub = registerHyperTaskHubIpc({ window: () => ({ webContents: sender }) as never, directory: d.directory,
    active: () => active, outlookAvailable: () => true, outlook: { request: calendar as never },
    request: async name => ({ status: 0, payload: name === 'GetUserProfile'
      ? toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 42n }))
      : toBinary(WorkspaceLatestPBSchema, create(WorkspaceLatestPBSchema, { workspaceId: 'workspace' })) }),
    prefs: { get: async () => null }, credentials: { read: async () => null } });
  const invoke = (channel: string, input?: unknown) => handlers.get(channel)!(event, input);
  const snapshot = () => invoke(C.GetSnapshot) as Promise<HyperHubSnapshot>;
  const version = (s: HyperHubSnapshot) => ({ scopeGeneration: s.scopeGeneration, expectedRevision: s.revision });
  expect(await invoke(C.GetSetupOptions)).toMatchObject({ outlook: { available: true }, newsletter: { configured: false, projects: [] } });
  expect(calendar).not.toHaveBeenCalled();
  await invoke(C.SetSetupScope, { ...version(await snapshot()), scope: { ...setup, nativeViews: [], jiraProjects: [], outlookCalendar: true } });
  const first = await snapshot();
  const calls = () => calendar.mock.calls.filter(([op]) => op === 'hub.calendar').length;
  expect(calls()).toBe(1);
  const day = first.day!.date;
  const ack = await invoke(C.SendFeedback, { ...version(first), type: 'declare-availability', day, windows: first.day!.working }) as { ledgerEntryId: string };
  expect(await invoke(C.SendFeedback, { ...version(await snapshot()), type: 'undo', day, ledgerEntryId: ack.ledgerEntryId })).toMatchObject({ ok: true });
  await invoke(C.SetFocusVisible, true);
  hub.wakeOutlook();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls()).toBe(2);
  await invoke(C.SetFocusVisible, false);
  await vi.advanceTimersByTimeAsync(240_000);
  expect(calls()).toBe(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls()).toBe(3);
  active = false;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(calls()).toBe(3);
  hub.invalidate();
});

it('binds refresh to the main-derived account and clears the projection before a native switch', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  Object.assign(safeStorage, d.encryption);
  let userId = 42n;
  const request = vi.fn(async (event: string) => {
    if (event === 'GetUserProfile') return { status: 0, payload: toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: userId })) };
    if (event === 'GetCurrentWorkspaceSetting') return { status: 0, payload: toBinary(WorkspaceLatestPBSchema, create(WorkspaceLatestPBSchema, { workspaceId: 'w' })) };
    throw Error(event);
  });
  const sender = { mainFrame: {}, send: vi.fn() }, event = { sender, senderFrame: sender.mainFrame };
  const hub = registerHyperTaskHubIpc({ window: () => ({ webContents: sender }) as never, directory: d.directory, request,
    prefs: { get: async () => ({ baseUrl: 'https://jira.example/context', projectKey: 'ENG' }) },
    credentials: { read: async () => ({ username: '', secret: 'example-token' }) } });
  const invoke = (channel: string, input?: unknown) => handlers.get(channel)!(event, input);
  const snapshot = () => invoke(C.GetSnapshot) as Promise<HyperHubSnapshot>;
  const version = (s: HyperHubSnapshot) => ({ scopeGeneration: s.scopeGeneration, expectedRevision: s.revision });
  const seed = await snapshot();
  await invoke(C.SetSetupScope, { ...version(seed), scope: { ...setup, nativeViews: [] } });
  let finish!: (r: Response) => void, entered!: () => void;
  const fetching = new Promise<void>(resolve => { entered = resolve; });
  net.fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/myself')) return Response.json({ key: 'me' });
    entered(); return new Promise<Response>(resolve => { finish = resolve; });
  });
  const initial = await snapshot();
  const pending = invoke(C.Refresh, version(initial));
  await fetching;
  const end = hub.begin('SignOut');
  expect(sender.send.mock.calls.at(-1)?.[1]).toMatchObject({ tasks: [], revision: 0 });
  userId = 53n; end();
  const switched = await snapshot();
  expect(switched.scopeGeneration).toBeGreaterThan(initial.scopeGeneration);
  expect(switched.sources).toEqual([]);
  finish(Response.json({ issues: [], total: 0 }));
  expect(await pending).toMatchObject({ ok: false, code: 'scope-changed' });
  const back = hub.begin('InitUser'); userId = 42n; back();
  const restored = await snapshot();
  expect(restored.revision).toBe(initial.revision);
  expect(restored.sources[0].lastSuccess).toBeNull();
});

it('keeps an encrypted issue across a session-token restart, then purges it on explicit disconnect', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  Object.assign(safeStorage, d.encryption);
  const sender = { mainFrame: {}, send: vi.fn() }, event = { sender, senderFrame: sender.mainFrame };
  let connected = true;
  const opts = { directory: d.directory, window: () => ({ webContents: sender }) as never,
    request: async (name: string) => ({ status: 0, payload: name === 'GetUserProfile'
      ? toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 42n }))
      : toBinary(WorkspaceLatestPBSchema, create(WorkspaceLatestPBSchema, { workspaceId: 'workspace' })) }),
    prefs: { get: async () => ({ baseUrl: 'https://jira.example', projectKey: 'ENG' }) },
    credentials: { isPersistent: false, read: async () => connected ? { username: '', secret: 'example-token' } : null } };
  const first = registerHyperTaskHubIpc(opts);
  const invoke = (channel: string, input?: unknown) => handlers.get(channel)!(event, input);
  const bootstrap = () => invoke(C.GetSnapshot) as Promise<HyperHubSnapshot>;
  const version = (s: HyperHubSnapshot) => ({ scopeGeneration: s.scopeGeneration, expectedRevision: s.revision });
  net.fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/myself') ? { key: 'me' } : {
    total: 1, issues: [{ id: '15', key: 'ENG-15', fields: { summary: 'Cached title', status: { name: 'Open' },
      updated: '2026-11-01', assignee: { key: 'me' } } }] }));
  await invoke(C.SetSetupScope, { ...version(await bootstrap()), scope: { ...setup, nativeViews: [] } });
  expect(await invoke(C.Refresh, version(await bootstrap()))).toMatchObject({ tasks: [{ title: 'Cached title' }] });
  first.invalidate();
  connected = false;
  const restarted = registerHyperTaskHubIpc(opts);
  const cached = await bootstrap();
  expect(cached.tasks).toMatchObject([{ title: 'Cached title' }]);
  expect(await invoke(C.Refresh, version(cached))).toMatchObject({ tasks: [{ title: 'Cached title' }], sources: [{ status: 'error' }] });
  await restarted.connectionChanged();
  expect((await bootstrap()).tasks).toEqual([]);
});

it('keeps mail idle without confirmation and purges excerpts when the verified profile changes', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now: new Date('2026-11-29T07:00Z') }); onTestFinished(() => { vi.useRealTimers(); });
  const d = disk(); onTestFinished(d.cleanup);
  Object.assign(safeStorage, d.encryption);
  const sender = { mainFrame: {}, send: vi.fn() }, event = { sender, senderFrame: sender.mainFrame };
  const iso = new Date().toISOString();
  let activeStore = 'AA';
  const outlook = vi.fn(async (op: string, args?: { headerOnly?: boolean }) => {
    if (op === 'hub.store') return activeStore;
    if (op === 'hub.mailHeaders') return { storeId: activeStore, complete: true, exhausted: true, next: null,
      replyCoverage: true, excludedIds: [], headers: [{ entryId: '11', visibility: 'public', modified: iso, authoredAt: iso, flag: 'unknown' }] };
    if (op === 'hub.mailDetail') return { storeId: activeStore, entryId: '11', visibility: 'public', modified: iso, subject: 'Budget',
      body: args?.headerOnly ? '' : 'Please review the budget.', to: ['Yael'], sender: 'Colleague', distributionList: false };
    throw Error(op);
  });
  const options = { directory: d.directory, window: () => ({ webContents: sender }) as never, outlookAvailable: () => true,
    outlook: { request: outlook as never }, request: async (name: string) => ({ status: 0, payload: name === 'GetUserProfile'
      ? toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 42n }))
      : toBinary(WorkspaceLatestPBSchema, create(WorkspaceLatestPBSchema, { workspaceId: 'workspace' })) }),
    prefs: { get: async () => null }, credentials: { read: async () => null } };
  const first = registerHyperTaskHubIpc(options);
  const invoke = (channel: string, input?: unknown) => handlers.get(channel)!(event, input);
  const snapshot = () => invoke(C.GetSnapshot) as Promise<HyperHubSnapshot>;
  const version = (s: HyperHubSnapshot) => ({ scopeGeneration: s.scopeGeneration, expectedRevision: s.revision });
  const choices = { ...setup, aliases: ['Yael'], jiraProjects: [], nativeViews: [] };
  expect(await invoke(C.GetSetupOptions)).toMatchObject({ mailbox: { available: true, flagsVerified: false } });
  for (const mail of [null, { enabled: true, folders: ['inbox'] }, { enabled: false, folders: ['sent'], confirmedAt: { kind: 'instant', iso } }]) {
    await invoke(C.SetSetupScope, { ...version(await snapshot()), scope: { ...choices, mail } });
    await invoke(C.Refresh, version(await snapshot()));
    await vi.advanceTimersByTimeAsync(300000);
  }
  expect(outlook).not.toHaveBeenCalled();
  const confirmed = { enabled: true, folders: ['inbox'], confirmedAt: { kind: 'instant', iso: new Date().toISOString() } };
  expect(await invoke(C.SetSetupScope, { ...version(await snapshot()), scope: { ...choices, mail: confirmed } })).toMatchObject({ scope: { mail: confirmed } });
  expect(await invoke(C.Refresh, version(await snapshot()))).toMatchObject({ tasks: [{ title: 'Please review the budget.', state: 'review' }] });
  first.invalidate();
  activeStore = 'BB';
  registerHyperTaskHubIpc(options);
  expect((await snapshot()).tasks).toEqual([]);
  expect(await invoke(C.GetSetupScope)).toMatchObject({ scope: { mail: null } });
  const count = outlook.mock.calls.filter(([op]) => op === 'hub.mailHeaders').length;
  await invoke(C.Refresh, version(await snapshot()));
  expect(outlook.mock.calls.filter(([op]) => op === 'hub.mailHeaders')).toHaveLength(count);
});

it('binds the live status channels to the originating window and native response', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup); Object.assign(safeStorage,d.encryption);
  const sender = { mainFrame: {}, send: vi.fn() }, window = { webContents: sender } as never;
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window);
  const event = { sender, senderFrame: sender.mainFrame };
  const principal = { accountId:'account',displayName:'Owner' };
  const open = { id:'open', name:'Open', statusCategory:{key:'new'} }, done = { id:'done',name:'Done',statusCategory:{key:'done'} };
  const issue = { id:'1',key:'ENG-1',fields:{summary:'Review release',updated:'v1',assignee:principal,reporter:null,project:{key:'ENG'},status:open} };
  const sends: unknown[] = [];
  net.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/myself')) return Response.json(principal);
    if (url.endsWith('/search')) return Response.json({startAt:0,total:1,issues:[issue]});
    if (url.endsWith('/transitions?expand=transitions.fields')) return Response.json({ transitions:[{id:'finish',name:'Finish',to:done,fields:{}}] });
    if (url.endsWith('/issue/1/transitions')) { sends.push([url, init?.method,init?.body]); issue.fields.status = done; issue.fields.updated='v2'; return new Response(null,{status:204}); }
    if (url.includes('/issue/1?fields=')) return Response.json(issue);
    throw Error('Unexpected transport');
  });
  const hub = registerHyperTaskHubIpc({ window:()=>window, directory:d.directory,
    prefs:{get:async()=>({baseUrl:'https://jira.invalid',projectKey:'ENG'})}, credentials:{read:async()=>({username:'',secret:'test-only-secret'})},
    request:async name=>({status:0,payload:name === 'GetUserProfile' ? toBinary(UserProfilePBSchema,create(UserProfilePBSchema,{id:9n})) :
      toBinary(WorkspaceLatestPBSchema,create(WorkspaceLatestPBSchema,{workspaceId:'workspace'}))}) });
  onTestFinished(()=>hub.invalidate());
  const invoke = (c:string,v?:unknown) => handlers.get(c)!(event,v);
  const snapshot = () => invoke(C.GetSnapshot) as Promise<HyperHubSnapshot>;
  const version = (s:HyperHubSnapshot) => ({scopeGeneration:s.scopeGeneration,expectedRevision:s.revision});
  await invoke(C.SetSetupScope,{...version(await snapshot()),scope:{...setup,nativeViews:[],writeBack:{jira:true,newsletter:false}}});
  const loaded = await invoke(C.Refresh,version(await snapshot())) as HyperHubSnapshot;
  expect(loaded.tasks[0].sources[0].statusWrite).toEqual({available:true,code:undefined});
  const preview = async () => {
    const s = await snapshot();
    const reply = await invoke(C.PreviewStatus,{...version(s),handle:s.tasks[0].sources[0].handle,intent:{kind:'choose'}}) as {preview:{previewId:string}};
    return {previewId:reply.preview.previewId,candidateId:'finish'};
  };
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response:0,checkboxChecked:false }).mockResolvedValueOnce({response:1,checkboxChecked:false});
  expect(await invoke(C.ApproveStatus,await preview())).toMatchObject({outcome:'cancelled'});
  expect(sends).toEqual([]);
  expect(await invoke(C.ApproveStatus,await preview())).toMatchObject({outcome:'succeeded',write:{state:'succeeded',held:false}});
  expect(dialog.showMessageBox).toHaveBeenCalledWith(window,expect.objectContaining({buttons:['Cancel','Change in Jira'],defaultId:0,cancelId:0,noLink:true}));
  expect(sends).toEqual([['https://jira.invalid/rest/api/2/issue/1/transitions','POST','{"transition":{"id":"finish"}}']]);
});
