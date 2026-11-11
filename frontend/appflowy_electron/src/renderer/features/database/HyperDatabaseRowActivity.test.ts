import { describe, expect, it } from 'vitest';
import { HyperDatabaseRowActivity, type HyperDatabaseRowActivityAck, type HyperDatabaseRowActivityRequest } from './HyperDatabaseRowActivity';

const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const ack = (request: HyperDatabaseRowActivityRequest): HyperDatabaseRowActivityAck => ({ contextId: request.contextId, activityId: request.activityId, revision: request.revision });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options: { pending?: boolean; activityId?: string; contextId?: string } = {}) {
  let current = true, activations = 0;
  const calls: HyperDatabaseRowActivityRequest[] = [], pending: ReturnType<typeof deferred<HyperDatabaseRowActivityAck>>[] = [];
  const activity = new HyperDatabaseRowActivity({ owner: { isCurrent: () => current }, viewId: 'view', contextId: options.contextId ?? 'context', activityId: options.activityId ?? 'pane', activated: () => { activations++; }, backend: {
    updateRowActivity: request => { calls.push(request); if (!options.pending) return Promise.resolve(ack(request)); const next = deferred<HyperDatabaseRowActivityAck>(); pending.push(next); return next.promise; },
  } });
  return { activity, calls, pending, activations: () => activations, expire: () => { current = false; } };
}

describe('Hyper database visible row activity', () => {
  it('registers a live empty pane and uses an explicit terminal disposal marker', async () => {
    const f = fixture(); f.activity.start(); await tick();
    expect(f.calls[0]).toMatchObject({ rowIds: [], closeActivity: false, revision: 1n });
    await f.activity.dispose(); expect(f.calls[1]).toMatchObject({ rowIds: [], closeActivity: true, revision: 2n });
  });
  it('coalesces start with already contributed row windows', async () => {
    const f = fixture(); f.activity.rows(Symbol(), ['row']); f.activity.start(); await tick(); expect(f.calls).toHaveLength(1); expect(f.calls[0].rowIds).toEqual(['row']);
  });
  it('activates over fifty rows with one batch independently of write permissions', async () => {
    const f = fixture(); f.activity.rows(Symbol(), Array.from({ length: 200 }, (_, index) => `row-${index}`)); await tick();
    expect(f.calls).toHaveLength(1); expect(f.calls[0].rowIds).toHaveLength(200); expect(f.activity.getSnapshot().status).toBe('active'); expect(f.activations()).toBe(1);
  });
  it('coalesces grid properties/details and calendar span positions into unique rows', async () => {
    const f = fixture(), source = Symbol(), detail = Symbol();
    f.activity.rows(source, Array.from({ length: 50 }, (_, index) => `row-${index}`)); f.activity.rows(detail, ['row-7']);
    const shared = Array.from({ length: 10 }, (_, index) => `event-${index}`);
    for (let day = 0; day < 42; day++) f.activity.rows(Symbol(), shared);
    f.activity.rows(Symbol(), Array.from({ length: 25 }, (_, index) => `undated-${index}`)); await tick();
    expect(f.calls).toHaveLength(1); expect(f.calls[0].rowIds).toHaveLength(85); expect(f.calls[0].revision).toBe(3n);
  });
  it('supports the maximum calendar window plus its open row without truncation', async () => {
    const f = fixture();
    for (let day = 0; day < 42; day++) f.activity.rows(Symbol(), Array.from({ length: 10 }, (_, index) => `day-${day}-${index}`));
    f.activity.rows(Symbol(), Array.from({ length: 25 }, (_, index) => `undated-${index}`)); f.activity.rows(Symbol(), ['detail']); await tick();
    expect(f.calls).toHaveLength(1); expect(f.calls[0].rowIds).toHaveLength(446);
  });
  it('does not reactivate unchanged sets or multiply calls per property', async () => {
    const f = fixture(), source = Symbol(); f.activity.rows(source, ['a', 'b']); await tick();
    for (let field = 0; field < 20; field++) f.activity.rows(source, ['b', 'a', 'a']); await tick();
    expect(f.calls).toHaveLength(1); expect(f.activations()).toBe(1);
  });
  it('keeps the latest page while an earlier activation awaits and ignores its activation callback', async () => {
    const f = fixture({ pending: true }), source = Symbol(); f.activity.rows(source, ['old']); await tick();
    f.activity.rows(source, ['intermediate']); f.activity.rows(source, ['latest']); await tick(); expect(f.calls).toHaveLength(1);
    f.pending[0].resolve(ack(f.calls[0])); await tick(); expect(f.calls).toHaveLength(2); expect(f.calls[1].rowIds).toEqual(['latest']); expect(f.activations()).toBe(0);
    f.pending[1].resolve(ack(f.calls[1])); await tick(); expect(f.activations()).toBe(1); expect(f.activity.getSnapshot().confirmedRevision).toBe(3n);
  });
  it('dispatches an explicit newer retry even if the older pending request fails', async () => {
    const f = fixture({ pending: true }); f.activity.rows(Symbol(), ['row']); await tick();
    f.activity.retry(); f.pending[0].reject(Error('Older activation failed')); await tick();
    expect(f.calls).toHaveLength(2); expect(f.calls[1].revision).toBe(2n); expect(f.activity.getSnapshot().status).toBe('connecting');
    f.pending[1].resolve(ack(f.calls[1])); await tick(); expect(f.activity.getSnapshot().status).toBe('active');
  });
  it('releases one window while retaining a duplicate row used by another window', async () => {
    const f = fixture(), board = Symbol(), detail = Symbol(); f.activity.rows(board, ['shared', 'other']); f.activity.rows(detail, ['shared']); await tick();
    f.activity.rows(board, []); await tick(); expect(f.calls[1].rowIds).toEqual(['shared']);
    f.activity.rows(detail, []); await tick(); expect(f.calls[2].rowIds).toEqual([]); expect(f.activity.getSnapshot().status).toBe('idle');
  });
  it('gives linked panes independent activity identities and releases only the closing pane', async () => {
    const a = fixture({ activityId: 'a' }), b = fixture({ activityId: 'b' }); a.activity.rows(Symbol(), ['shared']); b.activity.rows(Symbol(), ['shared']); await tick();
    await a.activity.dispose(); expect(a.calls.at(-1)?.rowIds).toEqual([]); expect(a.calls.at(-1)?.activityId).toBe('a'); expect(b.calls).toHaveLength(1); expect(b.activity.getSnapshot().status).toBe('active');
  });
  it('sends a higher-revision release before a slow activation finishes and never resurrects it', async () => {
    const f = fixture({ pending: true }); f.activity.rows(Symbol(), ['row']); await tick(); const disposal = f.activity.dispose();
    expect(f.calls).toHaveLength(2); expect(f.calls[1].rowIds).toEqual([]); expect(f.calls[1].closeActivity).toBe(true); expect(f.calls[1].revision).toBeGreaterThan(f.calls[0].revision);
    f.pending[1].resolve(ack(f.calls[1])); await disposal; f.pending[0].resolve(ack(f.calls[0])); await tick();
    expect(f.activations()).toBe(0); expect(f.activity.getSnapshot().status).toBe('closed'); expect(f.calls).toHaveLength(2);
  });
  it('does not send a deferred first activation after closing', async () => {
    const f = fixture(); f.activity.rows(Symbol(), ['row']); await f.activity.dispose(); await tick(); expect(f.calls).toHaveLength(0);
  });
  it('drops stale owner replies but disposes only its captured old context and activity', async () => {
    const f = fixture({ pending: true }); f.activity.rows(Symbol(), ['row']); await tick(); f.expire();
    f.pending[0].resolve(ack(f.calls[0])); await tick(); f.activity.retry(); const closing = f.activity.dispose();
    expect(f.calls).toHaveLength(2); expect(f.calls[1]).toMatchObject({ contextId: 'context', activityId: 'pane', rowIds: [], closeActivity: true });
    f.pending[1].resolve(ack(f.calls[1])); await closing;
    expect(f.activations()).toBe(0); expect(f.activity.getSnapshot().confirmedRevision).toBeNull();
  });
  it('keeps reopened view contexts separate from a closing old context', async () => {
    const old = fixture({ contextId: 'old', activityId: 'old-pane', pending: true }), fresh = fixture({ contextId: 'new', activityId: 'new-pane' });
    old.activity.rows(Symbol(), ['same-row']); await tick(); fresh.activity.rows(Symbol(), ['same-row']); await tick();
    const closing = old.activity.dispose(); old.pending[1].resolve(ack(old.calls[1])); await closing; old.pending[0].resolve(ack(old.calls[0])); await tick();
    expect(old.calls[1].contextId).toBe('old'); expect(fresh.calls[0].contextId).toBe('new'); expect(fresh.activity.getSnapshot().status).toBe('active');
  });
  it('keeps accepted desired rows on failure and sends no automatic retry', async () => {
    const f = fixture({ pending: true }), source = Symbol(); f.activity.rows(source, ['row']); await tick(); f.pending[0].reject(Error('Offline')); await tick();
    expect(f.activity.getSnapshot()).toMatchObject({ status: 'error', desiredCount: 1, error: 'Offline' }); expect(f.calls).toHaveLength(1);
    f.activity.rows(source, ['new-page']); await tick(); expect(f.calls).toHaveLength(1);
    f.activity.retry(); await tick(); expect(f.calls[1].rowIds).toEqual(['new-page']); expect(f.calls[1].revision).toBe(3n);
    f.pending[1].resolve(ack(f.calls[1])); await tick(); expect(f.activity.getSnapshot().status).toBe('active');
  });
  it('can release accepted pins after failure and does not poll a failed release', async () => {
    const f = fixture({ pending: true }), source = Symbol(); f.activity.rows(source, ['row']); await tick(); f.pending[0].reject(Error('Partial initialization failed')); await tick();
    f.activity.rows(source, []); await tick(); expect(f.calls[1].rowIds).toEqual([]); f.pending[1].reject(Error('Offline release')); await tick(); expect(f.calls).toHaveLength(2);
  });
  it('rejects acknowledgements for another pane, context, or revision', async () => {
    for (const wrong of [{ contextId: 'other' }, { activityId: 'other' }, { revision: 9n }]) {
      const f = fixture({ pending: true }); f.activity.rows(Symbol(), ['row']); await tick(); f.pending[0].resolve({ ...ack(f.calls[0]), ...wrong }); await tick();
      expect(f.activity.getSnapshot().status).toBe('error'); expect(f.activations()).toBe(0); expect(f.calls).toHaveLength(1);
    }
  });
  it('checks the unique row bound before replacing the last valid desired set', async () => {
    const f = fixture(), source = Symbol(); f.activity.rows(source, ['saved']); await tick();
    expect(() => f.activity.rows(source, Array.from({ length: 513 }, (_, index) => `row-${index}`))).toThrow('Too many');
    expect(f.activity.getSnapshot().desiredCount).toBe(1); expect(f.calls).toHaveLength(1);
  });
});
