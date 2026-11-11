import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperBlockText, hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperCaptureMentionSelection } from '../src/renderer/features/document/HyperDocumentMentions';
import { HyperDocumentSession, type HyperDocumentBackend } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperApplyDocumentDate, hyperBuildDocumentDateMention, hyperCaptureDocumentDate, hyperDocumentDateDraft, hyperDocumentDateLabel, hyperDocumentDateMention, hyperDocumentDateSchedule, hyperDocumentDateValue, hyperParseLocalDateTime, type HyperDateDraft } from '../src/renderer/features/document-date/HyperDocumentDateModel';
import { createHyperDocumentDateStore, type HyperDocumentDateBackend } from '../src/renderer/features/document-date/HyperDocumentDateStore';

const initial = () => create(DocumentDataPBSchema, { pageId: 'document', blocks: { document: { id: 'document', ty: 'page', childrenId: 'root-children', data: '{}' }, p: { id: 'p', ty: 'paragraph', parentId: 'document', childrenId: 'p-children', data: JSON.stringify({ delta: [{ insert: '🌍before tail', attributes: { bold: true, custom: 'retained' } }] }) } }, meta: { childrenMap: { 'root-children': { children: ['p'] }, 'p-children': { children: [] } } } });
const draft = (): HyperDateDraft => ({ date: '2030-03-04', time: '10:30:00', includeTime: true, reminderOption: 'fiveMinsBefore', customTime: '' });
describe('Hyper document date format', () => {
  it('writes compatible date attributes and preserves legacy type, unknown fields and precise original dates', () => {
    const legacy = { type: 'reminder' as const, date: '2030-03-04T10:30:00.123456', include_time: true, reminder_id: 'old', reminder_option: 'fiveMinsBefore', unknown: { keep: true } };
    const form = hyperDocumentDateDraft(legacy);
    expect(hyperDocumentDateValue(form, legacy)).toBe(legacy.date);
    expect(hyperBuildDocumentDateMention(form, legacy, 'old')).toEqual(legacy);
    expect(hyperBuildDocumentDateMention({ ...form, reminderOption: 'none' }, legacy)).toEqual({ ...legacy, reminder_id: undefined, reminder_option: 'none' });
    expect(hyperDocumentDateMention({ insert: '$', attributes: { mention: legacy } })).toEqual(legacy);
    expect(hyperDocumentDateMention({ insert: 'text', attributes: { mention: legacy } })).toBeNull();
    expect(hyperDocumentDateLabel({ type: 'date', date: '2030-02-30T00:00:00' })).toBe('@Invalid date');
  });
  it('validates calendar components and keeps date-only values local', () => {
    expect(() => hyperParseLocalDateTime('2030-02-30')).toThrow(); expect(() => hyperParseLocalDateTime('2030-03-04', '25:00')).toThrow();
    const date = hyperParseLocalDateTime('2030-03-04', '10:30:00'); expect(date.getFullYear()).toBe(2030); expect(date.getMonth()).toBe(2); expect(date.getDate()).toBe(4); expect(date.getHours()).toBe(10);
    expect(hyperDocumentDateValue({ ...draft(), includeTime: false })).toBe('2030-03-04T00:00:00.000');
  });
  it('uses seconds for schedules and local 9 AM for date-only reminders', () => {
    const form = draft(), date = hyperDocumentDateValue(form), atEvent = hyperParseLocalDateTime(form.date, form.time).getTime();
    expect(hyperDocumentDateSchedule(form, date)).toBe(BigInt(atEvent / 1000 - 300));
    const dayBefore = hyperDocumentDateSchedule({ ...form, includeTime: false, reminderOption: 'oneDayBefore' }, date)!;
    const parsed = new Date(Number(dayBefore) * 1000); expect(parsed.getDate()).toBe(3); expect(parsed.getHours()).toBe(9);
    expect(() => hyperDocumentDateSchedule({ ...form, includeTime: false }, date)).toThrow('Include a time');
    expect(() => hyperDocumentDateSchedule({ ...form, reminderOption: 'future' }, date)).toThrow('supported');
    expect(hyperDocumentDateSchedule({ ...form, reminderOption: 'custom', customTime: '2030-02-20T08:10:00' }, date)).toBe(BigInt(hyperParseLocalDateTime('2030-02-20', '08:10:00').getTime() / 1000));
  });
  it('edits an exact UTF-16 atomic mention, retaining surrounding styles and rejects stale selections', () => {
    const doc = initial(), selection = hyperCaptureMentionSelection(doc, { id: 'p', selection: { start: 2, end: 8 } });
    const added = hyperApplyDocumentDate(doc, selection, hyperBuildDocumentDateMention(draft(), undefined, 'reminder'));
    const target = hyperCaptureDocumentDate(added.document, 'p', 0); expect(target.selection.selection).toEqual({ start: 2, end: 3 });
    const changed = hyperApplyDocumentDate(added.document, target.selection, { ...target.mention, date: '2031-03-04T10:30:00.000', extra: 'preserved' }, { ...target.attributes, italic: true });
    expect(hyperBlockText(changed.document, changed.document.blocks.p)[0]).toEqual({ insert: '🌍', attributes: { bold: true, custom: 'retained' } });
    expect(hyperBlockText(changed.document, changed.document.blocks.p)[1].attributes).toMatchObject({ italic: true, mention: { extra: 'preserved' } });
    expect(() => hyperApplyDocumentDate(changed.document, target.selection, target.mention)).toThrow('text changed');
  });
});
async function fixture() {
  let saved = initial(), active = true, editable = true, reminders: ReminderPB[] = [];
  const owner = { workspaceId: 'workspace', actorId: 'actor', contextKey: 'context', isCurrent: () => active };
  const documentBackend: HyperDocumentBackend = { open: async () => saved, read: async () => saved, apply: vi.fn(async () => { saved = session.store.getState().document!; }), close: async () => {}, history: async () => {}, listen: () => () => {} };
  const session = new HyperDocumentSession('document', documentBackend, owner); await session.flush();
  const backend: HyperDocumentDateBackend = { identity: async () => ({ workspaceId: 'workspace', actorId: 'actor' }), view: async id => create(ViewPBSchema, { id, layout: ViewLayoutPB.Document }), row: vi.fn(), reminders: vi.fn(async () => reminders), create: vi.fn(async next => { reminders.push(next); }), update: vi.fn(async next => { reminders = reminders.map(old => old.id === next.id ? next : old); }), remove: vi.fn(async id => { reminders = reminders.filter(old => old.id !== id); }), changed: vi.fn() };
  const store = createHyperDocumentDateStore({ session, owner, editable: () => editable, currentOwner: () => active ? owner : null }, backend); store.start();
  const target = hyperCaptureMentionSelection(session.store.getState().document!, { id: 'p', selection: { start: 2, end: 2 } });
  return { store, session, backend, documentBackend, target, reminders: () => reminders, seed: (value: ReminderPB[]) => { reminders = value; }, lock: () => { editable = false; }, deactivate: () => { active = false; } };
}
describe('Hyper document date and reminder saving', () => {
  it('opens without writes, saves the date before creating a native reminder, then edits and removes the same ID', async () => {
    const f = await fixture(); await f.store.open(null, f.target); expect(f.backend.create).not.toHaveBeenCalled(); expect(f.documentBackend.apply).not.toHaveBeenCalled();
    const focus = await f.store.save(draft()); expect(focus).toEqual({ id: 'p', offset: 3 }); expect(f.backend.create).toHaveBeenCalledOnce();
    const reminder = f.reminders()[0]; expect(reminder).toMatchObject({ objectId: 'document', meta: { block_id: 'p', include_time: 'true' } }); expect(reminder.scheduledAt).toBe(hyperDocumentDateSchedule(draft(), hyperDocumentDateValue(draft()))); expect(reminder.meta.date).toBe(String(hyperParseLocalDateTime('2030-03-04', '10:30:00').getTime()));
    await expect(f.store.save(draft())).rejects.toThrow('Reopen');
    let target = hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0); await f.store.open(target);
    await f.store.save({ ...f.store.getState().draft, reminderOption: 'oneHourBefore' }); expect(f.reminders()[0].id).toBe(reminder.id); expect(f.backend.update).toHaveBeenCalledOnce();
    target = hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0); await f.store.open(target); await f.store.save({ ...f.store.getState().draft, reminderOption: 'none' }); expect(f.backend.remove).toHaveBeenCalledExactlyOnceWith(reminder.id); expect(f.reminders()).toEqual([]); expect(hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0).mention.reminder_id).toBeUndefined();
    f.store.dispose(); await f.session.dispose();
  });
  it.each(['owner', 'lock'] as const)('rejects a stale %s before any date or reminder writes', async reason => {
    const f = await fixture(); await f.store.open(null, f.target); reason === 'owner' ? f.deactivate() : f.lock(); await expect(f.store.save(draft())).rejects.toThrow(); expect(f.documentBackend.apply).not.toHaveBeenCalled(); expect(f.backend.create).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('rejects a stale text target and preserves unrelated block edits', async () => {
    const f = await fixture(); await f.store.open(null, f.target); f.session.change(doc => hyperInsertBlock(doc, doc.pageId, 'p', 'paragraph')); await f.session.flush(); await f.store.save(draft()); expect(Object.keys(f.session.store.getState().document!.blocks)).toHaveLength(3);
    const target = hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0); await f.store.open(target); f.session.change(doc => hyperEditText(doc, 'p', [{ insert: 'Concurrent edit' }])); await f.session.flush(); await expect(f.store.save(draft())).rejects.toThrow('text changed'); expect(f.backend.update).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('keeps explicit recovery data after a reminder failure without inserting or replaying twice', async () => {
    const f = await fixture(); await f.store.open(null, f.target); f.backend.create = vi.fn(async () => { throw new Error('Unavailable'); }); await expect(f.store.save(draft())).rejects.toThrow('Unavailable'); expect(f.store.getState().status).toBe('partial'); expect(f.store.getState().recovery).toContain('scheduledAtSeconds'); expect(f.store.getState().recovery).toContain('reminder_id'); await expect(f.store.save(draft())).rejects.toThrow('Reopen'); expect(f.backend.create).toHaveBeenCalledOnce(); expect(hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0).mention).toBeDefined(); f.store.dispose(); await f.session.dispose();
  });
  it('does not create a reminder after an uncertain document save', async () => {
    const f = await fixture(); await f.store.open(null, f.target); f.documentBackend.apply = vi.fn(async () => { throw new Error('Disk error'); }); await expect(f.store.save(draft())).rejects.toThrow('Disk error'); expect(f.store.getState().status).toBe('partial'); expect(f.backend.create).not.toHaveBeenCalled(); expect(f.store.getState().recovery).toContain('document'); f.store.dispose(); await f.session.dispose();
  });
  it('rejects a reminder ID bound to another block and preserves existing metadata on updates', async () => {
    const f = await fixture(); await f.store.open(null, f.target); await f.store.save(draft()); const original = f.reminders()[0];
    f.seed([create(ReminderPBSchema, { ...original, meta: { ...original.meta, extra: 'keep' }, isRead: true })]); let target = hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0); await f.store.open(target); await f.store.save(draft()); expect(f.reminders()[0].meta.extra).toBe('keep'); expect(f.reminders()[0].isRead).toBe(true);
    f.seed([create(ReminderPBSchema, { ...original, meta: { ...original.meta, block_id: 'other' } })]); target = hyperCaptureDocumentDate(f.session.store.getState().document!, 'p', 0); await f.store.open(target); expect(f.store.getState().status).toBe('error'); f.store.dispose(); await f.session.dispose();
  });
});
