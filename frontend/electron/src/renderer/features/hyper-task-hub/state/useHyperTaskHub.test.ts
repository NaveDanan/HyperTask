import { expect, it, vi } from 'vitest';
import { HyperHubM1Fixture, HyperHubM5Fixture, HyperHubM2NoAvailabilityFixture, HyperHubNothingConnectedFixture } from '@shared/HyperTaskHub.fixtures';
import type { HyperHubFeedbackResult, HyperHubSnapshot } from '@shared/HyperTaskHub';
import { createHyperTaskHubFixtureClient } from './HyperTaskHubClient';
import { createHyperTaskHubStore } from './useHyperTaskHub';

it('passes visibility, setup options and day-scoped undo to the selected client', async () => {
  const client = createHyperTaskHubFixtureClient(HyperHubM2NoAvailabilityFixture);
  const visibility = vi.spyOn(client, 'setFocusVisible');
  const store = createHyperTaskHubStore(client);
  await store.getState().load();
  expect(await store.getState().getSetupOptions()).toMatchObject({ outlook: { available: false } });
  await store.getState().setFocusVisible(true);
  await store.getState().setFocusVisible(false);
  expect(visibility.mock.calls).toEqual([[true], [false]]);
  const day = store.getState().snapshot!.day!;
  const ack = await store.getState().sendFeedback({ type: 'declare-availability', day: day.date, windows: day.working });
  if (!ack.ok) throw Error(ack.code);
  expect(store.getState().snapshot!.plan?.blocks.length).toBeGreaterThan(0);
  expect(await store.getState().sendFeedback({ type: 'undo', ledgerEntryId: ack.ledgerEntryId, day: day.date })).toMatchObject({ ok: true });
  expect(store.getState().snapshot!.plan?.blocks).toEqual([]);
});

it('preserves the revision on an event created by a previously rendered card', async () => {
  const client = createHyperTaskHubFixtureClient(HyperHubM1Fixture);
  const send = vi.spyOn(client, 'sendFeedback');
  const store = createHyperTaskHubStore(client);
  await store.getState().load();
  const s = store.getState().snapshot!;
  const delayed = { type: 'pin' as const, targetId: s.tasks[0].id, expectedRevision: s.revision - 1, scopeGeneration: s.scopeGeneration };
  expect(await store.getState().sendFeedback(delayed)).toMatchObject({ ok: false, code: 'revision-conflict' });
  expect(send).not.toHaveBeenCalled();
});

it('rolls back a rejected optimistic pin and reconciles with the main revision', async () => {
  const client = createHyperTaskHubFixtureClient(HyperHubM1Fixture);
  let ack!: (r: HyperHubFeedbackResult) => void;
  client.sendFeedback = () => new Promise(resolve => { ack = resolve; });
  const store = createHyperTaskHubStore(client);
  await store.getState().load();
  const s = store.getState().snapshot!, card = s.tasks.find(t => !t.pinned)!;
  const result = store.getState().sendFeedback({ type: 'pin', targetId: card.id });
  expect(store.getState().snapshot?.tasks.find(t => t.id === card.id)?.pinned).toBe(true);
  ack({ ok: false, code: 'revision-conflict', revision: s.revision, scopeGeneration: s.scopeGeneration });
  expect((await result).ok).toBe(false);
  expect(store.getState().pending).toBeNull();
  expect(store.getState().snapshot?.tasks.find(t => t.id === card.id)?.pinned).toBe(false);
});
it('clears pending feedback on scope change and ignores late snapshots and acknowledgements', async () => {
  const client = createHyperTaskHubFixtureClient(HyperHubM1Fixture);
  let push!: (s: HyperHubSnapshot) => void, ack!: (r: HyperHubFeedbackResult) => void;
  client.onSnapshot = fn => { push = fn; return vi.fn(); };
  client.sendFeedback = () => new Promise(resolve => { ack = resolve; });
  const store = createHyperTaskHubStore(client);
  await store.getState().refresh();
  const previous = store.getState().snapshot!;
  const result = store.getState().sendFeedback({ type: 'dismiss', targetId: previous.tasks[0].id });
  push(HyperHubNothingConnectedFixture);
  push({ ...previous, revision: previous.revision + 10 });
  ack({ ...previous, ok: true, ledgerEntryId: 'old' });
  expect(await result).toMatchObject({ ok: false, code: 'scope-changed' });
  expect(store.getState()).toMatchObject({ snapshot: HyperHubNothingConnectedFixture, loading: false, error: null, pending: null });
});

async function m5Store() {
  const client = createHyperTaskHubFixtureClient(HyperHubM5Fixture);
  const store = createHyperTaskHubStore(client);
  await store.getState().load();
  const state = store.getState;
  const version = () => ({ expectedRevision: state().snapshot!.revision, scopeGeneration: state().snapshot!.scopeGeneration });
  const card = (n: number) => state().snapshot!.tasks.find(t => t.id.endsWith(String(n)))!;
  return { client, state, version, card };
}

it('previews, discards and confirms the exact fixture transition and Resolution', async () => {
  const { state, version, card } = await m5Store();
  const preview = () => state().previewStatus({ ...version(), handle: card(30).sources[0].handle, intent: { kind: 'state', state: 'done' } });
  const first = await preview();
  if (!first.ok) throw Error(first.code);
  expect(first.preview.candidates).toHaveLength(2);
  expect(first.preview.unavailable).toHaveLength(1);
  const candidate = first.preview.candidates.find(c => c.resolution)!;
  expect(candidate.preselected).toBe(true);
  const selection = { previewId: first.preview.previewId, candidateId: candidate.candidateId };
  expect(await state().discardStatus({ previewId: selection.previewId })).toMatchObject({ ok: true });
  expect(await state().approveStatus(selection)).toMatchObject({ outcome: 'expired' });
  const second = await preview();
  if (!second.ok) throw Error(second.code);
  expect(await state().approveStatus({ ...selection, previewId: second.preview.previewId })).toMatchObject({ outcome: 'failed', code: 'invalid' });
  const third = await preview();
  if (!third.ok) throw Error(third.code);
  const receipt = await state().approveStatus({ ...selection, previewId: third.preview.previewId, resolutionId: candidate.resolution!.values[0].id });
  if (receipt.outcome !== 'succeeded') throw Error(receipt.outcome);
  expect(state().snapshot!.writes).toContainEqual(receipt.write);
  expect(card(30).sourceStatus['evidence-30'].rawStatus).toBe('Done');
  const reverse = await state().previewStatus({ ...version(), intent: { kind: 'reverse', operationId: receipt.write.operationId } });
  expect(reverse).toMatchObject({ ok: true, preview: { candidates: [{ to: { name: 'In Review' }, preselected: true }] } });
  const leaf = await state().previewStatus({ ...version(), intent: { kind: 'choose' }, handle: card(31).sources[0].handle });
  if (!leaf.ok) throw Error(leaf.code);
  expect(leaf.preview.candidates.find(c => c.to.id === 'completed')?.effects.map(e => e.code))
    .toEqual(['progress-set', 'chart-normalized', 'parent-rollup']);
  expect(await state().previewStatus({ ...version(), intent: { kind: 'choose' }, handle: card(42).sources[0].handle }))
    .toMatchObject({ ok: false, code: 'not-leaf' });
});

it('releases planning only after the owner has a verified observation', async () => {
  const { state, version, card } = await m5Store();
  expect(await state().releaseHold({ ...version(), operationId: 'op-39' })).toMatchObject({ ok: false, code: 'held' });
  expect(await state().releaseHold({ ...version(), operationId: 'op-38' })).toMatchObject({ ok: true,
    write: { state: 'unknown', operationId: 'op-38', held: false, undoAvailable: false, ownerReleaseAvailable: false } });
  expect(await state().previewStatus({ ...version(), handle: card(38).sources[0].handle, intent: { kind: 'choose' } }))
    .toMatchObject({ ok: false, code: 'held' });
});

it('keeps matrix overrides through a weights save, undoes them and opens the confirmed mirror', async () => {
  const { state, version, card } = await m5Store();
  const base = version(), taskId = card(31).id, weights = { slack: 0, importance: 100, age: 0, unblocking: 0 };
  const preview = await state().previewWeights({ ...base, draft: weights, seq: 1 });
  expect(preview).toMatchObject({ ok: true, seq: 1 });
  if (!preview.ok) throw Error(preview.code);
  expect(preview.diff.topTen).toHaveLength(10);
  expect(version()).toEqual(base);
  const move = await state().sendFeedback({ type: 'set-matrix-quadrant', taskId, quadrant: 'neither' });
  if (!move.ok) throw Error(move.code);
  expect(await state().saveWeights({ ...base, weights })).toMatchObject({ ok: false, code: 'revision-conflict' });
  expect(await state().saveWeights({ ...version(), weights })).toMatchObject({ ok: true });
  expect(state().snapshot!.settings.weights).toEqual(weights);
  expect(state().snapshot!.matrixOverrides?.[taskId]).toBe('neither');
  expect(await state().sendFeedback({ type: 'undo', targetId: taskId, ledgerEntryId: move.ledgerEntryId })).toMatchObject({ ok: true });
  expect(state().snapshot!.matrixOverrides?.[taskId]).toBeUndefined();
  const mirror = await state().previewMirror({ ...version(), taskId });
  if (!mirror.ok) throw Error(mirror.code);
  expect(mirror.preview.title).toBe(card(31).title);
  const applied = await state().applyMirror({ token: mirror.preview.token });
  if (!applied.ok) throw Error(applied.code);
  expect(card(31).mirror).toEqual({ exists: true, handle: applied.handle });
  expect(await state().openSource(applied.handle)).toMatchObject({ ok: true });
  expect(await state().applyMirror({ token: mirror.preview.token })).toMatchObject({ ok: false });
});

it('discards late weights previews and refuses a stale save at an equal revision in a new scope', async () => {
  const { client, state, version } = await m5Store();
  const base = version(), draft = HyperHubM5Fixture.settings.weights;
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const preview = client.previewWeights;
  client.previewWeights = async r => { const result = await preview(r); if (r.seq === 1) await wait; return result; };
  const older = state().previewWeights({ ...base, draft, seq: 1 });
  expect(await state().previewWeights({ ...base, draft, seq: 2 })).toMatchObject({ ok: true, seq: 2 });
  finish();
  expect(await older).toMatchObject({ ok: false, code: 'revision-conflict' });
  client.getSnapshot = async () => ({ ...HyperHubM5Fixture, scopeGeneration: base.scopeGeneration + 1 });
  await state().load();
  const save = vi.spyOn(client, 'saveWeights');
  expect(await state().saveWeights({ ...base, weights: draft })).toMatchObject({ ok: false, code: 'scope-changed' });
  expect(save).not.toHaveBeenCalled();
});
