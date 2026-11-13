import { describe, expect, it } from 'vitest';
import { HyperRowActivityIpc, hyperRowActivityMaxRendererRevision, hyperRowActivityTrustedSender, type HyperRowActivityRequest, type HyperRowActivityAck, type HyperRowActivityReply } from './HyperRowActivityIpc';

const tick = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
const ack = (request: HyperRowActivityRequest): HyperRowActivityAck => ({ contextId: request.contextId, activityId: request.activityId, revision: request.revision });
const request = (change: Partial<HyperRowActivityRequest> = {}): HyperRowActivityRequest => ({ viewId: 'view', contextId: 'context', activityId: 'pane', revision: 1n, rowIds: ['row'], closeActivity: false, ...change });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options: { available?: boolean; failCleanup?: boolean; limits?: { total: number; sender: number } } = {}) {
  let available = options.available !== false, starts = 0;
  const cleanup: HyperRowActivityRequest[] = [], dispatched: HyperRowActivityRequest[] = [];
  const tracker = new HyperRowActivityIpc({ limits: options.limits, existingCore: () => !available ? null : async value => { cleanup.push(value); if (options.failCleanup) throw Error('Core unavailable'); return ack(value); } });
  const renderer = tracker.attach(1); renderer.ready();
  const forward = (value = request()) => tracker.forward(renderer.capture(), value, async () => { starts++; }, async sent => { dispatched.push(sent); return { value: 'reply', ack: ack(sent) }; });
  return { tracker, renderer, cleanup, dispatched, forward, starts: () => starts, available: (value: boolean) => { available = value; } };
}

describe('Hyper row activity main lifecycle tracker', () => {
  it('accepts only the current trusted main-frame sender, including same-document hashes', () => {
    const frame = { frameTreeNodeId: 4, url: 'file:///owned/index.html#pane', parent: null, isDestroyed: () => false };
    const sender = { id: 1, isDestroyed: () => false }, owner = { webContentsId: 1, mainFrame: frame, rendererURL: 'file:///owned/index.html', isDestroyed: () => false };
    expect(hyperRowActivityTrustedSender(sender, frame, owner)).toBe(true);
    expect(hyperRowActivityTrustedSender({ ...sender, id: 2 }, frame, owner)).toBe(false);
    expect(hyperRowActivityTrustedSender(sender, { ...frame, parent: frame }, owner)).toBe(false);
    expect(hyperRowActivityTrustedSender(sender, { ...frame, frameTreeNodeId: 9 }, owner)).toBe(false);
    expect(hyperRowActivityTrustedSender(sender, { ...frame, url: 'https://foreign.invalid/' }, owner)).toBe(false);
    expect(hyperRowActivityTrustedSender(sender, null, owner)).toBe(false);
    expect(hyperRowActivityTrustedSender(sender, frame, { ...owner, isDestroyed: () => true })).toBe(false);
    expect(hyperRowActivityTrustedSender(sender, { ...frame, isDestroyed: () => true }, owner)).toBe(false);
  });
  it('tracks before awaiting startup and blocks a retired document before dispatch', async () => {
    const f = fixture(), started = deferred<void>();
    const forwarding = f.tracker.forward(f.renderer.capture(), request(), () => started.promise, async sent => { f.dispatched.push(sent); return { value: 'late', ack: ack(sent) }; });
    expect(f.tracker.trackedCount).toBe(1); f.renderer.navigate({ isMainFrame: true, isSameDocument: false }); await tick();
    expect(f.cleanup).toHaveLength(1); expect(f.cleanup[0]).toMatchObject({ rowIds: [], closeActivity: true, revision: 2n, contextId: 'context', activityId: 'pane' });
    const result = forwarding.catch(error => error); started.resolve(); expect((await result).code).toBe('retired'); expect(f.dispatched).toHaveLength(0);
  });
  it('keeps a failed activation because native may have retained desired pins', async () => {
    const f = fixture();
    await expect(f.tracker.forward(f.renderer.capture(), request(), async () => {}, async () => { throw Error('Initialization failed after pins accepted'); })).rejects.toThrow('Initialization failed');
    expect(f.tracker.trackedCount).toBe(1); f.renderer.gone(); await tick(); expect(f.cleanup[0].rowIds).toEqual([]); expect(f.tracker.trackedCount).toBe(0);
  });
  it('keeps non-success native replies until a matching empty acknowledgement', async () => {
    const f = fixture(); await f.tracker.forward(f.renderer.capture(), request(), async () => {}, async () => ({ value: { status: 1 } }));
    expect(f.tracker.trackedCount).toBe(1); await f.forward(request({ revision: 2n, rowIds: [], closeActivity: true })); expect(f.tracker.trackedCount).toBe(0);
  });
  it('releases the highest pending or failed revision, not an earlier acknowledgement', async () => {
    const f = fixture(), pending = deferred<HyperRowActivityReply<string>>();
    await f.forward(); const high = f.tracker.forward(f.renderer.capture(), request({ revision: 9n }), async () => {}, () => pending.promise);
    await tick(); f.renderer.destroy(); await tick(); expect(f.cleanup[0].revision).toBe(10n);
    pending.resolve({ value: 'late', ack: ack(request({ revision: 9n })) }); await high; expect(f.tracker.trackedCount).toBe(0); expect(f.cleanup).toHaveLength(1);
  });
  it('cannot forget a newer activation when an older empty acknowledgement arrives', async () => {
    const f = fixture(), release = deferred<HyperRowActivityReply<string>>(); await f.forward();
    const pending = f.tracker.forward(f.renderer.capture(), request({ revision: 2n, rowIds: [] }), async () => {}, () => release.promise);
    await tick(); await f.forward(request({ revision: 3n, rowIds: ['new-row'] })); release.resolve({ value: 'old-release', ack: ack(request({ revision: 2n })) }); await pending;
    expect(f.tracker.trackedCount).toBe(1); f.renderer.gone(); await tick(); expect(f.cleanup[0].revision).toBe(4n);
  });
  it('preserves another sender and refuses cross-sender activity identity reuse', async () => {
    const f = fixture(), other = f.tracker.attach(2); other.ready(); await f.forward();
    await expect(f.tracker.forward(other.capture(), request(), async () => {}, async sent => ({ value: 'bad', ack: ack(sent) }))).rejects.toMatchObject({ code: 'binding' });
    await f.tracker.forward(other.capture(), request({ activityId: 'other-pane' }), async () => {}, async sent => ({ value: 'other', ack: ack(sent) }));
    f.renderer.gone(); await tick(); expect(f.tracker.trackedCount).toBe(1); expect(f.cleanup.map(value => value.activityId)).toEqual(['pane']);
    other.destroy(); await tick(); expect(f.tracker.trackedCount).toBe(0);
  });
  it('ignores same-document and child-frame navigation but rejects new activity until a new document is ready', async () => {
    const f = fixture(); await f.forward(); f.renderer.navigate({ isMainFrame: false, isSameDocument: false }); f.renderer.navigate({ isMainFrame: true, isSameDocument: true }); await tick();
    expect(f.cleanup).toHaveLength(0); await f.forward(request({ revision: 2n }));
    const old = f.renderer.capture(); f.renderer.navigate({ isMainFrame: true, isSameDocument: false }); await tick();
    await expect(f.tracker.forward(old, request({ activityId: 'old-document' }), async () => {}, async sent => ({ value: '', ack: ack(sent) }))).rejects.toMatchObject({ code: 'retired' });
    await expect(f.forward(request({ activityId: 'before-ready' }))).rejects.toMatchObject({ code: 'retired' });
    f.renderer.ready(); await f.forward(request({ activityId: 'new-document' })); expect(f.tracker.trackedCount).toBe(1);
  });
  it('never starts the core for cleanup and retains records when no existing core is available', async () => {
    const f = fixture({ available: false }); await f.forward(); const starts = f.starts(); f.renderer.destroy(); await tick();
    expect(f.cleanup).toHaveLength(0); expect(f.starts()).toBe(starts); expect(f.tracker.trackedCount).toBe(1);
    f.tracker.coreExited(); expect(f.tracker.trackedCount).toBe(0);
  });
  it('never starts a core for renderer-initiated terminal forwarding either', async () => {
    const f = fixture(); await f.forward(); const before = f.starts();
    await f.forward(request({ revision: 2n, rowIds: [], closeActivity: true })); expect(f.starts()).toBe(before); expect(f.tracker.trackedCount).toBe(0);
  });
  it('acknowledges late terminal disposal after a proven core exit without process startup', () => {
    const f = fixture({ available: false }), terminal = request({ revision: 2n, rowIds: [], closeActivity: true });
    expect(f.tracker.terminalAckWithoutCore(f.renderer.capture(), terminal)).toBeUndefined();
    f.tracker.coreExited(); expect(f.tracker.terminalAckWithoutCore(f.renderer.capture(), terminal)).toEqual(ack(terminal));
    expect(f.starts()).toBe(0); expect(f.cleanup).toHaveLength(0);
    expect(f.tracker.terminalAckWithoutCore(f.renderer.capture(), request())).toBeUndefined();
  });
  it('retains failed cleanup without a timer or polling loop', async () => {
    const f = fixture({ failCleanup: true }); await f.forward(); f.renderer.gone(); await tick(); await tick();
    expect(f.cleanup).toHaveLength(1); expect(f.tracker.trackedCount).toBe(1);
    f.tracker.coreReplaced(); expect(f.tracker.trackedCount).toBe(0);
  });
  it('retries a failed release at the next concrete destruction event without polling', async () => {
    let fail = true;
    const cleanup: HyperRowActivityRequest[] = [], tracker = new HyperRowActivityIpc({ existingCore: () => async value => { cleanup.push(value); if (fail) throw Error('Transient core failure'); return ack(value); } });
    const renderer = tracker.attach(1); renderer.ready(); await tracker.forward(renderer.capture(), request(), async () => {}, async sent => ({ value: '', ack: ack(sent) }));
    renderer.gone(); await tick(); expect(cleanup).toHaveLength(1); expect(tracker.trackedCount).toBe(1);
    fail = false; renderer.destroy(); await tick(); expect(cleanup).toHaveLength(2); expect(cleanup[1].revision).toBe(cleanup[0].revision); expect(tracker.trackedCount).toBe(0);
  });
  it('keeps live empty panes tracked until explicit terminal disposal', async () => {
    const f = fixture(); await f.forward(request({ rowIds: [] })); expect(f.tracker.trackedCount).toBe(1);
    f.renderer.gone(); await tick(); expect(f.cleanup[0]).toMatchObject({ rowIds: [], closeActivity: true }); expect(f.tracker.trackedCount).toBe(0);
  });
  it('keeps failed terminal cleanup retired and retries when an older native activation settles', async () => {
    let fail = true;
    const cleanup: HyperRowActivityRequest[] = [], tracker = new HyperRowActivityIpc({ existingCore: () => async value => { cleanup.push(value); if (fail) throw Error('Unknown terminal at capacity'); return ack(value); } });
    const renderer = tracker.attach(1); renderer.ready(); const pending = deferred<HyperRowActivityReply<string>>();
    const activation = tracker.forward(renderer.capture(), request(), async () => {}, () => pending.promise); await tick();
    await tracker.forward(renderer.capture(), request({ rowIds: [], revision: 2n, closeActivity: true }), async () => {}, async () => ({ value: 'close not accepted' })); await tick();
    expect(tracker.trackedCount).toBe(1); expect(cleanup).toHaveLength(1); expect(cleanup[0]).toMatchObject({ closeActivity: true, revision: 3n });
    await expect(tracker.forward(renderer.capture(), request({ revision: 4n }), async () => {}, async sent => ({ value: '', ack: ack(sent) }))).rejects.toMatchObject({ code: 'retired' });
    fail = false; pending.resolve({ value: 'old native activation accepted', ack: ack(request()) }); await activation; await tick();
    expect(cleanup).toHaveLength(2); expect(cleanup[1].revision).toBe(3n); expect(tracker.trackedCount).toBe(0);
  });
  it('does not let an unavailable core lookup throw during renderer destruction', async () => {
    const tracker = new HyperRowActivityIpc({ existingCore: () => { throw Error('Shutdown in progress'); } }), renderer = tracker.attach(1); renderer.ready();
    await tracker.forward(renderer.capture(), request(), async () => {}, async sent => ({ value: '', ack: ack(sent) }));
    expect(() => renderer.destroy()).not.toThrow(); expect(tracker.trackedCount).toBe(1); tracker.coreExited(); expect(tracker.trackedCount).toBe(0);
  });
  it('forgets records only for exact empty acknowledgements', async () => {
    for (const wrong of [{ contextId: 'other' }, { activityId: 'other' }, { revision: 99n }]) {
      const f = fixture({ available: false }); await f.forward(); await f.tracker.forward(f.renderer.capture(), request({ rowIds: [], closeActivity: true, revision: 2n }), async () => {}, async sent => ({ value: '', ack: { ...ack(sent), ...wrong } })); expect(f.tracker.trackedCount).toBe(1);
    }
  });
  it('does not dispatch an old startup waiter or cleanup into a replaced SDK', async () => {
    const f = fixture(), start = deferred<void>();
    const pending = f.tracker.forward(f.renderer.capture(), request(), () => start.promise, async sent => { f.dispatched.push(sent); return { value: '', ack: ack(sent) }; });
    f.renderer.gone(); f.tracker.coreReplaced(); await tick(); expect(f.cleanup).toHaveLength(0);
    const result = pending.catch(error => error); start.resolve(); expect((await result).code).toBe('retired'); expect(f.dispatched).toHaveLength(0);
  });
  it('does not let destruction of a reused sender ID release its replacement document', async () => {
    const f = fixture(); await f.forward(); const fresh = f.tracker.attach(1); fresh.ready(); await tick();
    await f.tracker.forward(fresh.capture(), request({ contextId: 'new-context', activityId: 'new-pane' }), async () => {}, async sent => ({ value: '', ack: ack(sent) }));
    f.renderer.destroy(); await tick(); expect(f.tracker.trackedCount).toBe(1); expect(f.cleanup.map(value => value.activityId)).toEqual(['pane']);
  });
  it('bounds both total and per-sender pending records before dispatch', async () => {
    const f = fixture({ limits: { total: 2, sender: 1 } }); await f.forward(); await expect(f.forward(request({ activityId: 'too-many' }))).rejects.toMatchObject({ code: 'limit' });
    const other = f.tracker.attach(2); other.ready(); await f.tracker.forward(other.capture(), request({ activityId: 'other' }), async () => {}, async sent => ({ value: '', ack: ack(sent) }));
    const third = f.tracker.attach(3); third.ready(); await expect(f.tracker.forward(third.capture(), request({ activityId: 'third' }), async () => {}, async sent => ({ value: '', ack: ack(sent) }))).rejects.toMatchObject({ code: 'limit' }); expect(f.tracker.trackedCount).toBe(2);
  });
  it('reserves uint64 headroom for one higher cleanup revision', async () => {
    const f = fixture(); await f.forward(request({ revision: hyperRowActivityMaxRendererRevision })); f.renderer.gone(); await tick(); expect(f.cleanup[0].revision).toBe((1n << 64n) - 1n);
    const invalid = fixture(); await expect(invalid.forward(request({ revision: hyperRowActivityMaxRendererRevision + 1n }))).rejects.toMatchObject({ code: 'revision' }); expect(invalid.starts()).toBe(0); expect(invalid.tracker.trackedCount).toBe(0);
  });
});
