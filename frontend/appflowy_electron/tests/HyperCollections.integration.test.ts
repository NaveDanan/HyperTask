import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, UpdateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema, ViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperOrganizationService, type HyperOrganizationBackend } from '../src/renderer/features/organization/HyperOrganizationService';
import { hyperCollectionPages, hyperDefaultCollection, hyperPageProperties, hyperReadCollection } from '../src/renderer/features/organization/HyperCollectionModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper collections (real Rust core)', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-collections-test-'));
  let core = new CoreProcess(binary);
  let ownerWorkspace = '', ownerUser = '';
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-collections-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  };
  async function request(event: string, input?: [DescMessage, object]) {
    const bytes = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([core.request(event, bytes), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${event} timed out`)), 15000); })]);
      if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`);
      return result.payload;
    } finally { clearTimeout(timer); }
  }
  async function call<O extends DescMessage>(event: string, schema: O, input?: [DescMessage, object]) { return fromBinary(schema, await request(event, input)); }
  const backend: HyperOrganizationBackend = {
    owner: () => { const workspaceId = ownerWorkspace, actorId = ownerUser; return { workspaceId, actorId, contextKey: support, isCurrent: () => workspaceId === ownerWorkspace && actorId === ownerUser }; },
    workspaceId: async () => (await call('ReadCurrentWorkspace', WorkspacePBSchema)).id,
    userId: async () => String((await call('GetUserProfile', UserProfilePBSchema)).id),
    views: async () => (await call('GetAllViews', RepeatedViewPBSchema)).items,
    view: async value => call('GetView', ViewPBSchema, [ViewIdPBSchema, { value }]),
    exists: async id => (await backend.views()).some(view => view.id === id), trashIds: async () => [],
    createJournal: async (parentViewId, viewId, name, section, extra) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId, name, layout: ViewLayoutPB.Document, setAsCurrent: false, oneOfViewId: { case: 'viewId', value: viewId }, oneOfSection: { case: 'section', value: section }, oneOfExtra: { case: 'extra', value: extra } }]),
    updateExtra: async (viewId, extra) => { await request('UpdateView', [UpdateViewPayloadPBSchema, { viewId, oneOfExtra: { case: 'extra', value: extra } }]); },
  };
  afterAll(async () => { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); });
  it('persists typed properties and collection rules through restart without replacing page metadata', async () => {
    await initialize();
    ownerUser = String((await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-collections-test' }])).id);
    const workspaceId = await backend.workspaceId(), service = new HyperOrganizationService(backend);
    ownerWorkspace = workspaceId;
    const page = await backend.createJournal(workspaceId, crypto.randomUUID(), 'Project Alpha', ViewSectionPB.Public, '{"cover":{"value":"preserved"},"hyperOrganization":{"tags":["Work"]}}');
    await service.setProperty(workspaceId, page.id, 'priority', { name: 'Priority', type: 'number', value: 3 });
    await service.setProperty(workspaceId, page.id, 'due_date', { name: 'Due date', type: 'date', value: '2026-11-10' });
    await service.setProperty(workspaceId, page.id, 'done', { name: 'Done', type: 'checkbox', value: false });
    const config = { ...hyperDefaultCollection(), tag: 'Work', rules: [{ property: 'priority', type: 'number' as const, operator: 'gt' as const, value: 2 }] };
    const collection = await service.createCollection(workspaceId, page.id, 'High priority', config, ViewSectionPB.Public);
    expect(collection.parentViewId).toBe(page.id);
    expect(hyperCollectionPages(await service.pages(workspaceId), hyperReadCollection(collection)!, collection.id).map(view => view.id)).toEqual([page.id]);
    const tagged = await service.setTags(workspaceId, page.id, ['Work', 'Planning']);
    expect(hyperPageProperties(tagged).properties).toMatchObject({ priority: { value: 3 }, done: { value: false }, due_date: { value: '2026-11-10' } });
    expect(JSON.parse(tagged.oneOfExtra.case === 'extra' ? tagged.oneOfExtra.value : '{}').cover).toEqual({ value: 'preserved' });
    await request('LockView', [ViewIdPBSchema, { value: page.id }]);
    await expect(service.setProperty(workspaceId, page.id, 'done', { name: 'Done', type: 'checkbox', value: true })).rejects.toThrow('locked');
    await core.stop(); core = new CoreProcess(binary); await initialize();
    const fresh = new HyperOrganizationService(backend), reopened = await backend.view(collection.id);
    expect(hyperReadCollection(reopened)).toEqual(config);
    expect(hyperCollectionPages(await fresh.pages(workspaceId), config, collection.id).map(view => view.id)).toEqual([page.id]);
    expect(hyperPageProperties(await backend.view(page.id)).properties.done.value).toBe(false);
    await request('UnlockView', [ViewIdPBSchema, { value: page.id }]);
    await fresh.setProperty(workspaceId, page.id, 'priority', null);
    expect(hyperCollectionPages(await fresh.pages(workspaceId), config, collection.id)).toEqual([]);
  });
});
