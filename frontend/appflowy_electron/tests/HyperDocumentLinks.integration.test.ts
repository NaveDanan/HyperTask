import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, RepeatedViewIdPBSchema, RepeatedViewPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';
import { HyperDocumentLinkService, hyperPageMention } from '../src/renderer/features/document-links/HyperDocumentLinkService';
import { hyperChildren, hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper page links (real core)', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-page-links-'));
  let core = new CoreProcess(binary);
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-page-links-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  };
  async function request(event: string, input?: [DescMessage, object]) {
    const bytes = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    const result = await core.request(event, bytes);
    if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`);
    return result.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  const service = new HyperDocumentLinkService({
    identity: async () => ({ workspaceId: (await call('ReadCurrentWorkspace', WorkspacePBSchema)).id, userId: String((await call('GetUserProfile', UserProfilePBSchema)).id) }),
    views: async () => (await call('GetAllViews', RepeatedViewPBSchema)).items,
    view: value => call('GetView', ViewPBSchema, [ViewIdPBSchema, { value }]),
    document: documentId => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]),
  });
  afterAll(async () => { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); });
  it('discovers persisted mentions after restart and omits trashed source pages', async () => {
    await initialize();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-page-links-test' }]);
    const workspace = await call('ReadCurrentWorkspace', WorkspacePBSchema);
    const make = (name: string) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.id, name, layout: ViewLayoutPB.Document, setAsCurrent: false }]);
    const target = await make('Link target'), source = await make('Link source');
    let doc = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: source.id }]);
    const added = hyperInsertBlock(doc, doc.pageId, hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '', 'paragraph');
    const changed = hyperEditText(added.document, added.focus!.id, [{ insert: 'References ' }, ...hyperPageMention(target.id)]);
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: source.id, actions: [...added.actions, ...changed.actions] }]);
    let result = await service.backlinks(target.id, () => {});
    expect(result.failures).toEqual([]);
    expect(result.links.map(link => link.view.id)).toEqual([source.id]);
    expect(result.links[0].blockIds).toEqual([added.focus!.id]);
    await core.stop(); core = new CoreProcess(binary); await initialize();
    result = await service.backlinks(target.id, () => {});
    expect(result.failures).toEqual([]); expect(result.links.map(link => link.view.id)).toEqual([source.id]);
    await request('DeleteView', [RepeatedViewIdPBSchema, { items: [source.id] }]);
    result = await service.backlinks(target.id, () => {});
    expect(result.failures).toEqual([]); expect(result.links).toEqual([]);
  });
});
