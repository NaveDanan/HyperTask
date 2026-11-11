import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { HyperDatabaseDraftBlocked, HyperDatabaseDraftRegistry, type HyperDatabaseDraftLease, type HyperDatabaseDraftMutation, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';

function fixture(type = FieldType.RichText) {
  let current = true, writable = true, present = true, fail = false;
  let field = create(FieldPBSchema, { id: 'field', name: 'Title', fieldType: type });
  let bytes = type === FieldType.SingleSelect || type === FieldType.MultiSelect ? new Uint8Array() : new TextEncoder().encode('Saved');
  const owner: HyperDatabaseDraftOwner = { contextKey: '["storage","local",""]', workspaceId: 'workspace', actorId: 'actor', isCurrent: () => current };
  const registry = new HyperDatabaseDraftRegistry(), controller = registry.get(owner, 'database', 'row', field);
  const writes: HyperDatabaseDraftMutation[] = [];
  let pause: (() => Promise<void>) | null = null;
  const repository = { cell: async () => create(CellPBSchema, { data: bytes }) } as unknown as HyperDatabaseRepository;
  const lease: HyperDatabaseDraftLease = {
    repository, viewId: 'view', current: () => current && writable, saved: () => {},
    read: async () => { if (!present) throw new HyperDatabaseDraftBlocked('unavailable'); return { field, cell: create(CellPBSchema, { data: bytes }) }; },
    execute: async (mutation, _prepared, check, sent) => { await check(); sent(); writes.push(mutation); if (pause) await pause(); if (fail) throw Error('Offline'); if (mutation.method === 'updateText') bytes = new TextEncoder().encode(String(mutation.args[3])); },
  };
  const detach = controller.attach(lease);
  return { owner, registry, controller, lease, writes, detach, load: () => controller.load(repository, 'view', field), setCurrent: (value: boolean) => { current = value; }, setWritable: (value: boolean) => { writable = value; }, setPresent: (value: boolean) => { present = value; }, setFail: (value: boolean) => { fail = value; }, setBytes: (value: string) => { bytes = new TextEncoder().encode(value); }, setField: (value: typeof field) => { field = value; }, getField: () => field, pause: (value: () => Promise<void>) => { pause = value; } };
}

describe('owner-scoped database draft records', () => {
  it('retains dirty values after eviction and releases clean records after their last lease', async () => {
    const f = fixture(); await f.load(); f.controller.edit('LOCAL UNSAVED'); f.detach(); f.registry.release(f.controller); await Promise.resolve();
    expect(f.registry.pending(f.owner, 'database')).toEqual([f.controller]);
    expect(f.registry.get(f.owner, 'database', 'row', f.getField())).toBe(f.controller);
    expect(f.controller.copyText()).toBe('LOCAL UNSAVED'); expect(f.writes).toEqual([]);
    f.controller.discard(); await Promise.resolve();
    expect(f.registry.get(f.owner, 'database', 'row', f.getField())).not.toBe(f.controller);
  });
  it('shares a version and latest value between leases of the same underlying cell', async () => {
    const f = fixture(); await f.load(); const second = { ...f.lease, viewId: 'linked' }; const close = f.controller.attach(second);
    f.controller.edit('From first pane'); const same = f.registry.get({ ...f.owner }, 'database', 'row', f.getField());
    same.edit('Latest from second pane'); expect(f.controller.getSnapshot().draft).toBe('Latest from second pane');
    expect(f.controller.getSnapshot().version).toBe(2); f.detach(); expect(same.getSnapshot().leases).toBe(1);
    expect(await same.saveText(second)).toBe(true); expect(f.writes[0].args).toEqual(['linked', 'row', 'field', 'Latest from second pane']); close();
  });
  it.each(['contextKey', 'workspaceId', 'actorId'] as const)('never exposes or shares a draft across a changed %s', async key => {
    const f = fixture(); await f.load(); f.controller.edit('Private draft');
    const other = { ...f.owner, [key]: 'different' };
    expect(f.registry.pending(other, 'database')).toEqual([]); expect(f.registry.get(other, 'database', 'row', f.getField())).not.toBe(f.controller);
    expect(f.registry.pending(f.owner, 'another-database')).toEqual([]);
  });
  it('does not copy or discard through an owner that is no longer current', async () => {
    const f = fixture(); await f.load(); f.controller.edit('Private draft'); f.setCurrent(false);
    expect(f.registry.pending(f.owner, 'database')).toEqual([]); expect(f.controller.copyText()).toBe(''); expect(f.controller.discard()).toBe(false);
    expect(await f.controller.retry(f.lease)).toBe(false); expect(f.writes).toHaveLength(0);
    f.setCurrent(true); expect(f.controller.copyText()).toBe('Private draft');
  });
  it('keeps failed writes and retries captured values through a fresh lease after eviction', async () => {
    const f = fixture(); await f.load(); f.controller.edit('Retry this'); f.setFail(true); expect(await f.controller.saveText(f.lease)).toBe(false); f.detach();
    f.setFail(false); const recovery = { ...f.lease, viewId: 'linked' }; expect(await f.controller.retry(recovery)).toBe(true);
    expect(f.writes.map(write => write.args[0])).toEqual(['view', 'linked']); expect(f.controller.pending).toBe(false);
  });
  it('refuses changed source bytes and never overwrites the new server value', async () => {
    const f = fixture(); await f.load(); f.controller.edit('Local'); f.setBytes('Changed by another user');
    expect(await f.controller.retry(f.lease)).toBe(false); expect(f.controller.getSnapshot().issue).toBe('changed'); expect(f.writes).toEqual([]); expect(f.controller.copyText()).toBe('Local');
  });
  it.each(['type', 'options'] as const)('retains a separate record after a property changes its %s', async change => {
    const f = fixture(); await f.load(); f.controller.edit('Local');
    const field = create(FieldPBSchema, { ...f.getField(), ...(change === 'type' ? { fieldType: FieldType.Number } : { typeOptionData: new Uint8Array([1, 2]) }) }); f.setField(field);
    expect(f.registry.get(f.owner, 'database', 'row', field)).not.toBe(f.controller);
    expect(await f.controller.retry(f.lease)).toBe(false); expect(f.writes).toHaveLength(0); expect(f.controller.copyText()).toBe('Local');
  });
  it('retains draft recovery after a hidden/removed row or read-only permission blocks a save', async () => {
    const f = fixture(); await f.load(); f.controller.edit('Local'); f.setPresent(false); f.detach(); expect(await f.controller.retry(f.lease)).toBe(false);
    expect(f.controller.copyText()).toBe('Local'); f.setPresent(true); f.setWritable(false); expect(await f.controller.retry(f.lease)).toBe(false); expect(f.writes).toEqual([]);
    f.setWritable(true); expect(await f.controller.retry(f.lease)).toBe(true);
  });
  it('checks ownership again after an asynchronous read and sends no mutation after a switch', async () => {
    const f = fixture(); await f.load(); f.controller.edit('Local');
    let resolve!: () => void; const original = f.lease.read; f.lease.read = async target => { await new Promise<void>(done => { resolve = done; }); return original(target); };
    const save = f.controller.saveText(f.lease); f.setCurrent(false); resolve(); expect(await save).toBe(false); expect(f.writes).toEqual([]);
  });
  it('keeps a newer shared draft when an older in-flight write finishes', async () => {
    const f = fixture(); await f.load(); f.controller.edit('First'); let resolve!: () => void;
    f.pause(() => new Promise<void>(done => { resolve = done; })); const saving = f.controller.saveText(f.lease);
    while (!resolve) await Promise.resolve(); f.controller.edit('Second'); resolve(); expect(await saving).toBe(false);
    expect(f.controller.getSnapshot().draft).toBe('Second'); expect(f.controller.pending).toBe(true);
    f.pause(async () => {}); expect(await f.controller.retry(f.lease)).toBe(true); expect(f.writes.at(-1)?.args[3]).toBe('Second');
  });
  it('retains uncertain already-sent writes after owner loss and never replays them automatically', async () => {
    const f = fixture(); await f.load(); f.controller.edit('Sent draft'); let resolve!: () => void;
    f.pause(() => new Promise<void>(done => { resolve = done; })); const saving = f.controller.saveText(f.lease); while (!resolve) await Promise.resolve();
    f.setCurrent(false); resolve(); expect(await saving).toBe(false); expect(f.controller.getSnapshot().issue).toBe('uncertain');
    f.setCurrent(true); expect(await f.controller.retry(f.lease)).toBe(false); expect(f.writes).toHaveLength(1); expect(f.controller.copyText()).toBe('Sent draft');
  });
  it('copies the attempted value for failed checkbox or AI commands without a text-input draft', async () => {
    const f = fixture(); await f.load(); f.setFail(true);
    expect(await f.controller.runMutation(f.lease, { method: 'updateText', args: ['view', 'row', 'field', 'Attempted checkbox or AI value'] })).toBe(false);
    expect(f.controller.copyText()).toBe('Attempted checkbox or AI value');
  });
  it('keeps typed date changesets and their bigint timestamps copyable after failure', async () => {
    const f = fixture(); await f.load(); f.controller.editForm('date.start', '2026-11-11'); f.setFail(true);
    expect(await f.controller.runMutation(f.lease, { method: 'updateDateDetails', args: ['view', 'row', 'field', { timestamp: 0n, endTimestamp: 3600n, includeTime: true, isRange: true }] })).toBe(false);
    const copied = JSON.parse(f.controller.copyText()); expect(copied.operation.args[3].timestamp).toBe('0'); expect(copied.inputs['date.start']).toBe('2026-11-11');
    f.setFail(false); expect(await f.controller.retry(f.lease)).toBe(true); expect(f.controller.getSnapshot().forms).toEqual({});
  });
  it('copies immutable mutation arguments instead of retaining a stale retry callback', async () => {
    const f = fixture(); await f.load(); f.setFail(true); const next = ['selected']; let calls = 0;
    const operation = async () => { calls++; await f.controller.executePrepared(f.lease, { method: 'updateSelect', args: ['view', 'row', 'field', [], next] }); };
    expect(await f.controller.run(f.lease, operation)).toBe(false); next.push('mutated-later'); f.setFail(false);
    expect(await f.controller.retry(f.lease)).toBe(true); expect(calls).toBe(1); expect(f.writes.at(-1)?.args[4]).toEqual(['selected']);
  });
  it('accepts a successfully created select option changing its own property options', async () => {
    const f = fixture(FieldType.SingleSelect); await f.load();
    const execute = f.lease.execute;
    f.lease.execute = async (...args) => { await execute(...args); f.setField(create(FieldPBSchema, { ...f.getField(), typeOptionData: new Uint8Array([1]) })); };
    expect(await f.controller.runMutation(f.lease, { method: 'createSelectOption', args: ['view', 'row', 'field', 'New option'] })).toBe(true);
    expect(f.controller.getSnapshot().issue).toBe(null); expect(f.controller.pending).toBe(false);
  });

  it('retains unsent checklist/media form inputs and does not clear them after an unrelated operation', async () => {
    const f = fixture(); await f.load(); f.controller.editForm('newTask', 'Unsent new task'); f.controller.editForm('task:task', 'Renamed task', 'Original');
    expect(await f.controller.runMutation(f.lease, { method: 'checklist', args: ['view', 'row', 'field', { completedTasks: ['task'] }] })).toBe(true);
    expect(f.controller.getSnapshot().forms).toEqual({ newTask: 'Unsent new task', 'task:task': 'Renamed task' }); expect(f.controller.pending).toBe(true);
    f.detach(); expect(f.controller.copyText()).toContain('Unsent new task'); expect(f.controller.retryable).toBe(false);
  });
});
