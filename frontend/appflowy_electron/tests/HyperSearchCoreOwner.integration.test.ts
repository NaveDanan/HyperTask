import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewIdPBSchema, RepeatedViewPBSchema, UpdateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { RepeatedTrashIdPBSchema } from '@shared/protobuf/flowy-folder/trash_pb';
import { SearchStatePBSchema } from '@shared/protobuf/flowy-search/notification_pb';
import { SearchQueryPBSchema } from '@shared/protobuf/flowy-search/query_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { hyperChildren, hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
const titleA = 'galacticchessrootalpha', bodyA = 'primordialrootbodysparrow';
const titleB = 'turbinevelocityrootbeta', bodyB = 'volcanicrootbodyfalcon';

class HyperSearchConnection {
  readonly core = new CoreProcess(binary);
  private sequence = 0n;
  private port = 19_000n;
  async start(root: string) { await this.core.start(() => {}); await this.initialize(root); }
  async initialize(root: string) {
    expect(await this.core.init({ root, app_version: '0.11.4', custom_app_path: root, origin_app_path: root, device_id: 'hyper-search-owner-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    this.sequence = 0n;
  }
  async request(event: string, input?: [DescMessage, object]) {
    const payload = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    const reply = await this.core.request(event, payload);
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async call<T extends DescMessage>(event: string, output: T, input?: [DescMessage, object]) { return fromBinary(output, await this.request(event, input)); }
  async localSearch(query: string) {
    const streamPort = ++this.port, searchId = String(++this.sequence), hits = new Set<string>();
    const listener = (received: bigint, value: unknown) => {
      if (received !== streamPort || !(value instanceof Uint8Array)) return;
      const state = fromBinary(SearchStatePBSchema, value);
      if (state.searchId !== searchId || state.oneOfResponse.case !== 'response') return;
      const local = state.oneOfResponse.value.oneOfLocalSearchResult;
      // Cloud/lexical fallback must not hide an absent or reused local index.
      if (local.case === 'localSearchResult') for (const item of local.value.items) hits.add(item.id);
    };
    this.core.on('portMessage', listener);
    try {
      await this.request('StreamSearch', [SearchQueryPBSchema, { search: query, searchId, streamPort }]);
      return [...hits];
    } finally { this.core.off('portMessage', listener); }
  }
}

(fs.existsSync(binary) ? describe : describe.skip)('Hyper local search roots through one Rust process', () => {
  it('keeps the same actor/workspace/view IDs isolated across A → B → A reinit and deletion', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-search-core-owner-'));
    const rootA = path.join(temporary, 'root-A'), rootB = path.join(temporary, 'root-B');
    fs.mkdirSync(rootA);
    const seedA = new HyperSearchConnection(), seedB = new HyperSearchConnection(), proof = new HyperSearchConnection();
    try {
      await seedA.start(rootA);
      const profile = await seedA.call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-search-owner-test' }]);
      const workspace = await seedA.call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
      const roots = await seedA.call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
      const view = await seedA.call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: titleA, layout: ViewLayoutPB.Document, setAsCurrent: false }]);
      let document = await seedA.call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
      const insertion = hyperInsertBlock(document, document.pageId, hyperChildren(document, document.blocks[document.pageId]).at(-1) ?? '', 'paragraph');
      await seedA.request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: view.id, actions: insertion.actions }]);
      document = await seedA.call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
      await seedA.request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: view.id, actions: hyperEditText(document, insertion.focus!.id, [{ insert: bodyA }]).actions }]);
      await vi.waitFor(async () => expect(await seedA.localSearch(bodyA)).toContain(view.id), { timeout: 45_000, interval: 150 });
      expect(await seedA.localSearch(titleA)).toContain(view.id);
      await seedA.core.stop();

      // Only closed disposable data is copied; no live RocksDB directory is read.
      fs.cpSync(rootA, rootB, { recursive: true });
      await seedB.start(rootB);
      expect((await seedB.call('GetUserProfile', UserProfilePBSchema)).id).toBe(profile.id);
      expect((await seedB.call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema)).workspaceId).toBe(workspace.workspaceId);
      document = await seedB.call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
      await seedB.request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: view.id, actions: hyperEditText(document, insertion.focus!.id, [{ insert: bodyB }]).actions }]);
      await seedB.request('UpdateView', [UpdateViewPayloadPBSchema, { viewId: view.id, oneOfName: { case: 'name', value: titleB } }]);
      await vi.waitFor(async () => {
        expect(await seedB.localSearch(bodyB)).toContain(view.id);
        expect(await seedB.localSearch(bodyA)).not.toContain(view.id);
      }, { timeout: 45_000, interval: 150 });
      expect(await seedB.localSearch(titleB)).toContain(view.id);
      await seedB.core.stop();

      await proof.start(rootA);
      expect(await proof.localSearch(bodyA)).toContain(view.id);
      expect(await proof.localSearch(bodyB)).not.toContain(view.id);
      // Reinit the same process, preserving the process-global cache under test.
      await proof.initialize(rootB);
      expect(await proof.localSearch(bodyB)).toContain(view.id);
      expect(await proof.localSearch(bodyA)).not.toContain(view.id);
      expect((await proof.call('GetView', ViewPBSchema, [ViewIdPBSchema, { value: view.id }])).name).toBe(titleB);
      await proof.request('DeleteView', [RepeatedViewIdPBSchema, { items: [view.id] }]);
      await proof.request('PermanentlyDeleteTrashItem', [RepeatedTrashIdPBSchema, { items: [{ id: view.id }] }]);
      await vi.waitFor(async () => expect(await proof.localSearch(bodyB)).not.toContain(view.id), { timeout: 3_000, interval: 50 });
      await proof.initialize(rootA);
      expect(await proof.localSearch(bodyA)).toContain(view.id);
      expect(await proof.localSearch(bodyB)).not.toContain(view.id);
      expect((await proof.call('GetView', ViewPBSchema, [ViewIdPBSchema, { value: view.id }])).name).toBe(titleA);
    } finally {
      await Promise.allSettled([seedA.core.stop(), seedB.core.stop(), proof.core.stop()]);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 240_000);
});
