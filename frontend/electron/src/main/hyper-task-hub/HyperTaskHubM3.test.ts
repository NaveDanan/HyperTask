import { expect, it, vi } from 'vitest';
import type { HyperHubAgendaItem, HyperHubFeedbackEvent, HyperHubSetupScope } from '@shared/HyperTaskHub';
import { HyperHubSetupScopeSchema } from '@shared/HyperTaskHub';
import { HyperHubMailSource, hyperHubMailConsent } from './HyperHubOutlookSource';
import { HyperTaskHubService, type HyperHubSource } from './HyperTaskHubService';
import { disk, record, scope, setup } from './HyperTaskHub.test-support';

const iso = '2026-11-29T07:00:00Z', now = Date.parse(iso);
const at = (s: string) => ({ kind: 'instant' as const, iso: s });
const selection = HyperHubSetupScopeSchema.parse({ ...setup, aliases: ['Yael', 'יעל'],
  mail: { enabled: true, folders: ['inbox', 'sent'], confirmedAt: at(iso) } });
const v = (s: HyperTaskHubService) => ({ expectedRevision: s.version.revision, scopeGeneration: s.version.scopeGeneration });
const headers = (folder: string) => (folder === 'inbox' ? ['11', '22'] : []).map(entryId => ({
  entryId, visibility: 'public', modified: iso, authoredAt: iso, flag: 'active', flagStart: null, flagDue: null, flagCompleted: null,
  messageId: '<' + entryId + '>', conversationId: entryId, inReplyTo: null,
}));
function bridge() {
  const state = { offline: false, protected: false, complete: true };
  const request = vi.fn(async (op: string, args: { folder: string; entryId: string }) => {
    if (state.offline) throw Error('Offline');
    if (op === 'hub.store') return 'AA';
    if (op === 'hub.mailHeaders') return { storeId: 'AA', exhausted: true, complete: state.complete,
      replyCoverage: state.complete && !state.protected, next: null, excludedIds: state.protected ? ['11'] : [],
      headers: headers(args.folder).filter(h => !state.protected || h.entryId !== '11') };
    if (op === 'hub.mailDetail') return state.protected && args.entryId === '11' ? null : {
      visibility: 'public', storeId: 'AA', entryId: args.entryId, modified: iso, sender: 'dev@example.org', to: ['Yael'],
      body: args.entryId === '11' ? 'Yael, please review ENG-9 מחר.\nיעל, נא לשלוח את הדוח.' : 'When is the release?',
      attachmentNames: ['agenda.pdf'], distributionList: false, subject: 'Release tasks',
    };
    if (op === 'mail.open') return null;
    throw Error('Unexpected ' + op);
  });
  return { state, request, api: { request: request as never } };
}
it('requires enabled and confirmed folder scope before any bridge operation and defaults retention to thirty days', async () => {
  const b = bridge();
  expect(selection.mail?.retentionDays).toBe(30);
  for (const mail of [null, { ...selection.mail!, enabled: false }, { ...selection.mail!, confirmedAt: undefined }, { ...selection.mail!, folders: [] }]) {
    const consent = { ...selection, mail };
    expect(hyperHubMailConsent(consent)).toBe(false);
    await expect(new HyperHubMailSource(b.api, 'AA', consent).read(scope, new AbortController().signal)).rejects.toThrow();
  }
  expect(b.request).not.toHaveBeenCalled();
});

it('imports verified opted-in flags only, and never infers no reply from a partial Sent inventory', async () => {
  const b = bridge(), signal = new AbortController().signal;
  const read = (opted: boolean, verified: boolean) => new HyperHubMailSource(b.api, 'AA', {
    ...selection, mail: { ...selection.mail!, importFlags: opted },
  }, verified, () => now).read(scope, signal);
  for (const [opted, verified] of [[false, true], [true, false]]) {
    expect((await read(opted, verified)).records.every(r => r.initialState === 'review')).toBe(true);
  }
  expect((await read(true, true)).records.filter(r => r.initialState === 'ready')).toHaveLength(2);
  b.state.complete = false;
  expect((await read(false, true)).records.map(r => r.reviewSpan?.rule)).not.toContain('Unanswered direct question');
});

it('keeps the surviving fingerprint, deadline, excerpt and moved reservation across encrypted offline replay', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const b = bridge();
  const store = d.open();
  store.commit(() => true, draft => { draft.setup = selection; draft.outlookStore = 'AA'; });
  const jira = { ...record(), observedAt: at(iso), createdAt: at(iso), due: { kind: 'civil-date' as const, date: '2026-11-30', zone: setup.zone },
    people: [{ role: 'assignee' as const, id: 'jira-owner', name: 'Yael' }] };
  let start = '2026-11-29T09:00:00Z';
  const queries = (s: HyperHubSetupScope): HyperHubSource[] => [
    ...(hyperHubMailConsent(s) ? [new HyperHubMailSource(b.api, 'AA', s, false, () => now)] : []),
    { kind: 'jira', connectionId: 'jira', queryId: 'ENG', label: 'Jira', check: async () => {},
      read: async ctx => ({ records: [{ ...jira, scope: ctx }], completeness: 'complete', cursor: null }) },
    { kind: 'outlook-calendar', connectionId: 'cal', queryId: 'week', label: 'Outlook calendar', availabilitySource: true, check: async () => {},
      read: async () => {
        const item: HyperHubAgendaItem = { private: false, title: 'Review meeting', id: 'event', allDay: false, isMeeting: true,
          sourceKind: 'outlook-calendar', interval: { start: at(start), end: at('2026-11-29T10:00:00Z') }, availability: 'busy' };
        return { records: [], agenda: [item], cursor: null, completeness: 'complete' };
      } },
  ];
  const deps = { queries, now: () => now, accountId: 'account', workspaceId: 'workspace', generation: 1,
    changed: vi.fn(), validate: async () => true, openExternal: vi.fn() };
  let service = new HyperTaskHubService(store, deps);
  const first = await service.refresh(v(service));
  const mixed = first.tasks.find(t => t.reviewSpan?.cohort === 'mixed')!;
  const hebrew = first.tasks.find(t => t.reviewSpan?.cohort === 'he')!;
  const issue = first.tasks.find(t => t.sources[0].kind === 'jira')!;
  expect(mixed.sources.map(r => r.role)).toEqual(['origin', 'mentions']);
  expect(mixed.sources[0].attachmentNames).toEqual(['agenda.pdf']);
  expect(mixed.reviewSpan?.resolvedDate).toEqual(jira.due);
  expect(mixed.authoritativeCompletion).toBe('unknown');
  expect(await service.openSource(mixed.sources[0].handle)).toMatchObject({ ok: true });
  expect(b.request).toHaveBeenCalledWith('mail.open', { storeId: 'AA', entryId: '11', folder: 'inbox' }, expect.any(Function));
  expect(await service.sendFeedback({ ...v(service), type: 'dismiss', targetId: hebrew.id })).toMatchObject({ ok: true });
  expect(service.snapshot().settings.cohortPrecision?.he).toEqual({ accepted: 0, dismissed: 1, preview: true });
  start = '2026-11-29T09:30:00Z';
  const bodyReads = () => b.request.mock.calls.filter(([op, args]) => op === 'hub.mailDetail' && !('headerOnly' in args && args.headerOnly)).length;
  const beforeRefresh = bodyReads();
  await service.refresh(v(service));
  expect(bodyReads()).toBe(beforeRefresh);
  service.close(); b.state.offline = true;
  const diskAgain = d.open();
  service = new HyperTaskHubService(diskAgain, { ...deps, generation: 2 });
  const replay = service.snapshot();
  expect(replay.tasks.find(t => t.id === mixed.id)).toMatchObject({ state: 'review', due: jira.due, reviewSpan: mixed.reviewSpan });
  expect(replay.tasks.find(t => t.id === hebrew.id)?.state).toBe('dismissed');
  expect(replay.agenda?.[0].interval.start.iso).toBe(start);
  b.state.offline = false;
  const send = async (input: Omit<HyperHubFeedbackEvent, 'expectedRevision' | 'scopeGeneration'> & Record<string, unknown>) => {
    const reply = await service.sendFeedback({ ...v(service), ...input } as HyperHubFeedbackEvent);
    if (!reply.ok) throw Error(reply.code);
    return reply.ledgerEntryId;
  };
  const view = () => service.snapshot().tasks.find(t => t.id === mixed.id)!;
  const feedback = (type: HyperHubFeedbackEvent['type'], props = {}) => send({ type, targetId: mixed.id, ...props });
  const undo = (ledgerEntryId: string) => feedback('undo', { ledgerEntryId });
  const unlink = await feedback('unlink', { handle: view().sources[1].handle });
  expect(view().sources).toHaveLength(1);
  const link = await feedback('link', { handle: service.snapshot().tasks.find(t => t.id === issue.id)!.sources[0].handle });
  expect(view().sources[1].role).toBe('mentions');
  await undo(link); await undo(unlink);
  expect(view().sources[1].role).toBe('mentions');
  expect(service.snapshot().linkSuggestions).toContainEqual(expect.objectContaining({ targetId: mixed.id, otherTaskId: issue.id }));
  const reject = await feedback('reject-match', { otherTaskId: issue.id });
  expect(service.snapshot().linkSuggestions).not.toContainEqual(expect.objectContaining({ targetId: mixed.id, otherTaskId: issue.id }));
  await undo(reject);
  await send({ type: 'pin', targetId: issue.id });
  // A source edge from Jira to the mail action becomes a self-edge while merged.
  diskAgain.commit(() => true, draft => {
    for (const cache of Object.values(draft.cache)) for (const r of cache.records)
      if (r.id === mixed.sources[0].evidenceId) r.predecessorEvidenceIds = [jira.id];
  });
  const merge = await feedback('merge', { otherTaskId: issue.id });
  expect(service.snapshot().cycleTaskIds).toEqual([mixed.id]);
  expect(service.snapshot().tasks.some(t => t.id === issue.id)).toBe(false);
  expect(view().sources.map(s => s.role)).toEqual(['origin', 'origin']);
  const split = await feedback('split', { mergeEntryId: merge });
  expect(service.snapshot().cycleTaskIds).toEqual([]);
  expect(service.snapshot().tasks.find(t => t.id === issue.id)).toMatchObject({ pinned: true, blocks: [{ successorId: mixed.id }] });
  expect(service.snapshot().linkSuggestions).not.toContainEqual(expect.objectContaining({ targetId: mixed.id, otherTaskId: issue.id }));
  await undo(split);
  expect(service.snapshot().cycleTaskIds).toEqual([mixed.id]);
  await undo(merge);
  expect(service.snapshot().tasks.find(t => t.id === issue.id)).toMatchObject({ pinned: true, blocks: [{ successorId: mixed.id }] });
  const accept = await feedback('accept');
  expect(service.snapshot().settings.cohortPrecision?.mixed).toEqual({ accepted: 1, dismissed: 0, preview: true });
  await undo(accept);
  expect(service.snapshot().settings.cohortPrecision?.mixed?.preview).toBe(true);
  b.state.protected = true; b.state.complete = false;
  await service.refresh(v(service));
  expect(JSON.stringify(diskAgain.current)).not.toContain(mixed.reviewSpan!.excerpt);
  expect(service.snapshot().tasks.some(t => t.id === mixed.id || t.id === hebrew.id)).toBe(false);
  b.state.protected = false; b.state.complete = true;
  await service.refresh(v(service));
  service.setSetupScope(v(service), { ...selection, mail: null }, 'AA');
  expect(JSON.stringify(diskAgain.current)).not.toContain(mixed.reviewSpan!.excerpt);
});

it('reads only the header of an older personal flag from the verified inventory', async () => {
  const old = '2025-01-01T07:00:00Z';
  const request = vi.fn(async (op: string, args: { activeFlags?: boolean; headerOnly?: boolean }) => {
    if (op === 'hub.mailHeaders') return { storeId: 'AA', exhausted: true, complete: true, next: null, replyCoverage: true,
      excludedIds: [], headers: args.activeFlags ? [{ ...headers('inbox')[0], authoredAt: old, modified: old, flagDue: iso }] : [] };
    if (op === 'hub.mailDetail' && args.headerOnly) return { storeId: 'AA', visibility: 'public', entryId: '11', subject: 'Follow up',
      modified: old, sender: '', to: [], body: '', distributionList: null };
    throw Error('Unexpected body read');
  });
  const config = { ...selection, mail: { ...selection.mail!, importFlags: true, folders: ['inbox' as const] } };
  const source = new HyperHubMailSource({ request: request as never }, 'AA', config, true, () => now);
  const result = await source.read(scope, new AbortController().signal);
  expect(result.records).toMatchObject([{ title: 'Follow up', initialState: 'ready', due: at(iso) }]);
  expect(result.records[0].reviewSpan).toBeUndefined();
});
