import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { RepeatedTrashPBSchema, TrashIdPBSchema } from '@shared/protobuf/flowy-folder/trash_pb';
import { CreateOrphanViewPayloadPBSchema, CreateViewPayloadPBSchema, RepeatedViewIdPBSchema, RepeatedViewPBSchema, UpdateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema, ViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';
import { HyperOrganizationService, type HyperOrganizationBackend } from '../src/renderer/features/organization/HyperOrganizationService';
import { hyperOrganizationMetadata } from '../src/renderer/features/organization/HyperOrganizationModel';
import { hyperChildren, hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper organization (real Rust core)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypertask-organization-test-'));
  let core = new CoreProcess(binary);
  let ownerWorkspace = '', ownerUser = '';
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: dataDir, app_version: '0.11.4', custom_app_path: dataDir, origin_app_path: dataDir, device_id: 'hyper-organization-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  };
  async function request(event: string, input?: [DescMessage, object]) {
    const bytes = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    const result = await core.request(event, bytes);
    if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`);
    return result.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    return fromBinary(output, await request(event, input));
  }
  const backend: HyperOrganizationBackend = {
    owner: () => { const workspaceId = ownerWorkspace, actorId = ownerUser; return { workspaceId, actorId, contextKey: dataDir, isCurrent: () => workspaceId === ownerWorkspace && actorId === ownerUser }; },
    workspaceId: async () => (await call('ReadCurrentWorkspace', WorkspacePBSchema)).id,
    userId: async () => String((await call('GetUserProfile', UserProfilePBSchema)).id),
    views: async () => (await call('GetAllViews', RepeatedViewPBSchema)).items,
    view: async value => call('GetView', ViewPBSchema, [ViewIdPBSchema, { value }]),
    exists: async value => {
      const result = await core.request('GetView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, { value })));
      if (result.status === Status.Ok) return true;
      const error = fromBinary(FlowyErrorSchema, result.payload);
      if (error.code === ErrorCode.RecordNotFound) return false;
      throw new Error(error.msg);
    },
    trashIds: async () => (await call('ListTrashItems', RepeatedTrashPBSchema)).items.map(item => item.id),
    createJournal: vi.fn(async (parentViewId, viewId, name, section, extra) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, {
      parentViewId, name, layout: ViewLayoutPB.Document, setAsCurrent: false,
      oneOfViewId: { case: 'viewId', value: viewId }, oneOfSection: { case: 'section', value: section }, oneOfExtra: { case: 'extra', value: extra },
    }])),
    updateExtra: vi.fn(async (viewId, extra) => {
      await request('UpdateView', [UpdateViewPayloadPBSchema, { viewId, oneOfExtra: { case: 'extra', value: extra } }]);
    }),
  };
  async function rejectDuplicate(workspaceId: string, viewId: string) {
    const result = await core.request('CreateView', toBinary(CreateViewPayloadPBSchema, create(CreateViewPayloadPBSchema, {
      parentViewId: workspaceId, name: 'Replacement metadata', layout: ViewLayoutPB.Document,
      oneOfViewId: { case: 'viewId', value: viewId }, oneOfExtra: { case: 'extra', value: '{}' },
    })));
    expect(result.status).toBe(Status.Err);
    const error = fromBinary(FlowyErrorSchema, result.payload);
    expect(error.code).toBe(ErrorCode.RecordAlreadyExists);
    expect(error.msg).toBe('A view with this id already exists');
    const orphan = await core.request('CreateOrphanView', toBinary(CreateOrphanViewPayloadPBSchema, create(CreateOrphanViewPayloadPBSchema, { viewId, name: 'Replacement orphan', layout: ViewLayoutPB.Document })));
    expect(orphan.status).toBe(Status.Err);
    expect(fromBinary(FlowyErrorSchema, orphan.payload).code).toBe(ErrorCode.RecordAlreadyExists);
  }
  afterAll(async () => { await core.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  it('persists journals/tags, reuses journals after restart and respects locked/trash pages', async () => {
    await initialize();
    ownerUser = String((await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-organization-test' }])).id);
    const workspaceId = await backend.workspaceId(), service = new HyperOrganizationService(backend);
    ownerWorkspace = workspaceId;
    const first = service.ensureJournal(workspaceId, '2026-11-10', ViewSectionPB.Public);
    const concurrent = service.ensureJournal(workspaceId, '2026-11-10', ViewSectionPB.Public);
    expect(concurrent).toBe(first);
    const journal = await first;
    expect(hyperOrganizationMetadata(journal)).toEqual({ tags: [], journalDate: '2026-11-10' });
    expect(backend.createJournal).toHaveBeenCalledTimes(1);
    const extra = JSON.parse(journal.oneOfExtra.case === 'extra' ? journal.oneOfExtra.value : '{}');
    await backend.updateExtra(journal.id, JSON.stringify({ ...extra, cover: { type: '2', value: 'existing-cover' }, unrelated: 123 }));
    const tagged = await service.setTags(workspaceId, journal.id, [' Work ', 'work', 'Planning']);
    expect(hyperOrganizationMetadata(tagged)).toEqual({ tags: ['Work', 'Planning'], journalDate: '2026-11-10' });
    expect(JSON.parse(tagged.oneOfExtra.case === 'extra' ? tagged.oneOfExtra.value : '{}')).toMatchObject({ cover: { value: 'existing-cover' }, unrelated: 123 });
    // UpdateView must return the actual ViewPB promised by its declared event schema.
    const acknowledged = await call('UpdateView', ViewPBSchema, [UpdateViewPayloadPBSchema, { viewId: journal.id, oneOfExtra: tagged.oneOfExtra }]);
    expect(acknowledged.id).toBe(journal.id);
    expect(acknowledged.oneOfExtra).toEqual(tagged.oneOfExtra);
    let document = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: journal.id }]);
    const inserted = hyperInsertBlock(document, document.pageId, hyperChildren(document, document.blocks[document.pageId]).at(-1) ?? '', 'paragraph');
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: journal.id, actions: inserted.actions }]);
    const edited = hyperEditText(inserted.document, inserted.focus!.id, [{ insert: 'Do not replace this journal content.' }]);
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: journal.id, actions: edited.actions }]);
    document = await call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: journal.id }]);
    await rejectDuplicate(workspaceId, journal.id);
    expect((await backend.view(journal.id)).oneOfExtra).toEqual(tagged.oneOfExtra);
    expect(await call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: journal.id }])).toEqual(document);
    await request('LockView', [ViewIdPBSchema, { value: journal.id }]);
    const writeCount = vi.mocked(backend.updateExtra).mock.calls.length;
    await expect(service.setTags(workspaceId, journal.id, ['Changed'])).rejects.toThrow('locked');
    expect(vi.mocked(backend.updateExtra).mock.calls).toHaveLength(writeCount);
    await request('UnlockView', [ViewIdPBSchema, { value: journal.id }]);
    await core.stop(); core = new CoreProcess(binary); await initialize();
    const reopenedService = new HyperOrganizationService(backend);
    const reopened = await reopenedService.ensureJournal(workspaceId, '2026-11-10', ViewSectionPB.Public);
    expect(reopened.id).toBe(journal.id);
    expect(hyperOrganizationMetadata(reopened)).toEqual({ tags: ['Work', 'Planning'], journalDate: '2026-11-10' });
    expect(backend.createJournal).toHaveBeenCalledTimes(1);
    await request('DeleteView', [RepeatedViewIdPBSchema, { items: [journal.id] }]);
    expect((await reopenedService.pages(workspaceId)).some(page => page.id === journal.id)).toBe(false);
    await expect(reopenedService.ensureJournal(workspaceId, '2026-11-10', ViewSectionPB.Public)).rejects.toThrow();
    await rejectDuplicate(workspaceId, journal.id);
    await request('RestoreTrashItem', [TrashIdPBSchema, { id: journal.id }]);
    expect(hyperOrganizationMetadata(await backend.view(journal.id)).tags).toEqual(['Work', 'Planning']);
    expect(await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: journal.id }])).toEqual(document);
  });
});
