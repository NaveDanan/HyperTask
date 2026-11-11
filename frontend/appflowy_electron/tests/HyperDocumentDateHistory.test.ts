import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperDocumentSession, type HyperDocumentBackend } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperCaptureMentionSelection } from '../src/renderer/features/document/HyperDocumentMentions';
import { hyperEditText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperApplyDocumentDate, hyperCaptureDocumentDate, hyperDocumentDateValue, type HyperDateDraft } from '../src/renderer/features/document-date/HyperDocumentDateModel';
import { createHyperDocumentDateStore, type HyperDocumentDateBackend } from '../src/renderer/features/document-date/HyperDocumentDateStore';

const initial = () => create(DocumentDataPBSchema, { pageId: 'document', blocks: { document: { id: 'document', ty: 'page', data: '{}', childrenId: 'children' }, p: { id: 'p', ty: 'paragraph', parentId: 'document', childrenId: 'p-children', data: JSON.stringify({ delta: [{ insert: 'Before' }] }) }, q: { id: 'q', ty: 'paragraph', parentId: 'document', childrenId: 'q-children', data: '{}' } }, meta: { childrenMap: { children: { children: ['p', 'q'] }, 'p-children': { children: [] }, 'q-children': { children: [] } } } });
const draft = (): HyperDateDraft => ({ date: '2030-05-06', time: '10:30:00', includeTime: true, reminderOption: 'atTimeOfEvent', customTime: '' });
async function fixture(seedDoc = initial(), seedReminders: ReminderPB[] = []) {
  let active = true, editable = true, saved = seedDoc, stack = [clone(DocumentDataPBSchema, seedDoc)], index = 0, reminders = seedReminders.map(item => clone(ReminderPBSchema, item));
  const owner = { workspaceId: 'workspace', actorId: 'actor', contextKey: 'context', isCurrent: () => active };
  const service: HyperDocumentBackend = { open: async () => saved, read: async () => saved, close: vi.fn(async () => {}), listen: () => () => {},
    apply: vi.fn(async () => { saved = clone(DocumentDataPBSchema, session.store.getState().document!); stack = stack.slice(0, index + 1); stack.push(saved); index++; }),
    history: vi.fn(async (_id, redo) => { index = Math.max(0, Math.min(stack.length - 1, index + (redo ? 1 : -1))); saved = clone(DocumentDataPBSchema, stack[index]); }) };
  const session = new HyperDocumentSession('document', service, owner); await session.flush();
  const backend: HyperDocumentDateBackend = { identity: async () => ({ workspaceId: 'workspace', actorId: 'actor' }), view: async id => create(ViewPBSchema, { id, layout: ViewLayoutPB.Document }), row: vi.fn(), reminders: vi.fn(async () => reminders.map(item => clone(ReminderPBSchema, item))), create: vi.fn(async next => { reminders.push(clone(ReminderPBSchema, next)); }), update: vi.fn(async next => { reminders = reminders.map(old => old.id === next.id ? clone(ReminderPBSchema, next) : old); }), remove: vi.fn(async id => { reminders = reminders.filter(old => old.id !== id); }), changed: vi.fn() };
  const context = { session, owner, editable: () => editable && !session.store.getState().historyPending, canWrite: () => editable, currentOwner: () => active ? owner : null };
  const store = createHyperDocumentDateStore(context, backend); store.start();
  const insert = async (form = draft()) => { const selection = hyperCaptureMentionSelection(session.store.getState().document!, { id: 'p', selection: { start: 0, end: 0 } }); await store.open(null, selection); await store.save(form); };
  const edit = async (form: HyperDateDraft) => { await store.open(hyperCaptureDocumentDate(session.store.getState().document!, 'p', 0)); await store.save(form); };
  return { store, context, session, backend, service, insert, edit, reminders: () => reminders, seed: (next: ReminderPB[]) => { reminders = next.map(item => clone(ReminderPBSchema, item)); }, deactivate: () => { active = false; }, lock: () => { editable = false; } };
}
describe('Hyper document reminder history companion', () => {
  it('undoes insertion and redoes its timer with the same ID, without duplicate creates', async () => {
    const f = await fixture(); await f.insert(); const reminder = clone(ReminderPBSchema, f.reminders()[0]);
    await f.session.history(false); expect(f.reminders()).toEqual([]); expect(f.session.store.getState()).toMatchObject({ status: 'ready', historyPending: false, error: null });
    await f.session.history(true); expect(f.reminders()[0]).toMatchObject({ id: reminder.id, scheduledAt: reminder.scheduledAt }); expect(f.reminders()).toHaveLength(1); expect(f.store.history.store.getState().pending).toBe(false); f.store.dispose(); await f.session.dispose();
  });
  it('restores date/option schedules on undo and redo and preserves fresh read/archive/unknown values', async () => {
    const f = await fixture(); await f.insert(); const first = clone(ReminderPBSchema, f.reminders()[0]); await f.edit({ ...draft(), date: '2031-05-06', reminderOption: 'oneHourBefore' }); const second = clone(ReminderPBSchema, f.reminders()[0]);
    f.seed([create(ReminderPBSchema, { ...second, isRead: true, meta: { ...second.meta, is_archived: 'true', unrelated: 'keep' } })]);
    await f.session.history(false); expect(f.reminders()[0]).toMatchObject({ id: first.id, scheduledAt: first.scheduledAt, isRead: true, meta: { is_archived: 'true', unrelated: 'keep' } }); await f.session.history(true); expect(f.reminders()[0].scheduledAt).toBe(second.scheduledAt); f.store.dispose(); await f.session.dispose();
  });
  it('undoes disabling a reminder and redoes removal', async () => {
    const f = await fixture(); await f.insert(); const first = clone(ReminderPBSchema, f.reminders()[0]); await f.edit({ ...draft(), reminderOption: 'none' }); expect(f.reminders()).toHaveLength(0);
    await f.session.history(false); expect(f.reminders()[0]).toMatchObject({ id: first.id, scheduledAt: first.scheduledAt }); await f.session.history(true); expect(f.reminders()).toHaveLength(0); f.store.dispose(); await f.session.dispose();
  });
  it('makes custom-only timer changes undoable and restores a legacy custom schedule exactly', async () => {
    const legacy = { type: 'reminder' as const, date: '2030-05-06T10:30:00.000', include_time: true, reminder_id: 'custom', reminder_option: 'custom', unknown: 'keep' };
    const seeded = hyperApplyDocumentDate(initial(), null, legacy), blockId = seeded.focus!.id;
    const old = create(ReminderPBSchema, { id: 'custom', objectId: 'document', scheduledAt: 1_800_000_000n, meta: { block_id: blockId, include_time: 'true', date: String(new Date(legacy.date).getTime()), extra: 'retain' } });
    const f = await fixture(seeded.document, [old]); await f.store.open(hyperCaptureDocumentDate(f.session.store.getState().document!, blockId, 0));
    await f.store.save({ ...f.store.getState().draft, customTime: '2030-05-05T08:15:00' }); const changed = clone(ReminderPBSchema, f.reminders()[0]); expect(changed.scheduledAt).not.toBe(old.scheduledAt); expect(f.service.apply).toHaveBeenCalledOnce();
    const atom = hyperCaptureDocumentDate(f.session.store.getState().document!, blockId, 0); expect(atom.attributes.hyper_reminder).toEqual({ version: 1, custom_scheduled_at_seconds: String(changed.scheduledAt) });
    const currentMeta = { ...changed.meta }; delete currentMeta.extra; f.seed([create(ReminderPBSchema, { ...changed, meta: currentMeta })]);
    await f.session.history(false); expect(f.reminders()[0].scheduledAt).toBe(old.scheduledAt); expect(f.reminders()[0].meta.extra).toBeUndefined(); expect(hyperCaptureDocumentDate(f.session.store.getState().document!, blockId, 0).attributes.hyper_reminder).toBeUndefined(); await f.session.history(true); expect(f.reminders()[0].scheduledAt).toBe(changed.scheduledAt); f.store.dispose(); await f.session.dispose();
  });
  it('performs ordinary text undo without writing any reminders', async () => {
    const f = await fixture(); await f.insert(); const before = f.reminders().map(item => clone(ReminderPBSchema, item)); f.session.change(doc => hyperEditText(doc, 'q', [{ insert: 'Unrelated text' }])); await f.session.flush();
    vi.mocked(f.backend.create).mockClear(); vi.mocked(f.backend.update).mockClear(); vi.mocked(f.backend.remove).mockClear(); await f.session.history(false); expect(f.reminders()).toEqual(before); expect(f.backend.create).not.toHaveBeenCalled(); expect(f.backend.update).not.toHaveBeenCalled(); expect(f.backend.remove).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('keeps the fresh document after a failed timer update and retries only sidecars', async () => {
    const f = await fixture(); await f.insert(); const original = clone(ReminderPBSchema, f.reminders()[0]); await f.edit({ ...draft(), date: '2031-05-06' });
    f.backend.update = vi.fn(async () => { throw new Error('Temporary failure'); }); await f.session.history(false);
    expect(f.store.history.store.getState()).toMatchObject({ pending: true, busy: false }); expect(f.store.history.store.getState().recovery).toContain('operations'); expect(hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0).mention.date).toBe(hyperDocumentDateValue(draft())); expect(f.session.store.getState()).toMatchObject({ status: 'ready', error: null, historyPending: false }); expect(await f.session.dispose()).toBe(false);
    await f.session.history(false); expect(f.service.history).toHaveBeenCalledOnce(); await f.store.open(hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0)); expect(f.store.getState().error).toContain('recovery');
    f.backend.update = vi.fn(async next => { f.seed([next]); }); await f.store.history.retry(); expect(f.reminders()[0].scheduledAt).toBe(original.scheduledAt); expect(f.service.history).toHaveBeenCalledOnce(); expect(f.store.history.store.getState().pending).toBe(false); f.store.dispose(); await f.session.dispose();
  });
  it('confirms an uncertain create on retry without appending the same reminder twice', async () => {
    const f = await fixture(); await f.insert(); await f.edit({ ...draft(), reminderOption: 'none' }); f.backend.create = vi.fn(async next => { f.seed([next]); throw new Error('Reply lost after create'); });
    await f.session.history(false); expect(f.store.history.store.getState().pending).toBe(true); expect(f.reminders()).toHaveLength(1); await f.store.history.retry(); expect(f.store.history.store.getState().pending).toBe(false); expect(f.backend.create).toHaveBeenCalledOnce(); expect(f.service.history).toHaveBeenCalledOnce(); f.store.dispose(); await f.session.dispose();
  });
  it('rejects concurrent timer/binding changes and a changed affected date before retry', async () => {
    const f = await fixture(); await f.insert(); await f.edit({ ...draft(), date: '2031-05-06' }); const expected = clone(ReminderPBSchema, f.reminders()[0]); f.seed([create(ReminderPBSchema, { ...expected, scheduledAt: expected.scheduledAt + 60n })]);
    vi.mocked(f.backend.update).mockClear(); await f.session.history(false); expect(f.store.history.store.getState().pending).toBe(true); expect(f.backend.update).not.toHaveBeenCalled(); expect(f.store.history.store.getState().error).toContain('changed elsewhere');
    const captured = hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0); f.session.change(doc => hyperApplyDocumentDate(doc, captured.selection, { ...captured.mention, date: '2032-05-06T10:30:00.000' }, captured.attributes)); await f.session.flush(); f.seed([expected]); await f.store.history.retry(); expect(f.backend.update).not.toHaveBeenCalled(); expect(f.store.history.store.getState().error).toContain('affected date changed'); f.store.dispose();
  });
  it('does not invoke native history after a prepare failure or send writes after owner loss', async () => {
    const f = await fixture(); await f.insert(); let resolve!: (items: ReminderPB[]) => void; f.backend.reminders = vi.fn(() => new Promise<ReminderPB[]>(done => { resolve = done; })); const undo = f.session.history(false); await vi.waitFor(() => expect(resolve).toBeDefined()); f.deactivate(); resolve(f.reminders()); await undo; expect(f.service.history).not.toHaveBeenCalled(); expect(f.session.store.getState().historyPending).toBe(false); expect(f.store.history.store.getState().error).toContain('not applied'); f.store.dispose(); await f.session.dispose();
  });
  it('rejects a legacy non-promotable inline object before any reminder write', async () => {
    const doc = initial(); doc.blocks.p.data = JSON.stringify({ delta: [{ insert: { unknown: 'legacy' } }, { insert: 'Text' }] }); const f = await fixture(doc); await f.store.open(null, hyperCaptureMentionSelection(doc, { id: 'p', selection: { start: 1, end: 1 } }));
    await expect(f.store.save(draft())).rejects.toThrow(); expect(f.backend.create).not.toHaveBeenCalled(); expect(f.backend.update).not.toHaveBeenCalled(); expect(f.service.apply).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('shares one participant across stores using the same scoped session', async () => {
    const f = await fixture(); const second = createHyperDocumentDateStore(f.context, f.backend); second.start(); expect(second.history).toBe(f.store.history); await f.insert(); second.dispose(); await f.session.history(false); expect(f.reminders()).toHaveLength(0); f.store.dispose(); await f.session.dispose();
  });
  it('continues history after an editor lease is replaced by a canvas lease', async () => {
    const f = await fixture(); await f.insert(); const history = f.store.history; f.store.dispose();
    const releaseCanvas = history.connect({ ...f.context, editable: () => true, canWrite: () => true }); await f.session.history(false); expect(f.reminders()).toHaveLength(0); expect(history.store.getState().pending).toBe(false); await f.session.history(true); expect(f.reminders()).toHaveLength(1); releaseCanvas(); await f.session.dispose();
  });
});
