import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { DateQueryPBSchema, DateResultPBSchema } from '@shared/protobuf/flowy-date/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SubscribeObjectSchema } from '@shared/protobuf/flowy-notification/subject_pb';
import { SearchStatePBSchema, type SearchStatePB } from '@shared/protobuf/flowy-search/notification_pb';
import { SearchQueryPBSchema } from '@shared/protobuf/flowy-search/query_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from './process';
import { Status } from './protocol';
import { coreBinaryPath } from './binary';
import { CloseDocumentPayloadPBSchema, DocumentDataPBSchema, DocumentTextPBSchema, OpenDocumentPayloadPBSchema, TextDeltaPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { GetFieldPayloadPBSchema, RepeatedFieldPBSchema } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { CreateRowPayloadPBSchema, RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { CellChangesetPBSchema, CellIdPBSchema, CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';

// Runs against the real core binary built from rust-lib/electron-core.
const binary = coreBinaryPath(path.resolve(__dirname, '../../..'), false);
const describeWithCore = fs.existsSync(binary) ? describe : describe.skip;

describeWithCore('core process (real binary)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appflowy-electron-test-'));
  const core = new CoreProcess(binary);
  const configuration = {
    root: dataDir, app_version: '0.11.4', custom_app_path: dataDir, origin_app_path: dataDir,
    device_id: 'electron-integration-test', platform: 'windows', authenticator_type: 0,
    appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {},
  };
  const notifications: Array<{ source: string; ty: number; id: string }> = [];
  core.on('notification', (bytes) => {
    const subject = fromBinary(SubscribeObjectSchema, bytes);
    notifications.push({ source: subject.source, ty: subject.ty, id: subject.id });
  });

  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    const payload = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    const reply = await core.request(event, payload);
    if (reply.status !== Status.Ok) {
      throw new Error(`${event} failed: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    }
    return fromBinary(output, reply.payload);
  }

  afterAll(async () => {
    await core.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('initializes and answers events like dart-ffi', async () => {
    await core.start(() => {});
    const code = await core.init(configuration);
    expect(code).toBe(0);

    const date = await call('QueryDate', DateResultPBSchema, [DateQueryPBSchema, { query: 'tomorrow' }]);
    expect(date.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // No user is signed in yet, so reading the profile fails with a FlowyError.
    const profile = await core.request('GetUserProfile', new Uint8Array());
    expect(profile.status).toBe(Status.Err);
    expect(fromBinary(FlowyErrorSchema, profile.payload).code).not.toBe(0);
    expect((await core.request('HyperGetNativeIdentity', new Uint8Array())).status).not.toBe(Status.Ok);
  });

  it('runs the local-mode startup sequence and streams folder notifications', async () => {
    // SplashScreen in local mode: sign up the guest user (AuthService.signUpAsGuest).
    const user = await call('SignUp', UserProfilePBSchema, [
      SignUpPayloadPBSchema,
      { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'electron-integration-test' },
    ]);
    expect(user.id).toBeGreaterThan(0n);
    expect(user.userAuthType).toBe(AuthTypePB.Local);

    const again = await call('GetUserProfile', UserProfilePBSchema);
    expect(again.id).toBe(user.id);
    const identity = await core.request('HyperGetNativeIdentity', new Uint8Array());
    expect(identity.status).toBe(Status.Ok);
    const nativeIdentity = JSON.parse(new TextDecoder().decode(identity.payload));
    expect(nativeIdentity.version).toBe(1);
    expect(nativeIdentity.domain).toBe('local');
    expect(nativeIdentity.userId).toBe(user.id.toString());
    expect(nativeIdentity.userUuid).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    expect(nativeIdentity.userUuid).not.toBe('00000000-0000-0000-0000-000000000000');
    expect((await core.request('HyperGetNativeIdentity', new Uint8Array())).payload).toEqual(identity.payload);

    // DesktopHomeScreen: the workspace setting and its views.
    const setting = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    expect(setting.workspaceId).not.toBe('');
    const views = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: setting.workspaceId }]);
    expect(views.items.length).toBeGreaterThan(0);

    // Creating a page under the first root view notifies its parent.
    const parent = views.items[0];
    const page = await call('CreateView', ViewPBSchema, [
      CreateViewPayloadPBSchema,
      { parentViewId: parent.id, name: 'Electron page', layout: ViewLayoutPB.Document, setAsCurrent: false },
    ]);
    expect(page.name).toBe('Electron page');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(notifications.some((n) => n.source === 'Workspace' && n.id === parent.id)).toBe(true);
  });

  it('streams search results to a stream port, as Dart receive ports get them', async () => {
    const received: SearchStatePB[] = [];
    core.on('portMessage', (port, value) => {
      if (port === 77n && value instanceof Uint8Array) received.push(fromBinary(SearchStatePBSchema, value));
    });
    const reply = await core.request(
      'StreamSearch',
      toBinary(SearchQueryPBSchema, create(SearchQueryPBSchema, { search: 'Electron', searchId: '1', streamPort: 77n })),
    );
    expect(reply.status).toBe(Status.Ok);
    const deadline = Date.now() + 10_000;
    while (!received.some((state) => state.oneOfResponse.case !== 'response') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // The stream ends with an empty state (onFinished); results arrive before it.
    expect(received.length).toBeGreaterThan(0);
    expect(received.at(-1)!.oneOfResponse.case).toBeUndefined();
  });

  it('preserves native document text and database cells across a real core restart', async () => {
    const user = await call('GetUserProfile', UserProfilePBSchema);
    const setting = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    const views = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: setting.workspaceId }]);
    const createView = (name: string, layout: ViewLayoutPB) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: views.items[0].id, name, layout, setAsCurrent: false }]);
    async function write(event: string, input: [DescMessage, object]) {
      const reply = await core.request(event, toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)));
      if (reply.status !== Status.Ok) throw new Error(`${event} failed: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    }

    const document = await createView('Hyper document regression', ViewLayoutPB.Document);
    const data = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: document.id }]);
    const paragraph = Object.values(data.blocks).find(block => block.ty === 'paragraph');
    const textId = paragraph?.oneOfExternalId.case === 'externalId' ? paragraph.oneOfExternalId.value : undefined;
    expect(textId).toBeTypeOf('string');
    const marker = 'HyperTask document persistence שלום';
    await write('ApplyTextDeltaEvent', [TextDeltaPayloadPBSchema, { documentId: document.id, textId, oneOfDelta: { case: 'delta', value: JSON.stringify([{ insert: marker }]) } }]);
    const textBefore = await call('GetDocumentText', DocumentTextPBSchema, [OpenDocumentPayloadPBSchema, { documentId: document.id }]);
    expect(textBefore.text).toContain(marker);

    const grid = await createView('Hyper dataset regression', ViewLayoutPB.Grid);
    await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: grid.id }]);
    const fields = await call('GetFields', RepeatedFieldPBSchema, [GetFieldPayloadPBSchema, { viewId: grid.id }]);
    const primary = fields.items.find(field => field.isPrimary)!;
    expect(primary).toBeDefined();
    const row = await call('CreateRow', RowMetaPBSchema, [CreateRowPayloadPBSchema, { viewId: grid.id, rowPosition: { position: 0 }, data: { [primary.id]: 'HyperTask row' } }]);
    const cell = { viewId: grid.id, rowId: row.id, fieldId: primary.id };
    const updated = 'HyperTask cell persistence שלום';
    await write('UpdateCell', [CellChangesetPBSchema, { ...cell, cellChangeset: updated }]);
    const cellBefore = await call('GetCell', CellPBSchema, [CellIdPBSchema, cell]);
    expect(new TextDecoder().decode(cellBefore.data)).toBe(updated);
    await write('CloseDocument', [CloseDocumentPayloadPBSchema, { documentId: document.id }]);

    await core.stop(); await core.start(() => {}); expect(await core.init(configuration)).toBe(0);
    expect((await call('GetUserProfile', UserProfilePBSchema)).id).toBe(user.id);
    const restoredDocument = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: document.id }]);
    expect(restoredDocument.pageId).toBe(data.pageId);
    const textAfter = await call('GetDocumentText', DocumentTextPBSchema, [OpenDocumentPayloadPBSchema, { documentId: document.id }]);
    expect(textAfter.text).toBe(textBefore.text);
    const restoredGrid = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: grid.id }]);
    expect(restoredGrid.rows.some(each => each.id === row.id)).toBe(true);
    const cellAfter = await call('GetCell', CellPBSchema, [CellIdPBSchema, cell]);
    expect(cellAfter.data).toEqual(cellBefore.data);
  });
});
