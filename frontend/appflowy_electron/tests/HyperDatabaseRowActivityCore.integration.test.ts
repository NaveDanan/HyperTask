import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { CreateViewPayloadPBSchema, ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema, HyperRowActivityAckPBSchema, HyperUpdateRowActivityPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { CreateRowPayloadPBSchema, RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';

const root = path.resolve(__dirname, '..'), binary = coreBinaryPath(root, false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper row activity actual native dispatch lifecycle', () => {
  it('reopens the same support database without any row activation', async () => {
    const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-row-activity-sdk-control-'));
    const cleared = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]));
    const core = new CoreProcess(binary, () => ({ ...cleared, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TMPDIR: support }));
    const config = { root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-row-activity-control', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} };
    const events: string[] = [], startupErrors: string[] = [];
    async function call<O extends DescMessage>(event: string, output: O, schema?: DescMessage, value: object = {}) {
      events.push(event);
      const result = await core.request(event, schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array());
      if (result.status !== 0) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}${startupErrors.length ? ' | ' + startupErrors.join(' | ') : ''}`);
      return fromBinary(output, result.payload);
    }
    try {
      await core.start(bytes => { for (const line of bytes.toString().split('\n')) if (line.includes('Init user failed:')) startupErrors.push(line.replace(/\x1b\[[0-9;]*m/g, '').trim()); });
      expect(await core.init(config)).toBe(0);
      const user = await call('SignUp', UserProfilePBSchema, SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'SDK control', password: 'FakeLocalFixture123!', authType: 0, deviceId: config.device_id });
      const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
      const view = await call('CreateView', ViewPBSchema, CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Read-only SDK control', layout: ViewLayoutPB.Grid });
      const original = await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: view.id });
      expect(original.rows.length).toBeGreaterThan(0);
      expect(await core.init(config)).toBe(0);
      expect((await call('GetUserProfile', UserProfilePBSchema)).id).toBe(user.id);
      expect((await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema)).workspaceId).toBe(workspace.workspaceId);
      const reopened = await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: view.id });
      expect(reopened.rows.map(row => row.id)).toEqual(original.rows.map(row => row.id));
      expect(events).not.toContain('HyperUpdateRowActivity');
    } finally { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); }
  }, 30_000);

  it('keeps empty and linked readers alive, retires complete closes, and rejects old SDK contexts', async () => {
    const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-row-activity-core-'));
    const cleared = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]));
    const core = new CoreProcess(binary, () => ({ ...cleared, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TMPDIR: support }));
    const config = { root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-row-activity-core', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} };
    const startupErrors: string[] = [];
    const raw = async (event: string, schema?: DescMessage, value: object = {}) => core.request(event, schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array());
    async function call<O extends DescMessage>(event: string, output: O, schema?: DescMessage, value: object = {}) {
      const result = await raw(event, schema, value);
      if (result.status !== 0) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}${startupErrors.length ? ' | ' + startupErrors.join(' | ') : ''}`);
      return fromBinary(output, result.payload);
    }
    const activity = (viewId: string, contextId: string, activityId: string, revision: bigint, rowIds: string[], closeActivity = false) => call('HyperUpdateRowActivity', HyperRowActivityAckPBSchema, HyperUpdateRowActivityPBSchema, { viewId, contextId, activityId, revision, rowIds, closeActivity });
    try {
      await core.start(bytes => { for (const line of bytes.toString().split('\n')) if (line.includes('Init user failed:')) startupErrors.push(line.replace(/\x1b\[[0-9;]*m/g, '').trim()); }); expect(await core.init(config)).toBe(0);
      // Local guest signup uses the same anonymous email as the production launcher.
      // Arbitrary local emails do not register an anonymous workspace for startup.
      const user = await call('SignUp', UserProfilePBSchema, SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Row activity fixture', password: 'FakeLocalFixture123!', authType: 0, deviceId: config.device_id });
      const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
      const view = await call('CreateView', ViewPBSchema, CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Activity source', layout: ViewLayoutPB.Grid });
      let database = await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: view.id });
      const ids = database.rows.map(row => row.id);
      while (ids.length < 61) ids.push((await call('CreateRow', RowMetaPBSchema, CreateRowPayloadPBSchema, { viewId: view.id })).id);
      database = await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: view.id });
      const context = database.rowActivityContext, a = crypto.randomUUID(), empty = crypto.randomUUID(); expect(context).not.toBe('');
      expect((await activity(view.id, context, a, 1n, ids)).revision).toBe(1n);
      await activity(view.id, context, empty, 1n, []);
      await activity(view.id, context, a, 2n, [], true);
      expect((await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: view.id })).rowActivityContext).toBe(context);
      expect((await raw('HyperUpdateRowActivity', HyperUpdateRowActivityPBSchema, { viewId: view.id, contextId: context, activityId: a, revision: 3n, rowIds: ids, closeActivity: false })).status).not.toBe(0);
      await activity(view.id, context, empty, 2n, [], true);
      const reopened = await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: view.id }); expect(reopened.rowActivityContext).not.toBe(context);
      const stale = { viewId: view.id, contextId: context, activityId: crypto.randomUUID(), revision: 1n, rowIds: [], closeActivity: false };
      expect((await raw('HyperUpdateRowActivity', HyperUpdateRowActivityPBSchema, stale)).status).not.toBe(0);
      expect((await activity(view.id, context, stale.activityId, 2n, [], true)).contextId).toBe(context);

      const linked = await call('CreateView', ViewPBSchema, CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Linked reader', layout: ViewLayoutPB.Grid, meta: { database_id: database.id } });
      const linkedDatabase = await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: linked.id }); expect(linkedDatabase.id).toBe(database.id);
      const aa = crypto.randomUUID(), bb = crypto.randomUUID();
      await activity(view.id, reopened.rowActivityContext, aa, 1n, ids);
      await activity(linked.id, linkedDatabase.rowActivityContext, bb, 1n, ids.slice(0, 20));
      await activity(view.id, reopened.rowActivityContext, aa, 2n, [], true);
      expect((await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: linked.id })).rowActivityContext).toBe(linkedDatabase.rowActivityContext);
      await activity(linked.id, linkedDatabase.rowActivityContext, bb, 2n, ids.slice(10, 30));

      // CoreInit replaces the SDK even when support path and account are identical.
      // It must retire contexts without relying on React or asynchronous Drop.
      expect(await core.init(config)).toBe(0); expect((await call('GetUserProfile', UserProfilePBSchema)).id).toBe(user.id);
      expect((await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema)).workspaceId).toBe(workspace.workspaceId);
      const fresh = await call('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: linked.id }); expect(fresh.rowActivityContext).not.toBe(linkedDatabase.rowActivityContext);
      const old = { viewId: linked.id, contextId: linkedDatabase.rowActivityContext, activityId: bb, revision: 3n, rowIds: ids.slice(0, 1), closeActivity: false };
      expect((await raw('HyperUpdateRowActivity', HyperUpdateRowActivityPBSchema, old)).status).not.toBe(0);
      await activity(linked.id, linkedDatabase.rowActivityContext, bb, 4n, [], true);
      const final = crypto.randomUUID(); await activity(linked.id, fresh.rowActivityContext, final, 1n, []); await activity(linked.id, fresh.rowActivityContext, final, 2n, [], true);
    } finally { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); }
  }, 60_000);
});
