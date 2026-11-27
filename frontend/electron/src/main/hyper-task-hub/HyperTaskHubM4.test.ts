import { expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { HyperHubSnapshot, HyperTaskHubBriefApi } from '@shared/HyperTaskHub';
import { hyperHubCohortIsPreview } from '@shared/HyperTaskHub';
import type { HyperTaskHubApi, HyperHubBriefResult, HyperHubOpenResult, HyperHubSummaryResult } from '@shared/HyperTaskHub';
// Load the other process through Vitest's renderer alias. Each production TS project stays separately compiled.
const { createHyperTaskHubStore } = await vi.importActual<{ createHyperTaskHubStore(client: HyperTaskHubApi): {
  getState(): { load(): Promise<void>; reset(): void; brief: unknown; summary: unknown;
    getBrief(meetingId: string): Promise<HyperHubBriefResult>;
    openBriefEvidence(meetingId: string, evidenceId: string): Promise<HyperHubOpenResult>;
    summarizeBrief(meetingId: string, ids: string[]): Promise<HyperHubSummaryResult> };
} }>('@/features/hyper-task-hub/state/useHyperTaskHub');
import type { HyperOutlookValues } from '../HyperOutlookSchema';
import { HyperHubOutlookSource } from './HyperHubOutlookSource';
import { HyperTaskHubService, type HyperHubSource } from './HyperTaskHubService';
import { HyperHubAccessLost } from './HyperTaskHubSync';
import { disk, setup, record } from './HyperTaskHub.test-support';
import { hyperHubSummaryTransport, type HyperHubSummaryTransport } from './HyperHubSummaryTransport';

const now = Date.parse('2026-11-29T07:00:00Z');
type Event = z.infer<typeof HyperOutlookValues['hub.calendar']>['events'][number];
const meeting: Extract<Event, { private: false }> = {
  private: false, entryId: 'ABCD', originalStart: '2026-11-29T10:00:00Z', start: '2026-11-29T10:00:00Z',
  end: '2026-11-29T11:00:00Z', isMeeting: true, organizerIsOwner: false, title: 'ENG-9 Atlas launch',
  allDay: false, availability: 'busy', details: { sensitivity: 'normal', modified: '2026-11-28T08:00:00Z', excerpt: 'Review schedule.',
    attendees: [{ name: 'Ada', email: 'ada@example.com' }], joinUrl: null, organizer: 'Ada' },
};
function fixture(cleanup: (f: () => void) => void, summary?: HyperHubSummaryTransport) {
  const files = disk();
  cleanup(files.cleanup);
  const store = files.open();
  store.commit(() => true, d => { d.outlookStore = 'AA'; d.setup = { ...setup, outlookCalendar: true, ai: { summaries: true,
    confirmedAt: { kind: 'instant', iso: new Date(now).toISOString() } } }; });
  const state = { events: [structuredClone(meeting)] as Event[], history: [] as Event[], denied: false, offline: false };
  const bridge = vi.fn(async (op: string, args: { start: string; end: string; open?: boolean; seriesIds?: string[] }) => {
    if (state.offline) throw new Error('Offline');
    if (op === 'hub.store') return 'AA';
    if (op === 'hub.occurrence') return null;
    return { storeId: 'AA', start: args.start, end: args.end, events: args.seriesIds ? state.history : state.events,
      completeness: 'complete', exhausted: true };
  });
  const outlook = new HyperHubOutlookSource({ request: bridge as never }, 'AA', setup.zone, () => now);
  const issue = { ...record(), observedAt: { kind: 'instant' as const, iso: new Date(now).toISOString() }, title: 'Issue text only the owner can read' };
  const jira: HyperHubSource = { kind: 'jira', connectionId: 'jira', queryId: 'jira', label: 'Jira',
    check: async () => { if (state.denied) throw new HyperHubAccessLost(); return 'https://jira.example/browse/ENG-9'; },
    read: async scope => { if (state.denied) throw new HyperHubAccessLost();
      return { records: [{ ...issue, scope }], cursor: null, completeness: 'complete' }; } };
  const listeners = new Set<(snapshot: HyperHubSnapshot) => void>();
  const deps = { accountId: 'account', workspaceId: 'workspace', generation: 1, now: () => now,
    queries: () => [outlook, jira], validate: async () => true, outlookOffline: () => state.offline,
    openExternal: vi.fn(), changed: (s: HyperHubSnapshot) => listeners.forEach(fn => fn(s)), summary, summaryConfigured: async () => true };
  const service = new HyperTaskHubService(store, deps);
  const version = () => ({ expectedRevision: service.version.revision, scopeGeneration: 1 });
  const client: HyperTaskHubBriefApi = { getBrief: v => service.getBrief(v), openBriefEvidence: v => service.openBriefEvidence(v),
    summarizeBrief: v => service.summarizeBrief(v) };
  const renderer = createHyperTaskHubStore({ ...client, getSnapshot: async () => service.snapshot(), refresh: v => service.refresh(v),
    onSnapshot: fn => { listeners.add(fn); return () => listeners.delete(fn); }, openSource: h => service.openSource(h),
    getSetupScope: async () => service.setup, setSetupScope: async () => service.setup, sendFeedback: e => service.sendFeedback(e) });
  const refresh = () => service.refresh(version());
  return { state, service, version, refresh, renderer, issue, bridge, files, deps };
}

it('opens a verified cited brief offline after restart, keeping Viewed independent of readiness', async ({ onTestFinished }) => {
  const f = fixture(onTestFinished);
  const s = await f.refresh();
  const id = s.agenda![0].id;
  expect(s.agenda![0].meeting).toEqual({ verifiedEligible: true, viewed: false, readiness: 'none' });
  expect(s.tasks[0].meetingIds).toEqual([id]);
  const first = await f.service.getBrief({ ...f.version(), meetingId: id });
  expect(first).toMatchObject({ ok: true, brief: { viewed: true, readiness: 'none', relatedIssues: [{ id: f.issue.id }],
    linkedDocuments: [{ id: 'doc.' + f.issue.id }] } });
  expect(await f.service.openBriefEvidence({ ...f.version(), meetingId: id, evidenceId: 'doc.' + f.issue.id })).toMatchObject({ ok: true });
  expect(f.deps.openExternal).toHaveBeenCalledOnce();
  f.service.close();
  f.state.offline = true;
  f.bridge.mockClear();
  const restored = new HyperTaskHubService(f.files.open(), { ...f.deps, generation: 2 });
  const replay = await restored.getBrief({ expectedRevision: restored.version.revision, scopeGeneration: 2, meetingId: id });
  expect(replay).toMatchObject({ ok: true, brief: { viewed: true, relatedIssues: [{ id: f.issue.id, stale: true }] } });
  expect(f.bridge).not.toHaveBeenCalled();
});

it('drops previous versions after a move, changed evidence, sensitivity change, or cancellation', async ({ onTestFinished }) => {
  const f = fixture(onTestFinished);
  const id = (await f.refresh()).agenda![0].id;
  const fetch = async () => {
    const result = await f.service.getBrief({ ...f.version(), meetingId: id });
    if (!result.ok || !result.brief.eligible) throw Error('Expected a brief');
    return result.brief;
  };
  const first = await fetch();
  f.state.events = [{ ...meeting, start: '2026-11-29T11:00:00Z', end: '2026-11-29T12:00:00Z' }];
  await f.refresh();
  const moved = await fetch();
  expect(moved.meeting.id).toBe(first.meeting.id);
  expect(moved.briefVersion).not.toBe(first.briefVersion);
  f.issue.revision = 'changed';
  await f.refresh();
  expect((await fetch()).briefVersion).not.toBe(moved.briefVersion);
  f.state.events = [{ private: true, start: meeting.start, end: meeting.end }];
  expect((await f.refresh()).agenda![0]).not.toHaveProperty('meeting');
  expect(JSON.stringify(f.files.open().current.cache)).not.toContain('Review schedule.');
  f.state.events = [];
  expect((await f.refresh()).agenda).toEqual([]);
  expect(await f.service.getBrief({ ...f.version(), meetingId: id })).toMatchObject({ ok: false, code: 'access-denied' });
});

it('keeps the two most recent decisions of the verified store and series', async ({ onTestFinished }) => {
  const f = fixture(onTestFinished);
  const recurring = { ...meeting, details: { ...meeting.details!, seriesId: 'series' } };
  f.state.events = [recurring];
  f.state.history = [3, 10, 17, 22].map(day => {
    const start = '2026-11-' + String(day).padStart(2, '0') + 'T10:00:00Z';
    return { ...recurring, originalStart: start, start, end: start.replace('10:00', '11:00'),
      details: { ...recurring.details, seriesId: day === 22 ? 'another' : 'series', excerpt: 'Decision: ship on ' + day } };
  });
  const id = (await f.refresh()).agenda![0].id;
  const result = await f.service.getBrief({ ...f.version(), meetingId: id });
  expect(result).toMatchObject({ ok: true, brief: { priorDecisions: expect.arrayContaining([
    expect.objectContaining({ excerpt: 'Decision: ship on 10' }), expect.objectContaining({ excerpt: 'Decision: ship on 17' })]) } });
  if (!result.ok || !result.brief.eligible) throw Error('Expected a brief');
  expect(result.brief.priorDecisions).toHaveLength(2);
});

it('validates prep blocks, projects task deadlines and undoes each owner action', async ({ onTestFinished }) => {
  const f = fixture(onTestFinished);
  const meetingId = (await f.refresh()).agenda![0].id;
  const readiness = () => f.service.snapshot().agenda![0].meeting?.readiness;
  for (const type of ['mark-prepared', 'block-before', 'add-prep-task'] as const) {
    const ack = await f.service.sendFeedback({ ...f.version(), meetingId, type });
    expect(ack).toMatchObject({ ok: true });
    if (!ack.ok) throw Error(ack.code);
    expect(readiness()).toBe(type === 'mark-prepared' ? 'prepared' : type === 'block-before' ? 'planned' : 'none');
    if (type === 'block-before') {
      expect(f.service.snapshot().plan!.blocks).toContainEqual(expect.objectContaining({ fixed: true, start: { kind: 'instant', iso: '2026-11-29T09:45:00.000Z' } }));
      expect(await f.service.sendFeedback({ ...f.version(), meetingId, type })).toMatchObject({ ok: false });
    }
    if (type === 'add-prep-task') {
      const prep = f.service.snapshot().tasks.find(t => t.sources.length === 0)!;
      expect(prep).toMatchObject({ prepDeadline: { iso: '2026-11-29T10:00:00.000Z' }, meetingIds: [meetingId] });
      const done = await f.service.sendFeedback({ ...f.version(), targetId: prep.id, type: 'set-state', state: 'done' });
      expect(readiness()).toBe('prepared');
      if (!done.ok) throw Error(done.code);
      await f.service.sendFeedback({ ...f.version(), targetId: prep.id, type: 'undo', ledgerEntryId: done.ledgerEntryId });
    }
    expect(await f.service.sendFeedback({ ...f.version(), type: 'undo', meetingId, ledgerEntryId: ack.ledgerEntryId })).toMatchObject({ ok: true });
    expect(readiness()).toBe('none');
    expect(f.service.snapshot().tasks).toHaveLength(1);
  }
});

it('clears the displayed brief and cached text after a source access denial, leaving owner tasks in place', async ({ onTestFinished }) => {
  const f = fixture(onTestFinished);
  const meetingId = (await f.refresh()).agenda![0].id;
  await f.service.sendFeedback({ ...f.version(), type: 'add-prep-task', meetingId, title: 'My preparation' });
  await f.renderer.getState().load();
  await f.renderer.getState().getBrief(meetingId);
  expect(JSON.stringify(f.renderer.getState().brief)).toContain(f.issue.title);
  f.state.denied = true;
  expect(await f.renderer.getState().openBriefEvidence(meetingId, f.issue.id)).toMatchObject({ ok: false, code: 'access-denied' });
  expect(f.renderer.getState().brief).toBeNull();
  expect(JSON.stringify(f.renderer.getState())).not.toContain(f.issue.title);
  expect(JSON.stringify(f.files.open().current)).not.toContain(f.issue.title);
  expect(f.service.snapshot().tasks.map(t => t.title)).toEqual(['My preparation']);
});

it('retains the deterministic brief on transport failure and discards a reply after scope change', async ({ onTestFinished }) => {
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const summary = vi.fn<HyperHubSummaryTransport>()
    .mockRejectedValueOnce(Error('endpoint failure')).mockImplementationOnce(async () => {
      enter(); await new Promise<void>(resolve => { finish = resolve; }); return { text: 'obsolete', citations: [] };
    });
  const f = fixture(onTestFinished, summary);
  const meetingId = (await f.refresh()).agenda![0].id;
  await f.renderer.getState().load();
  await f.renderer.getState().getBrief(meetingId);
  expect(await f.renderer.getState().summarizeBrief(meetingId, [meetingId])).toMatchObject({ ok: false, code: 'unavailable' });
  expect(f.renderer.getState().brief).toMatchObject({ eligible: true, meeting: { excerpt: 'Review schedule.' } });
  const pending = f.renderer.getState().summarizeBrief(meetingId, [f.issue.id]);
  await entered;
  f.service.close(); f.renderer.getState().reset(); finish();
  expect(await pending).toMatchObject({ ok: false, code: 'scope-changed' });
  expect(f.renderer.getState().summary).toBeNull();
});

it('sends only selected excerpts without tools and requires exact citations', async () => {
  let quote = 'quoted fact';
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
    role: 'assistant', content: JSON.stringify({ text: 'Summary', citations: [{ id: 'one', quote }] }) } }] }));
  const transport = hyperHubSummaryTransport(async () => ({ baseUrl: 'https://example.com', defaultModel: 'model', apiKey: '' }), fetcher);
  const request = { source: 'hyper-meeting-brief' as const, untrusted_data: [{ id: 'one', excerpt: 'A quoted fact.' }] };
  const verify = vi.fn(async () => {});
  expect(await transport(request, new AbortController().signal, verify)).toEqual({ text: 'Summary', citations: ['one'] });
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(JSON.parse(body.messages[1].content)).toEqual(request);
  expect(body).not.toHaveProperty('tools');
  expect(verify).toHaveBeenCalledOnce();
  quote = 'invented';
  await expect(transport(request, new AbortController().signal, verify)).rejects.toThrow('Invalid citation');
});

it('requires 20 reviews in the same cohort and 90% precision in both samples', () => {
  expect(hyperHubCohortIsPreview(19, 0, 1)).toBe(true);
  expect(hyperHubCohortIsPreview(18, 2, 0.9)).toBe(false);
  expect(hyperHubCohortIsPreview(17, 3, 1)).toBe(true);
  expect(hyperHubCohortIsPreview(20, 0, 0.89)).toBe(true);
});


it('main rejects a late summary after selected evidence access is withdrawn', async ({ onTestFinished }) => {
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const f = fixture(onTestFinished, async () => {
    enter(); await new Promise<void>(resolve => { finish = resolve; });
    return { text: 'discard me', citations: [] };
  });
  const meetingId = (await f.refresh()).agenda![0].id;
  const pending = f.service.summarizeBrief({ ...f.version(), meetingId, evidenceIds: [f.issue.id] });
  await entered;
  f.state.denied = true;
  finish();
  expect(await pending).toMatchObject({ ok: false, code: 'access-denied' });
  expect(JSON.stringify(f.files.open().current.cache)).not.toContain(f.issue.title);
});

it('rejects an unselected citation or absent setup consent before calling the endpoint', async ({ onTestFinished }) => {
  const summary = vi.fn<HyperHubSummaryTransport>();
  const f = fixture(onTestFinished, summary);
  const meetingId = (await f.refresh()).agenda![0].id;
  expect(await f.service.summarizeBrief({ ...f.version(), meetingId, evidenceIds: ['outside'] })).toMatchObject({ ok: false, code: 'invalid' });
  const store = f.files.open();
  store.commit(() => true, draft => { draft.setup!.ai = null; });
  const service = new HyperTaskHubService(store, { ...f.deps, outlookOffline: () => true });
  expect(await service.summarizeBrief({ expectedRevision: service.version.revision, scopeGeneration: 1, meetingId, evidenceIds: [meetingId] }))
    .toMatchObject({ ok: false, code: 'access-denied' });
  expect(summary).not.toHaveBeenCalled();
});

it('keeps an issue key in a foreign tracker URL outside the brief', async ({ onTestFinished }) => {
  const f = fixture(onTestFinished);
  f.state.events = [{ ...meeting, title: 'https://another.example/browse/ENG-9' }];
  const meetingId = (await f.refresh()).agenda![0].id;
  const result = await f.service.getBrief({ ...f.version(), meetingId });
  expect(result).toMatchObject({ ok: true, brief: { relatedIssues: [], linkedDocuments: [] } });
});
