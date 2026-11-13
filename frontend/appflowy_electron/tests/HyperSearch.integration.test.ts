import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, UpdateViewPayloadPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
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
(fs.existsSync(binary) ? describe : describe.skip)('Hyper search indexing through the Rust core', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-search-core-'));
  let core = new CoreProcess(binary), sequence = BigInt(Date.now()), port = 9000n;
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-search-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  };
  async function request(event: string, input?: [DescMessage, object]) {
    const bytes = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    const reply = await core.request(event, bytes);
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<T extends DescMessage>(event: string, output: T, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function search(query: string) {
    const streamPort = ++port, searchId = String(++sequence), hits = new Set<string>();
    const listener = (receivedPort: bigint, value: unknown) => {
      if (receivedPort !== streamPort || !(value instanceof Uint8Array)) return;
      const state = fromBinary(SearchStatePBSchema, value);
      if (state.searchId !== searchId || state.oneOfResponse.case !== 'response') return;
      const response = state.oneOfResponse.value;
      if (response.oneOfLocalSearchResult.case === 'localSearchResult') for (const hit of response.oneOfLocalSearchResult.value.items) hits.add(hit.id);
      if (response.oneOfSearchResult.case === 'searchResult') for (const hit of response.oneOfSearchResult.value.items) hits.add(hit.id);
    };
    core.on('portMessage', listener);
    try {
      // StreamSearch acknowledges only after its handler tasks have sent their results.
      await request('StreamSearch', [SearchQueryPBSchema, { search: query, searchId, streamPort }]);
      await new Promise(resolve => setTimeout(resolve, 20));
      return [...hits];
    } finally { core.off('portMessage', listener); }
  }
  afterAll(async () => { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); });

  it('finds a saved paragraph and renamed title, drops replaced text and retains the index after restart', async () => {
    await initialize();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-search-test' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    const roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'hypertitleoriginalprobe', layout: ViewLayoutPB.Document, setAsCurrent: false }]);
    let document = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
    const insertion = hyperInsertBlock(document, document.pageId, hyperChildren(document, document.blocks[document.pageId]).at(-1) ?? '', 'paragraph');
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: view.id, actions: insertion.actions }]);
    document = await call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
    const original = hyperEditText(document, insertion.focus!.id, [{ insert: 'hyperbodyoriginalprobe saved paragraph 🌍' }]);
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: view.id, actions: original.actions }]);
    // The native indexing worker batches saved content on a 30-second interval.
    await vi.waitFor(async () => expect(await search('hyperbodyoriginalprobe')).toContain(view.id), { timeout: 45_000, interval: 150 });
    expect(await search('hypertitleoriginalprobe')).toContain(view.id);
    document = await call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: view.id, actions: hyperEditText(document, insertion.focus!.id, [{ insert: 'hyperbodyreplacementprobe revised paragraph 🌍' }]).actions }]);
    await request('UpdateView', [UpdateViewPayloadPBSchema, { viewId: view.id, oneOfName: { case: 'name', value: 'hypertitlereplacementprobe' } }]);
    await vi.waitFor(async () => {
      expect(await search('hyperbodyreplacementprobe')).toContain(view.id);
      expect(await search('hyperbodyoriginalprobe')).not.toContain(view.id);
    }, { timeout: 45_000, interval: 150 });
    expect(await search('hypertitlereplacementprobe')).toContain(view.id);
    await core.stop(); core = new CoreProcess(binary); await initialize();
    await vi.waitFor(async () => expect(await search('hyperbodyreplacementprobe')).toContain(view.id), { timeout: 45_000, interval: 150 });
    expect(await search('hypertitlereplacementprobe')).toContain(view.id);
  }, 150_000);
});
