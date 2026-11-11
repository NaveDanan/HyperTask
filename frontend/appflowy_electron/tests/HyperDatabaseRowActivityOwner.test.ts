import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { useAppStore } from '../src/renderer/startup/app-store';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { hyperCaptureDuplicateOwner } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateBackend';
import { HyperDatabaseRowActivity, type HyperDatabaseRowActivityRequest, type HyperDatabaseRowActivityAck } from '../src/renderer/features/database/HyperDatabaseRowActivity';
import { HyperDatabaseDraftController } from '../src/renderer/features/database/HyperDatabaseDraft';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import type { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';

const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const ack = (value: HyperDatabaseRowActivityRequest): HyperDatabaseRowActivityAck => ({ contextId: value.contextId, activityId: value.activityId, revision: value.revision });
describe('Hyper database activity owner and draft integration', () => {
  for (const change of ['account', 'storage', 'launch'] as const) it(`rejects a late activation after ${change} ABA and allows a fresh captured owner`, async () => {
    const app = useAppStore.getState(), workspace = useWorkspaceStore.getState();
    try {
      useAppStore.setState({ dataDirectory: '/disposable/row-activity', env: null });
      useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null });
      const owner = hyperCaptureDuplicateOwner()!;
      const calls: HyperDatabaseRowActivityRequest[] = []; let resolve!: (value: HyperDatabaseRowActivityAck) => void, activations = 0;
      const activity = new HyperDatabaseRowActivity({ owner, contextId: 'original-context', viewId: 'view', activityId: 'original-pane', activated: () => { activations++; }, backend: { updateRowActivity: request => { calls.push(request); return new Promise(yes => { resolve = yes; }); } } });
      activity.rows(Symbol(), ['row']); await tick();
      if (change === 'account') { useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 2n }) }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }) }); }
      if (change === 'storage') { useAppStore.setState({ dataDirectory: '/disposable/other' }); useAppStore.setState({ dataDirectory: '/disposable/row-activity' }); }
      if (change === 'launch') { useAppStore.setState({ launchId: app.launchId + 1 }); useAppStore.setState({ launchId: app.launchId }); }
      expect(owner.isCurrent()).toBe(false); resolve(ack(calls[0])); await tick(); const disposing = activity.dispose();
      expect(activations).toBe(0); expect(calls).toHaveLength(2); expect(calls[1]).toMatchObject({ contextId: 'original-context', activityId: 'original-pane', rowIds: [], closeActivity: true }); resolve(ack(calls[1])); await disposing;
      const fresh = new HyperDatabaseRowActivity({ owner: hyperCaptureDuplicateOwner()!, contextId: 'fresh-context', viewId: 'view', activityId: 'fresh-pane', activated: () => { activations++; }, backend: { updateRowActivity: async request => { calls.push(request); return ack(request); } } });
      fresh.rows(Symbol(), ['row']); await tick(); expect(activations).toBe(1); expect(calls[2].contextId).toBe('fresh-context'); await fresh.dispose();
    } finally { useWorkspaceStore.setState(workspace); useAppStore.setState(app); }
  });

  it('keeps an unsent dirty cell unchanged through activation failure, retry, and fresh native notifications', async () => {
    const owner = { workspaceId: 'workspace', actorId: 'actor', contextKey: 'realm', isCurrent: () => true };
    const field = create(FieldPBSchema, { id: 'title', name: 'Title', fieldType: FieldType.RichText });
    let saved = 'Original saved value', reads = 0, writes = 0, fail = true;
    const repository = { cell: async () => { reads++; return create(CellPBSchema, { rowId: 'row', fieldId: field.id, data: new TextEncoder().encode(saved) }); }, updateText: async () => { writes++; } } as unknown as HyperDatabaseRepository;
    const draft = new HyperDatabaseDraftController(owner, 'database', 'row', field);
    await draft.load(repository, 'view', field); draft.edit('LOCAL UNSAVED');
    const requests: HyperDatabaseRowActivityRequest[] = [];
    const activity = new HyperDatabaseRowActivity({ owner, contextId: 'context', activityId: 'pane', viewId: 'view', activated: () => { void draft.load(repository, 'view', field); }, backend: { updateRowActivity: async request => { requests.push(request); if (fail) throw Error('Offline'); return ack(request); } } });
    activity.rows(Symbol(), ['row']); await tick(); expect(activity.getSnapshot().status).toBe('error');
    saved = 'New remote saved value'; fail = false; activity.retry(); await tick();
    await draft.load(repository, 'view', field);
    expect(draft.getSnapshot()).toMatchObject({ draft: 'LOCAL UNSAVED', dirty: true }); expect(reads).toBe(1); expect(writes).toBe(0); expect(requests).toHaveLength(2);
    await activity.dispose(); expect(draft.getSnapshot().draft).toBe('LOCAL UNSAVED'); expect(writes).toBe(0);
  });
});
