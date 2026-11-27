import { expect, it, vi } from 'vitest';
import { HyperHubM1Fixture } from '@shared/HyperTaskHub.fixtures';
import { createHyperTaskHubFixtureClient, HyperTaskHubClient } from './HyperTaskHubClient';

it('wraps the preload, with revocable subscriptions and no source fetch in renderer', async ({ onTestFinished }) => {
  const api = createHyperTaskHubFixtureClient(HyperHubM1Fixture);
  vi.stubGlobal('window', { hypertask: { taskHub: api } }); onTestFinished(() => { vi.unstubAllGlobals(); });
  const event = vi.fn(), off = HyperTaskHubClient.onSnapshot(event);
  const s = await HyperTaskHubClient.getSnapshot();
  const card = s.tasks[0];
  expect(await HyperTaskHubClient.openSource(card.sources[0].handle)).toMatchObject({ ok: true });
  const pinned = await HyperTaskHubClient.sendFeedback({ type: 'pin', targetId: card.id, scopeGeneration: s.scopeGeneration, expectedRevision: s.revision });
  expect(pinned.ok).toBe(true);
  expect(await HyperTaskHubClient.openSource(card.sources[0].handle)).toMatchObject({ ok: false });
  expect(event).toHaveBeenCalledOnce();
  off();
  expect(await HyperTaskHubClient.sendFeedback({ type: 'unpin', targetId: card.id, scopeGeneration: s.scopeGeneration, expectedRevision: s.revision }))
    .toMatchObject({ ok: false, code: 'revision-conflict' });
  expect(event).toHaveBeenCalledOnce();
});

it('lets the renderer exercise a suggested merge, split and undo with refreshed handles', async () => {
  const { HyperHubM3Fixture } = await import('@shared/HyperTaskHub.fixtures');
  const client = createHyperTaskHubFixtureClient(HyperHubM3Fixture);
  const version = async () => {
    const s = await client.getSnapshot();
    return { scopeGeneration: s.scopeGeneration, expectedRevision: s.revision };
  };
  const { targetId, otherTaskId } = HyperHubM3Fixture.linkSuggestions![0];
  const merge = await client.sendFeedback({ ...await version(), type: 'merge', targetId, otherTaskId });
  if (!merge.ok) throw Error(merge.code);
  let snap = await client.getSnapshot();
  expect(snap.tasks.some(t => t.id === otherTaskId)).toBe(false);
  expect(snap.tasks.find(t => t.id === targetId)?.mergeEntryIds).toContain(merge.ledgerEntryId);
  const split = await client.sendFeedback({ ...await version(), type: 'split', targetId, mergeEntryId: merge.ledgerEntryId });
  if (!split.ok) throw Error(split.code);
  snap = await client.getSnapshot();
  expect(snap.tasks.some(t => t.id === otherTaskId)).toBe(true);
  expect(snap.linkSuggestions).toEqual([]);
  expect(await client.sendFeedback({ ...await version(), type: 'undo', targetId, ledgerEntryId: split.ledgerEntryId })).toMatchObject({ ok: true });
  expect(await client.sendFeedback({ ...await version(), type: 'undo', targetId, ledgerEntryId: merge.ledgerEntryId })).toMatchObject({ ok: true });
  expect((await client.getSnapshot()).linkSuggestions).toEqual(HyperHubM3Fixture.linkSuggestions);
  expect((await client.getSetupOptions()).mailbox).toEqual({ available: true, flagsVerified: false });
});
