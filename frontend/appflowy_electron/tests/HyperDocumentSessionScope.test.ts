import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { HyperDocumentSession, HyperDocumentSessionPool, type HyperDocumentBackend, type HyperDocumentScope } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperBlockText, hyperEditText, hyperPlainText } from '../src/renderer/features/document/HyperDocumentModel';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(value => { resolve = value; }); return { promise, resolve }; };
const doc = (text: string) => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' }, p: { id: 'p', ty: 'paragraph', data: JSON.stringify({ delta: [{ insert: text }] }), childrenId: 'pchildren', parentId: 'root' } }, meta: { childrenMap: { children: { children: ['p'] } } } });
const text = (session: HyperDocumentSession) => { const value = session.store.getState().document; return value ? hyperPlainText(hyperBlockText(value, value.blocks.p)) : null; };
function fixture() {
  let owner = { workspaceId: 'workspace-a', actorId: 'alice', contextKey: '' };
  const ownerKey = () => JSON.stringify(owner);
  const calls: string[] = [], stops: Array<ReturnType<typeof vi.fn>> = [], listeners: Array<() => void> = [];
  const backend: HyperDocumentBackend = {
    open: vi.fn(async () => { calls.push(`open:${owner.actorId}`); return doc(`${owner.actorId} saved`); }),
    read: vi.fn(async () => { calls.push(`read:${owner.actorId}`); return doc(`${owner.actorId} refreshed`); }),
    apply: vi.fn(async () => { calls.push(`apply:${owner.actorId}`); }),
    history: vi.fn(async () => { calls.push(`history:${owner.actorId}`); }),
    close: vi.fn(async () => { calls.push(`close:${owner.actorId}`); }),
    listen: vi.fn((_id, callback) => { listeners.push(callback); const stop = vi.fn(); stops.push(stop); return stop; }),
  };
  const scope = (): HyperDocumentScope => { const captured = { ...owner }, key = ownerKey(); return { ...captured, isCurrent: () => ownerKey() === key }; };
  return { pool: new HyperDocumentSessionPool(backend), backend, calls, stops, listeners, scope, setOwner: (next: Partial<typeof owner>) => { owner = { ...owner, ...next }; } };
}
describe('Hyper document sessions owned by workspace and actor', () => {
  it.each(['actor', 'workspace', 'server'] as const)('isolates retained failed drafts across a different %s and returns them only to the original owner', async change => {
    const f = fixture(), alice = f.scope(), first = await f.pool.acquire('same-document-id', alice); await first.session.flush();
    vi.mocked(f.backend.apply).mockRejectedValueOnce(new Error('Disk full'));
    first.session.change(value => hyperEditText(value, 'p', [{ insert: 'Alice private unsaved draft' }])); await expect(first.session.flush()).rejects.toThrow('Disk full'); first.release();
    await vi.waitFor(() => expect(first.session.store.getState().status).toBe('error'));
    f.setOwner(change === 'actor' ? { actorId: 'bob' } : change === 'workspace' ? { workspaceId: 'workspace-b' } : { contextKey: 'different-server' });
    const other = f.scope(), second = await f.pool.acquire('same-document-id', other); await second.session.flush();
    expect(second.session).not.toBe(first.session); expect(text(second.session)).not.toContain('private unsaved'); expect(text(first.session)).toBe('Alice private unsaved draft');
    expect(first.session.belongsTo(other)).toBe(false); expect(second.session.belongsTo(other)).toBe(true);
    await expect(f.pool.flush('same-document-id', alice)).rejects.toThrow('workspace or account changed'); await f.pool.flush('same-document-id');
    const writes = vi.mocked(f.backend.apply).mock.calls.length;
    f.setOwner({ workspaceId: 'workspace-a', actorId: 'alice', contextKey: '' }); second.release();
    const restored = await f.pool.acquire('same-document-id', f.scope()); expect(restored.session).toBe(first.session); expect(restored.session.belongsTo(f.scope())).toBe(true); expect(text(restored.session)).toBe('Alice private unsaved draft');
    await expect(restored.session.flush()).rejects.toThrow('workspace or account changed'); await expect(f.pool.flush('same-document-id')).rejects.toThrow('workspace or account changed'); expect(f.backend.apply).toHaveBeenCalledTimes(writes);
    expect(await restored.session.dispose()).toBe(false); restored.release();
    await expect(f.pool.acquire('same-document-id')).rejects.toThrow('ownership is required');
  });
  it('shares the same scoped session across main and side panes and closes only after the final release', async () => {
    const f = fixture(), first = await f.pool.acquire('shared', f.scope()), second = await f.pool.acquire('shared', f.scope()); await first.session.flush();
    expect(first.session).toBe(second.session); expect(f.backend.open).toHaveBeenCalledOnce(); first.release(); await Promise.resolve(); expect(f.backend.close).not.toHaveBeenCalled();
    second.session.change(value => hyperEditText(value, 'p', [{ insert: 'Saved from side pane' }])); await second.session.flush(); expect(f.backend.apply).toHaveBeenCalledOnce();
    second.release(); second.release(); await vi.waitFor(() => expect(f.backend.close).toHaveBeenCalledOnce());
    const next = await f.pool.acquire('shared', f.scope()); await next.session.flush(); expect(next.session).not.toBe(first.session); next.release();
  });
  it('cancels final-release cleanup when the same owner immediately reacquires the document', async () => {
    const f = fixture(), first = await f.pool.acquire('shared', f.scope()); await first.session.flush(); first.release();
    const second = await f.pool.acquire('shared', f.scope()); await second.session.flush(); expect(second.session).toBe(first.session); expect(f.backend.close).not.toHaveBeenCalled(); second.release();
  });
  it('rejects queued writes, refresh and history after an owner switch and keeps the latest optimistic draft', async () => {
    const f = fixture(), gate = deferred<void>(), first = await f.pool.acquire('same', f.scope()); await first.session.flush();
    vi.mocked(f.backend.apply).mockImplementationOnce(async () => { f.calls.push('apply:alice'); await gate.promise; });
    first.session.change(value => hyperEditText(value, 'p', [{ insert: 'First draft' }])); first.session.change(value => hyperEditText(value, 'p', [{ insert: 'Latest private draft' }]));
    await vi.waitFor(() => expect(f.backend.apply).toHaveBeenCalledOnce()); const history = first.session.history(false);
    f.setOwner({ actorId: 'bob' }); const second = await f.pool.acquire('same', f.scope());
    await first.session.refresh(); f.listeners[0](); await expect(first.session.flush()).rejects.toThrow('workspace or account changed');
    expect(f.backend.open).toHaveBeenCalledOnce(); expect(f.stops[0]).toHaveBeenCalledOnce(); expect(first.session.change(value => hyperEditText(value, 'p', [{ insert: 'Must not apply' }]))).toBeNull();
    gate.resolve(); await second.session.flush(); await history;
    expect(f.backend.apply).toHaveBeenCalledOnce(); expect(f.backend.history).not.toHaveBeenCalled(); expect(f.backend.read).not.toHaveBeenCalled(); expect(text(first.session)).toBe('Latest private draft'); expect(text(second.session)).toBe('bob saved');
    expect(await first.session.dispose()).toBe(false); expect(f.backend.close).not.toHaveBeenCalled(); first.release(); second.release();
  });
  it('quarantines a late opening result and never closes the next owner’s same-id document', async () => {
    const f = fixture(), gate = deferred<ReturnType<typeof doc>>(); vi.mocked(f.backend.open).mockImplementationOnce(async () => { f.calls.push('open:alice'); return gate.promise; });
    const first = await f.pool.acquire('same', f.scope()); await vi.waitFor(() => expect(f.backend.open).toHaveBeenCalledOnce());
    f.setOwner({ actorId: 'bob' }); const second = await f.pool.acquire('same', f.scope()); gate.resolve(doc('Late Alice response')); await second.session.flush();
    expect(first.session.store.getState().document).toBeNull(); expect(text(second.session)).toBe('bob saved'); first.release(); await Promise.resolve(); await Promise.resolve(); expect(f.backend.close).not.toHaveBeenCalled(); second.release();
  });
  it('ignores an old refresh result instead of injecting another account’s snapshot', async () => {
    const f = fixture(), first = await f.pool.acquire('same', f.scope()); await first.session.flush(); const gate = deferred<ReturnType<typeof doc>>();
    vi.mocked(f.backend.read).mockImplementationOnce(() => gate.promise); const refreshing = first.session.refresh(); await vi.waitFor(() => expect(f.backend.read).toHaveBeenCalledOnce());
    f.setOwner({ actorId: 'bob' }); const second = await f.pool.acquire('same', f.scope()); gate.resolve(doc('Late Alice refresh')); await second.session.flush(); await refreshing;
    expect(text(first.session)).toBe('alice saved'); expect(text(second.session)).toBe('bob saved'); expect(first.session.belongsTo(f.scope())).toBe(false); first.release(); second.release();
  });
  it('waits for an already dispatched close before opening the same id in a new context', async () => {
    const f = fixture(), first = await f.pool.acquire('same', f.scope()); await first.session.flush(); const gate = deferred<void>();
    vi.mocked(f.backend.close).mockImplementationOnce(async () => { f.calls.push('close:alice'); await gate.promise; }); first.release(); await vi.waitFor(() => expect(f.backend.close).toHaveBeenCalledOnce());
    f.setOwner({ actorId: 'bob' }); const second = await f.pool.acquire('same', f.scope()); expect(f.backend.open).toHaveBeenCalledOnce(); gate.resolve(); await second.session.flush();
    expect(f.calls).toEqual(['open:alice', 'close:alice', 'open:bob']); expect(text(second.session)).toBe('bob saved'); second.release();
  });
  it('does not register listeners or dispatch operations when the supplied owner is already inactive', async () => {
    const f = fixture(), alice = f.scope(); f.setOwner({ actorId: 'bob' });
    await expect(f.pool.acquire('same', alice)).rejects.toThrow('workspace or account changed');
    const direct = new HyperDocumentSession('direct', f.backend, alice); await expect(direct.flush()).rejects.toThrow('workspace or account changed'); await direct.dispose();
    expect(f.backend.open).not.toHaveBeenCalled(); expect(f.backend.listen).not.toHaveBeenCalled(); expect(f.backend.close).not.toHaveBeenCalled();
  });
  it('does not let an inactive acquisition invalidate another currently active session', async () => {
    const f = fixture(), current = await f.pool.acquire('same', f.scope()); await current.session.flush();
    const inactive: HyperDocumentScope = { workspaceId: 'other', actorId: 'other', isCurrent: () => false };
    const rejected = new HyperDocumentSession('same', f.backend, inactive); await expect(rejected.flush()).rejects.toThrow('workspace or account changed');
    current.session.change(value => hyperEditText(value, 'p', [{ insert: 'Still editable' }])); await current.session.flush(); expect(text(current.session)).toBe('Still editable'); expect(current.session.store.getState().status).toBe('ready'); await rejected.dispose(); current.release();
  });
  it('captures ownership metadata rather than following a mutable descriptor into another account', async () => {
    const f = fixture(), owner = f.scope(), original = f.scope(), first = await f.pool.acquire('same', owner); await first.session.flush();
    owner.actorId = 'bob'; owner.workspaceId = 'workspace-b'; expect(first.session.belongsTo(original)).toBe(true); expect(first.session.belongsTo(owner)).toBe(false);
    f.setOwner({ actorId: 'bob', workspaceId: 'workspace-b' }); expect(first.session.change(value => hyperEditText(value, 'p', [{ insert: 'Forbidden' }]))).toBeNull(); expect(f.backend.apply).not.toHaveBeenCalled(); first.release();
  });
  it('rejects a scope change while flush awaits a pending write', async () => {
    const f = fixture(), first = await f.pool.acquire('same', f.scope()); await first.session.flush(); const gate = deferred<void>(); vi.mocked(f.backend.apply).mockImplementationOnce(() => gate.promise);
    first.session.change(value => hyperEditText(value, 'p', [{ insert: 'Pending private draft' }])); const flushing = f.pool.flush('same', f.scope()); await vi.waitFor(() => expect(f.backend.apply).toHaveBeenCalledOnce());
    f.setOwner({ actorId: 'bob' }); gate.resolve(); await expect(flushing).rejects.toThrow('workspace or account changed'); expect(text(first.session)).toBe('Pending private draft'); first.release();
  });
  it('keeps a direct custom-backend session compatible when no ownership scope is supplied', async () => {
    const f = fixture(), direct = new HyperDocumentSession('direct', f.backend); await direct.flush();
    const original = clone(DocumentDataPBSchema, direct.store.getState().document!); f.setOwner({ actorId: 'bob' }); direct.change(value => hyperEditText(value, 'p', [{ insert: 'Explicit isolated test backend' }])); await direct.flush();
    expect(hyperPlainText(hyperBlockText(original, original.blocks.p))).toBe('alice saved'); expect(text(direct)).toBe('Explicit isolated test backend'); await direct.dispose();
  });
});
