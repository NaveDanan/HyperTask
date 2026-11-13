import { clone, create, fromJsonString } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { BlockPBSchema, ChildrenPBSchema, DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ReminderPBSchema } from '@shared/protobuf/flowy-user/reminder_pb';
import { HyperDocumentDuplicateService, type HyperDocumentDuplicateBackend } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateService';
import { hyperDuplicateDateReferences, hyperDuplicateDocumentSnapshot, hyperDuplicateReminderId, hyperRemapDuplicateDocument } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateModel';
import type { HyperDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';

const sourceId = '329ff418-5bfa-439d-9863-202918c90550', targetId = '91444e6d-f9ec-40b9-94c0-420f29128fc9';
const sourceDate = { type: 'reminder', date: '2031-05-06T10:30:00.123', include_time: true, reminder_id: 'original', reminder_option: 'custom', unknown: 'keep' };
function document(id = 'original', atoms = '$'): DocumentDataPB {
  return create(DocumentDataPBSchema, { pageId: 'block', blocks: { block: create(BlockPBSchema, { id: 'block', ty: 'paragraph', data: '{"keep":"block"}', childrenId: 'children', oneOfExternalId: { case: 'externalId', value: 'text' }, oneOfExternalType: { case: 'externalType', value: 'text' } }) }, meta: { childrenMap: { children: create(ChildrenPBSchema) }, textMap: { text: JSON.stringify([{ insert: '😀x' }, { insert: atoms, unknown_run: true, attributes: { bold: true, mention: { ...sourceDate, reminder_id: id }, unknown_outer: { keep: true } } }]) } } });
}
function fixture() {
  let realm = 'one', actor = 'actor', current = true, revision = 0;
  const owner: HyperDocumentOwner = { workspaceId: 'workspace', actorId: actor, contextKey: realm, isCurrent: () => current && realm === 'one' && actor === 'actor' };
  const views = new Map<string, ViewPB>(), docs = new Map<string, DocumentDataPB>([[sourceId, document()]]), source = create(ViewPBSchema, { id: sourceId, name: 'Source', parentViewId: 'parent', layout: ViewLayoutPB.Document }); views.set(sourceId, source);
  const reminders = [create(ReminderPBSchema, { id: 'original', objectId: sourceId, scheduledAt: 1935741900n, title: 'Custom title', message: 'Custom message', isRead: true, meta: { block_id: 'block', custom_unknown: 'keep', is_archived: 'true' } })];
  const calls: string[] = [];
  let next = 0;
  const backend: HyperDocumentDuplicateBackend = {
    owner: () => ({ workspaceId: 'workspace', actorId: actor, contextKey: realm, isCurrent: () => current }),
    ownerVersion: () => revision,
    identity: vi.fn(async () => ({ workspaceId: 'workspace', actorId: actor })),
    writable: vi.fn(async id => { calls.push(`write:${id}`); }),
    view: vi.fn(async id => { const view = views.get(id); if (!view) throw new Error('Missing view'); return clone(ViewPBSchema, view); }),
    views: vi.fn(async () => Array.from(views.values()).map(view => clone(ViewPBSchema, view))),
    flush: vi.fn(async id => { calls.push(`flush:${id}`); }),
    document: vi.fn(async id => { calls.push(`read:${id}`); return clone(DocumentDataPBSchema, docs.get(id)!); }),
    reminders: vi.fn(async () => reminders.map(reminder => clone(ReminderPBSchema, reminder))),
    create: vi.fn(async reminder => { calls.push(`create:${reminder.id}`); reminders.push(clone(ReminderPBSchema, reminder)); }),
    duplicate: vi.fn(async options => {
      const copy = (source: ViewPB, parentViewId: string, root: boolean): ViewPB => {
        const id = next++ === 0 ? targetId : crypto.randomUUID(), target = create(ViewPBSchema, { ...source, id, parentViewId, name: root ? `${source.name}${options.suffix ?? ' (copy)'}` : source.name, childViews: [] });
        if (docs.has(source.id)) docs.set(id, hyperRemapDuplicateDocument(docs.get(source.id)!, id));
        if (options.includeChildren) target.childViews = source.childViews.filter(child => child.layout !== ViewLayoutPB.Chat).map(child => copy(views.get(child.id)!, id, false));
        views.set(id, target); return target;
      };
      return copy(views.get(options.view.id)!, options.parentViewId ?? 'parent', true);
    }),
    open: vi.fn(async id => { calls.push(`open:${id}`); }), changed: vi.fn(),
  };
  const service = new HyperDocumentDuplicateService(backend), options = { view: source, openAfterDuplicate: true, includeChildren: true, syncAfterDuplicate: true, owner };
  return { backend, service, options, owner, views, docs, reminders, calls, source, switchRealm: () => { realm = 'two'; revision++; }, returnRealm: () => { realm = 'one'; revision++; }, switchActor: () => { actor = 'other'; revision++; }, lose: () => { current = false; revision++; } };
}

describe('Hyper document duplicate model', () => {
  it('matches UUIDv5 UTF-16 mapping, splits repeated atoms and preserves legacy and unknown attributes', () => {
    const source = document('original', '$$'), copied = hyperRemapDuplicateDocument(source, targetId), refs = hyperDuplicateDateReferences(copied);
    expect(refs.map(ref => ref.offset)).toEqual([3, 4]);
    expect(refs.map(ref => ref.id)).toEqual([hyperDuplicateReminderId(targetId, 'block', 3, 'original'), hyperDuplicateReminderId(targetId, 'block', 4, 'original')]);
    expect(refs[0].id).toBe('f104cd8e-c75a-5eb8-9bf0-6a08455b3e17');
    expect(refs[0].mention).toMatchObject({ ...sourceDate, reminder_id: refs[0].id }); expect(refs[0].attributes).toMatchObject({ bold: true, unknown_outer: { keep: true } });
    expect(hyperDuplicateDocumentSnapshot(copied).digest).toBe(hyperDuplicateDocumentSnapshot(source).digest);
    expect(hyperDuplicateDateReferences(source).map(ref => ref.id)).toEqual(['original', 'original']);
  });
  it.each(['external', 'inline', 'detached'])('rejects unsupported %s object inserts before copying', mode => {
    const doc = document(), embed = JSON.stringify([{ insert: { legacy: 'keep' } }]);
    if (mode === 'external') doc.meta!.textMap.text = embed;
    else if (mode === 'inline') doc.blocks.block.data = `{"delta":${embed}}`;
    else doc.meta!.textMap.detached = embed;
    expect(() => hyperDuplicateDocumentSnapshot(doc)).toThrow('cannot be copied safely');
  });
  it('rejects shared reminder text owners and repeated block paths', () => {
    const shared = document(); shared.blocks.second = create(BlockPBSchema, { ...shared.blocks.block, id: 'second' }); expect(() => hyperDuplicateDocumentSnapshot(shared)).toThrow('more than one block');
    const repeated = document(); repeated.meta!.childrenMap.children.children = ['block']; expect(() => hyperDuplicateDocumentSnapshot(repeated)).toThrow('repeated blocks');
  });
});

describe('Hyper document duplicate owner and recovery service', () => {
  it('clones exact custom timers into independent IDs without writing the source, then opens the copy', async () => {
    const f = fixture(), before = JSON.stringify(f.docs.get(sourceId)), original = clone(ReminderPBSchema, f.reminders[0]);
    expect((await f.service.duplicate(f.options)).ok).toBe(true); expect(f.backend.duplicate).toHaveBeenCalledTimes(1); expect(f.backend.duplicate).toHaveBeenCalledWith(expect.objectContaining({ openAfterDuplicate: false }));
    expect(f.reminders).toHaveLength(2); expect(f.reminders[0]).toEqual(original); expect(JSON.stringify(f.docs.get(sourceId))).toBe(before);
    expect(f.reminders[1]).toMatchObject({ id: hyperDuplicateReminderId(targetId, 'block', 3, 'original'), objectId: targetId, scheduledAt: original.scheduledAt, isRead: true, meta: { custom_unknown: 'keep', is_archived: 'true' } });
    expect(f.calls.at(-1)).toBe(`open:${targetId}`); expect(f.service.store.getState().plans).toEqual([]);
  });
  it('copies accessible document descendants with repeated names and independent bindings', async () => {
    const f = fixture(), childId = crypto.randomUUID(), child = create(ViewPBSchema, { id: childId, name: 'Source', parentViewId: sourceId, layout: ViewLayoutPB.Document }); f.views.set(childId, child); f.source.childViews.push(child); f.docs.set(childId, document('child-reminder'));
    f.reminders.push(create(ReminderPBSchema, { id: 'child-reminder', objectId: childId, scheduledAt: 1935741901n, meta: { block_id: 'block' } }));
    expect((await f.service.duplicate(f.options)).ok).toBe(true); expect(f.reminders).toHaveLength(4); expect(new Set(f.reminders.map(reminder => reminder.objectId)).size).toBe(4);
  });
  it('flushes source sessions and aborts unsafe descendants before any Duplicate call', async () => {
    const f = fixture(); f.docs.get(sourceId)!.meta!.textMap.text = '[{"insert":{"legacy":"keep"}}]';
    expect((await f.service.duplicate(f.options)).ok).toBe(false); expect(f.backend.flush).toHaveBeenCalledWith(sourceId, f.owner); expect(f.backend.duplicate).not.toHaveBeenCalled(); expect(f.reminders).toHaveLength(1);
  });
  it('blocks missing legacy custom schedules and wrong source reminder bindings', async () => {
    const missing = fixture(); missing.reminders.splice(0); expect((await missing.service.duplicate(missing.options)).ok).toBe(false); expect(missing.backend.duplicate).not.toHaveBeenCalled();
    const wrong = fixture(); wrong.reminders[0].objectId = 'other'; expect((await wrong.service.duplicate(wrong.options)).ok).toBe(false); expect(wrong.backend.duplicate).not.toHaveBeenCalled();
    for (const mode of ['pending-custom', 'disabled']) { const pending = fixture(), doc = pending.docs.get(sourceId)!, runs = JSON.parse(doc.meta!.textMap.text); if (mode === 'pending-custom') runs[1].attributes.hyper_reminder = { version: 1, custom_scheduled_at_seconds: '1935741907' }; else runs[1].attributes.mention.reminder_option = 'none'; doc.meta!.textMap.text = JSON.stringify(runs); expect((await pending.service.duplicate(pending.options)).ok).toBe(false); expect(pending.backend.duplicate).not.toHaveBeenCalled(); }
  });
  it('checks realm/account ownership before dispatch and after awaited reads', async () => {
    for (const mode of ['before', 'realm', 'actor']) {
      const f = fixture(); if (mode === 'before') f.switchRealm(); else vi.mocked(f.backend.flush).mockImplementation(async () => mode === 'realm' ? f.switchRealm() : f.switchActor());
      expect((await f.service.duplicate(f.options)).ok).toBe(false); expect(f.backend.duplicate).not.toHaveBeenCalled(); expect(f.backend.create).not.toHaveBeenCalled();
    }
  });
  it('retains a successful create with a lost acknowledgment and retries only missing sidecars', async () => {
    const f = fixture(), createReminder = f.backend.create; vi.mocked(f.backend.create).mockImplementationOnce(async reminder => { f.reminders.push(clone(ReminderPBSchema, reminder)); throw new Error('Lost acknowledgment'); });
    expect((await f.service.duplicate(f.options)).ok).toBe(false); const plan = f.service.store.getState().plans[0]; expect(plan.rootId).toBe(targetId);
    expect((await f.service.duplicate(f.options)).ok).toBe(false); expect(f.backend.duplicate).toHaveBeenCalledTimes(1);
    expect(await f.service.retry(plan.id, f.owner)).toBe(true); expect(createReminder).toHaveBeenCalledTimes(1); expect(f.reminders).toHaveLength(2); expect(f.backend.duplicate).toHaveBeenCalledTimes(1);
  });
  it('requires explicit validated copy selection after an uncertain Duplicate acknowledgment', async () => {
    const f = fixture(), perform = vi.mocked(f.backend.duplicate).getMockImplementation()!;
    vi.mocked(f.backend.duplicate).mockImplementationOnce(async options => { await perform(options); throw new Error('Lost copy acknowledgment'); });
    expect((await f.service.duplicate(f.options)).ok).toBe(false);
    const plan = f.service.store.getState().plans[0]; expect(plan.rootId).toBe(null);
    expect(await f.service.candidates(plan.id, f.owner)).toEqual([{ id: targetId, name: 'Source (copy)' }]);
    expect(await f.service.retry(plan.id, f.owner)).toBe(false);
    expect(await f.service.retry(plan.id, f.owner, sourceId)).toBe(false);
    expect(await f.service.retry(plan.id, f.owner, targetId)).toBe(true);
    expect(f.backend.duplicate).toHaveBeenCalledTimes(1); expect(f.reminders).toHaveLength(2);
  });
  it('retains exact recovery details under the original owner and rejects conflicting copied timers', async () => {
    const f = fixture(); vi.mocked(f.backend.create).mockRejectedValueOnce(new Error('Offline')); await f.service.duplicate(f.options); const plan = f.service.store.getState().plans[0];
    expect(f.service.recovery(plan.id, f.owner)).toContain('1935741900'); const desired = fromJsonString(ReminderPBSchema, plan.targets![0].references[0].desired); desired.scheduledAt++; f.reminders.push(desired);
    expect(await f.service.retry(plan.id, f.owner)).toBe(false); expect(f.backend.create).toHaveBeenCalledTimes(1); expect(f.backend.duplicate).toHaveBeenCalledTimes(1);
    f.switchRealm(); expect(f.service.recovery(plan.id, f.owner)).toBe(''); expect(await f.service.retry(plan.id, f.owner)).toBe(false); expect(f.backend.create).toHaveBeenCalledTimes(1);
  });
  it('allows unrelated target text edits during recovery and rejects changed dates', async () => {
    const f = fixture(); vi.mocked(f.backend.create).mockRejectedValueOnce(new Error('Offline')); await f.service.duplicate(f.options); const plan = f.service.store.getState().plans[0];
    const doc = f.docs.get(targetId)!, runs = JSON.parse(doc.meta!.textMap.text); runs[0].insert = 'Unrelated edit 😀'; doc.meta!.textMap.text = JSON.stringify(runs);
    expect(await f.service.retry(plan.id, f.owner)).toBe(true);
    const changed = fixture(); vi.mocked(changed.backend.create).mockRejectedValueOnce(new Error('Offline')); await changed.service.duplicate(changed.options); const pending = changed.service.store.getState().plans[0], copied = changed.docs.get(targetId)!, altered = JSON.parse(copied.meta!.textMap.text); altered[1].attributes.mention.date = '2032-01-01'; copied.meta!.textMap.text = JSON.stringify(altered);
    expect(await changed.service.retry(pending.id, changed.owner)).toBe(false); expect(changed.backend.create).toHaveBeenCalledTimes(1);
  });
  it('allocates one timer per repeated atom and recovers custom schedules encoded without a source sidecar', async () => {
    const repeated = fixture(); repeated.docs.set(sourceId, document('original', '$$'));
    expect((await repeated.service.duplicate(repeated.options)).ok).toBe(true); expect(repeated.reminders).toHaveLength(3); expect(new Set(repeated.reminders.map(item => item.id)).size).toBe(3);
    const encoded = fixture(); encoded.reminders.splice(0); const doc = encoded.docs.get(sourceId)!, runs = JSON.parse(doc.meta!.textMap.text); runs[1].attributes.hyper_reminder = { version: 1, custom_scheduled_at_seconds: '1935741907', keep: true }; doc.meta!.textMap.text = JSON.stringify(runs);
    expect((await encoded.service.duplicate(encoded.options)).ok).toBe(true); expect(encoded.reminders).toHaveLength(1); expect(encoded.reminders[0].scheduledAt).toBe(1935741907n);
  });
  it('retains changed source schedules and denied target permissions without replaying copy', async () => {
    const changed = fixture(), copy = vi.mocked(changed.backend.duplicate).getMockImplementation()!;
    vi.mocked(changed.backend.duplicate).mockImplementationOnce(async options => { const result = await copy(options); changed.reminders[0].scheduledAt++; return result; });
    expect((await changed.service.duplicate(changed.options)).ok).toBe(false); expect(changed.backend.create).not.toHaveBeenCalled(); expect(changed.service.store.getState().plans[0].error).toContain('source reminder changed');
    const denied = fixture(); let writable = false; vi.mocked(denied.backend.writable).mockImplementation(async id => { if (id === targetId && !writable) throw new Error('Permission removed'); });
    expect((await denied.service.duplicate(denied.options)).ok).toBe(false); const plan = denied.service.store.getState().plans[0]; expect(denied.backend.create).not.toHaveBeenCalled(); writable = true;
    expect(await denied.service.retry(plan.id, denied.owner)).toBe(true); expect(denied.backend.duplicate).toHaveBeenCalledTimes(1);
  });
  it('keeps owner-scoped recovery after an in-flight create and preserves already-applied metadata on retry', async () => {
    const f = fixture(); let release!: () => void;
    vi.mocked(f.backend.create).mockImplementationOnce(async reminder => { f.reminders.push(clone(ReminderPBSchema, reminder)); await new Promise<void>(resolve => { release = resolve; }); });
    const result = f.service.duplicate(f.options);
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    f.lose(); release(); expect((await result).ok).toBe(false); expect(f.service.store.getState().plans[0].rootId).toBe(targetId); expect(f.backend.open).not.toHaveBeenCalled();
    const preserved = fixture(); vi.mocked(preserved.backend.create).mockImplementationOnce(async reminder => { preserved.reminders.push(clone(ReminderPBSchema, reminder)); throw new Error('Lost acknowledgment'); });
    await preserved.service.duplicate(preserved.options); const plan = preserved.service.store.getState().plans[0]; preserved.reminders[1].meta.later_unknown = 'keep'; preserved.reminders[1].isRead = false;
    expect(await preserved.service.retry(plan.id, preserved.owner)).toBe(true); expect(preserved.reminders[1].meta.later_unknown).toBe('keep'); expect(preserved.reminders[1].isRead).toBe(false); expect(preserved.backend.create).toHaveBeenCalledTimes(1);
  });
  it('keeps an away-and-back native copy cancelled until an explicit recovery attempt', async () => {
    const f = fixture(), copy = vi.mocked(f.backend.duplicate).getMockImplementation()!; let release!: () => void;
    vi.mocked(f.backend.duplicate).mockImplementationOnce(async options => { const root = await copy(options); await new Promise<void>(resolve => { release = resolve; }); return root; });
    const result = f.service.duplicate(f.options); while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    f.switchRealm(); f.returnRealm(); release(); expect((await result).ok).toBe(false); expect(f.backend.create).not.toHaveBeenCalled(); expect(f.backend.open).not.toHaveBeenCalled();
    const plan = f.service.store.getState().plans[0]; expect(await f.service.retry(plan.id, f.owner)).toBe(true); expect(f.backend.duplicate).toHaveBeenCalledTimes(1);
  });
  it('observes an already-created matching timer after the final permission check instead of appending it twice', async () => {
    const f = fixture(); let targetChecks = 0;
    vi.mocked(f.backend.writable).mockImplementation(async id => { if (id === targetId && ++targetChecks === 2) { const desired = f.service.store.getState().plans[0].targets![0].references[0].desired; f.reminders.push(fromJsonString(ReminderPBSchema, desired)); } });
    expect((await f.service.duplicate(f.options)).ok).toBe(true); expect(f.reminders).toHaveLength(2); expect(f.backend.create).not.toHaveBeenCalled();
  });
  it('compares protobuf reminder maps semantically when native read ordering changes', async () => {
    const f = fixture(); let reads = 0;
    vi.mocked(f.backend.reminders).mockImplementation(async () => f.reminders.map(item => create(ReminderPBSchema, { ...item, meta: Object.fromEntries(++reads % 2 ? Object.entries(item.meta) : Object.entries(item.meta).reverse()) })));
    expect((await f.service.duplicate(f.options)).ok).toBe(true); expect(f.backend.duplicate).toHaveBeenCalledTimes(1); expect(f.reminders).toHaveLength(2);
  });
});
