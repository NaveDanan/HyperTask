import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { HyperDocumentSession, type HyperDocumentBackend, type HyperDocumentScope } from './HyperDocumentSession';
import { hyperBlockText, hyperEditText, hyperPlainText } from './HyperDocumentModel';

const document = (text = 'Saved') => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', childrenId: 'root-children', data: '{}' }, p: { id: 'p', ty: 'paragraph', parentId: 'root', data: JSON.stringify({ delta: [{ insert: text }] }) } }, meta: { childrenMap: { 'root-children': { children: ['p'] } } } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function setup(scope?: HyperDocumentScope) {
  const backend: HyperDocumentBackend = { open: vi.fn(async () => document()), read: vi.fn(async () => document()), apply: vi.fn(async () => { throw new Error('write failed'); }), close: vi.fn(async () => {}), history: vi.fn(async () => {}), listen: vi.fn(() => vi.fn()) };
  const session = new HyperDocumentSession('doc', backend, scope);
  const text = () => { const doc = session.store.getState().document!; return hyperPlainText(hyperBlockText(doc, doc.blocks.p)); };
  return { backend, session, text };
}
describe('Hyper explicit document recovery', () => {
  it('keeps the draft until a fresh open succeeds and never retries failed actions', async () => {
    const { backend, session, text } = setup(); await session.flush();
    session.change(doc => hyperEditText(doc, 'p', [{ insert: 'Failed draft' }]));
    session.change(doc => hyperEditText(doc, 'p', [{ insert: 'Latest failed draft' }]));
    await expect(session.flush()).rejects.toThrow('write failed');
    const gate = deferred<ReturnType<typeof document>>(); vi.mocked(backend.open).mockImplementationOnce(() => gate.promise);
    const recovering = session.reloadSaved();
    await vi.waitFor(() => expect(backend.open).toHaveBeenCalledTimes(2));
    expect(text()).toBe('Latest failed draft'); expect(session.store.getState().historyPending).toBe(true);
    expect(session.change(doc => hyperEditText(doc, 'p', [{ insert: 'Must not race reload' }]))).toBeNull();
    gate.resolve(document('Fresh saved version')); await recovering; await session.flush();
    expect(text()).toBe('Fresh saved version'); expect(backend.apply).toHaveBeenCalledTimes(1);
    expect(session.store.getState()).toMatchObject({ status: 'ready', error: null, historyPending: false });
    await session.dispose();
  });
  it('keeps the draft recoverable when opening the saved page also fails', async () => {
    const { backend, session, text } = setup(); await session.flush();
    session.change(doc => hyperEditText(doc, 'p', [{ insert: 'Keep this draft' }])); await expect(session.flush()).rejects.toThrow('write failed');
    vi.mocked(backend.open).mockRejectedValueOnce(new Error('server unavailable'));
    await expect(session.reloadSaved()).rejects.toThrow('server unavailable');
    expect(text()).toBe('Keep this draft'); expect(await session.dispose()).toBe(false);
    await session.reloadSaved(); expect(text()).toBe('Saved'); expect(backend.apply).toHaveBeenCalledTimes(1);
    await session.dispose();
  });
  it('requires the original owner and permits explicit recovery when that owner returns', async () => {
    let actor = 'a'; const scope = { workspaceId: 'workspace', actorId: 'a', isCurrent: () => actor === 'a' };
    const { backend, session, text } = setup(scope); await session.flush();
    session.change(doc => hyperEditText(doc, 'p', [{ insert: 'Actor A private draft' }])); await expect(session.flush()).rejects.toThrow('write failed');
    actor = 'b'; await expect(session.reloadSaved()).rejects.toThrow('workspace or account changed');
    expect(text()).toBe('Actor A private draft'); expect(backend.open).toHaveBeenCalledTimes(1);
    actor = 'a'; await session.reloadSaved(); expect(text()).toBe('Saved');
    expect(backend.apply).toHaveBeenCalledTimes(1); await session.dispose();
  });
  it('waits for another owner’s old read before reopening, and quarantines its reply', async () => {
    let actor = 'a'; const a = { workspaceId: 'workspace', actorId: 'a', isCurrent: () => actor === 'a' }, b = { workspaceId: 'workspace', actorId: 'b', isCurrent: () => actor === 'b' };
    const { backend, session, text } = setup(a); await session.flush();
    session.change(doc => hyperEditText(doc, 'p', [{ insert: 'A draft' }])); await expect(session.flush()).rejects.toThrow('write failed');
    actor = 'b'; const gate = deferred<ReturnType<typeof document>>(); vi.mocked(backend.open).mockImplementationOnce(() => gate.promise);
    const other = new HyperDocumentSession('doc', backend, b);
    await vi.waitFor(() => expect(backend.open).toHaveBeenCalledTimes(2));
    actor = 'a'; const recovering = session.reloadSaved(); await Promise.resolve();
    expect(backend.open).toHaveBeenCalledTimes(2);
    gate.resolve(document('B private data')); await recovering;
    expect(text()).toBe('Saved'); expect(other.store.getState().document).toBeNull();
    await other.dispose(); await session.dispose();
  });
});
