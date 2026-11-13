import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { HyperDocumentSession, type HyperDocumentBackend } from './HyperDocumentSession';
import { hyperBlockText, hyperEditText, hyperInsertBlock, hyperPlainText } from './HyperDocumentModel';

const document = () => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', childrenId: 'children', data: '{}' } }, meta: { childrenMap: { children: { children: [] } } } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
function setup() {
  const initial = hyperInsertBlock(document(), 'root', '', 'paragraph');
  const stop = vi.fn();
  let onUpdate = () => {};
  const service: HyperDocumentBackend = {
    open: vi.fn(async () => initial.document), read: vi.fn(async () => initial.document),
    apply: vi.fn(async () => {}), close: vi.fn(async () => {}), history: vi.fn(async () => {}),
    listen: vi.fn((_id, callback) => { onUpdate = callback; return stop; }),
  };
  return { initial: initial.document, id: initial.focus!.id, service, stop, notify: () => onUpdate() };
}
describe('Hyper document session', () => {
  it('serializes rapid edits and flush waits for all pending writes', async () => {
    const { service, id } = setup(), gate = deferred<void>();
    vi.mocked(service.apply).mockImplementationOnce(() => gate.promise);
    const session = new HyperDocumentSession('doc', service);
    await session.flush();
    session.change(doc => hyperEditText(doc, id, [{ insert: 'first' }]));
    session.change(doc => hyperEditText(doc, id, [{ insert: 'second' }]));
    await Promise.resolve();
    expect(service.apply).toHaveBeenCalledTimes(1);
    expect(session.store.getState().status).toBe('saving');
    gate.resolve(); await session.flush();
    expect(service.apply).toHaveBeenCalledTimes(2);
    expect(session.store.getState().status).toBe('ready');
    expect(hyperPlainText(hyperBlockText(session.store.getState().document!, session.store.getState().document!.blocks[id]))).toBe('second');
    await session.dispose();
  });
  it('retains unsaved content and stops queued writes when persistence fails', async () => {
    const { service, id } = setup();
    vi.mocked(service.apply).mockRejectedValueOnce(new Error('disk full'));
    const session = new HyperDocumentSession('doc', service); await session.flush();
    session.change(doc => hyperEditText(doc, id, [{ insert: 'must survive' }]));
    session.change(doc => hyperEditText(doc, id, [{ insert: 'latest unsaved text' }]));
    await expect(session.flush()).rejects.toThrow('disk full');
    expect(session.store.getState().error).toBe('disk full');
    expect(hyperPlainText(hyperBlockText(session.store.getState().document!, session.store.getState().document!.blocks[id]))).toBe('latest unsaved text');
    expect(service.apply).toHaveBeenCalledTimes(1);
    expect(await session.dispose()).toBe(false);
    expect(service.close).not.toHaveBeenCalled();
  });
  it('does not close the document until its writes finish', async () => {
    const { service, id, stop } = setup(), gate = deferred<void>();
    vi.mocked(service.apply).mockImplementationOnce(() => gate.promise);
    const session = new HyperDocumentSession('doc', service); await session.flush();
    session.change(doc => hyperEditText(doc, id, [{ insert: 'saved before closing' }]));
    const closing = session.dispose(); await Promise.resolve();
    expect(service.close).not.toHaveBeenCalled(); gate.resolve(); await closing;
    expect(service.close).toHaveBeenCalledWith('doc'); expect(stop).toHaveBeenCalledOnce();
  });
  it('defers remote refresh while local writes are pending', async () => {
    const { service, id, notify } = setup(), gate = deferred<void>();
    vi.mocked(service.apply).mockImplementationOnce(() => gate.promise);
    const session = new HyperDocumentSession('doc', service); await session.flush();
    session.change(doc => hyperEditText(doc, id, [{ insert: 'local' }]));
    notify(); await Promise.resolve();
    expect(service.read).not.toHaveBeenCalled(); gate.resolve(); await session.flush();
    await vi.waitFor(() => expect(service.read).toHaveBeenCalledOnce());
    await session.dispose();
  });
  it('does not replace a newer local edit with an older read response', async () => {
    const { service, id } = setup(), stale = deferred<ReturnType<typeof document>>();
    vi.mocked(service.read).mockImplementationOnce(() => stale.promise);
    const session = new HyperDocumentSession('doc', service); await session.flush();
    const refresh = session.refresh(); await Promise.resolve();
    session.change(doc => hyperEditText(doc, id, [{ insert: 'new edit' }]));
    await session.flush(); stale.resolve(document()); await refresh;
    expect(session.store.getState().document!.blocks[id]).toBeDefined();
    await session.dispose();
  });
  it('blocks mutations during undo and reloads the core result', async () => {
    const { service, id } = setup(), gate = deferred<void>();
    vi.mocked(service.history).mockImplementationOnce(() => gate.promise);
    const session = new HyperDocumentSession('doc', service); await session.flush();
    const undo = session.history(false); await Promise.resolve();
    expect(session.change(doc => hyperEditText(doc, id, [{ insert: 'must not race undo' }]))).toBeNull();
    gate.resolve(); await undo;
    expect(service.history).toHaveBeenCalledWith('doc', false); expect(service.read).toHaveBeenCalledOnce();
    expect(session.store.getState().historyPending).toBe(false);
    await session.dispose();
  });
  it('reports opening errors without inventing an empty document', async () => {
    const { service } = setup(); vi.mocked(service.open).mockRejectedValue(new Error('not found'));
    const session = new HyperDocumentSession('doc', service);
    await expect(session.flush()).rejects.toThrow('not found');
    expect(session.store.getState().document).toBeNull(); await session.dispose();
  });
});
