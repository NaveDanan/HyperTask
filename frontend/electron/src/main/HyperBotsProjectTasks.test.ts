import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, HYPER_BOTS_PROJECT_TOOLS, hyperBotsWithProjectTools } from '@shared/HyperBots';
import { RepeatedGroupPBSchema } from '@shared/protobuf/hyper-database2/group_pb';
import { DatabaseViewIdPBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { CreateViewPayloadPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/hyper-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/hyper-user/auth_pb';
import { AuthTypePB, RepeatedWorkspaceMemberPBSchema } from '@shared/protobuf/hyper-user/workspace_pb';
import { hyperBotsReadIdentity } from './HyperBotsHub';
import { HyperBotsProjectCore } from './HyperBotsProjectCore';
import { HyperBotsProjectTasks } from './HyperBotsProjectTasks';
import { hyperBotsProjectTools } from './HyperBotsProjectTools';
import { coreBinaryPath } from './core/binary';
import { CoreProcess } from './core/process';
import { Status } from './core/protocol';

it('adds project tools once to legacy Scout settings and retains future opt-outs', () => {
  const legacy = structuredClone(HYPER_BOTS_DEFAULT_SETTINGS);
  delete legacy.projectToolsVersion;
  const scout = legacy.bots.find(bot => bot.id === 'scout')!;
  scout.tools = ['outlook_list_events'];
  const migrated = hyperBotsWithProjectTools(legacy);
  expect(migrated.bots[0]?.tools).toEqual(['outlook_list_events', ...HYPER_BOTS_PROJECT_TOOLS]);
  expect(migrated.bots[1]).toEqual(legacy.bots[1]);
  migrated.bots[0]!.tools = ['outlook_list_events'];
  expect(hyperBotsWithProjectTools(migrated).bots[0]?.tools).toEqual(['outlook_list_events']);
});

const binary = coreBinaryPath(path.resolve(__dirname, '../..'), false);
const describeWithCore = fs.existsSync(binary) ? describe : describe.skip;

describeWithCore('native HyperTask task tools', () => {
  it('finds a project Kanban, creates and updates tasks, moves columns, and stores tagged coworkers', async () => {
    const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-bot-kanban-'));
    const core = new CoreProcess(binary);
    const request = core.request.bind(core);
    const deviceId = 'hyper-bot-kanban-test';
    const coworker = { name: 'Maya Jones', email: 'maya@hypertask.test' };
    const second = { name: 'Alex Smith', email: 'alex@hypertask.test' };
    const signal = new AbortController().signal;
    try {
      await core.start(() => {});
      expect(await core.init({
        root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support,
        device_id: deviceId, platform: process.platform === 'win32' ? 'windows' : process.platform, authenticator_type: 0,
        hypertask_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {},
      })).toBe(0);
      expect((await request('SignUp', toBinary(SignUpPayloadPBSchema, create(SignUpPayloadPBSchema, {
        email: coworker.email, name: coworker.name, password: 'Local!@123456', authType: AuthTypePB.Local, deviceId,
      })))).status).toBe(Status.Ok);
      const identity = await hyperBotsReadIdentity(request);
      expect(identity).not.toBeNull();
      const wire = new HyperBotsProjectCore(request, identity!.key, signal);
      const workspaceId = await wire.pin();
      const project = await wire.write('CreateView', ViewPBSchema, CreateViewPayloadPBSchema, {
        parentViewId: workspaceId, layout: ViewLayoutPB.Document, name: 'Release project',
      });
      const board = await wire.write('CreateView', ViewPBSchema, CreateViewPayloadPBSchema, {
        parentViewId: project.id, layout: ViewLayoutPB.Board, name: 'Delivery board',
      });
      const service = new HyperBotsProjectTasks((event, payload) => event === 'GetWorkspaceMembers'
        ? Promise.resolve({ status: Status.Ok, payload: toBinary(RepeatedWorkspaceMemberPBSchema, create(RepeatedWorkspaceMemberPBSchema, { items: [coworker, second] })) })
        : request(event, payload), identity!.key);
      const tools = hyperBotsProjectTools(service);
      const run = async (name: string, input: unknown) => {
        const tool = tools.find(tool => tool.name === name)!;
        const args = tool.parse(input);
        const binding = await tool.bind!(args, signal);
        return tool.run(args, signal, binding.fingerprint);
      };
      expect(await run('hypertask_list_task_views', { query: 'Release project' })).toEqual({
        views: [{ view: 'board', viewId: board.id, name: 'Delivery board', path: expect.stringMatching(/Release project \/ Delivery board$/) }],
      });
      expect(await run('hypertask_find_people', { query: coworker.email })).toEqual({ people: [coworker] });
      const created = await service.create({ view: 'board', viewId: board.id, title: 'Publish release', description: 'Ship by Friday', assignees: [coworker] }, signal);
      expect(created.task).toMatchObject({ title: 'Publish release', description: 'Ship by Friday', status: 'To Do', assignees: [coworker] });
      const rowId = created.task.rowId;
      const doing = await run('hypertask_update_task', { viewId: board.id, rowId, status: 'In progress', addAssignees: [second] });
      expect(doing).toMatchObject({ task: { rowId, title: 'Publish release', status: 'Doing', assignees: [coworker, second] } });
      const groups = await wire.read('GetGroups', RepeatedGroupPBSchema, DatabaseViewIdPBSchema, { value: board.id });
      const group = groups.items.find(group => group.rows.some(row => row.id === rowId));
      expect(group && !group.isDefault).toBe(true);
      await run('hypertask_update_task', { viewId: board.id, rowId, title: 'Release published', status: 'Done' });
      const done = await wire.read('GetGroups', RepeatedGroupPBSchema, DatabaseViewIdPBSchema, { value: board.id });
      expect(done.items.find(item => item.rows.some(row => row.id === rowId))?.groupId).not.toBe(group!.groupId);
      expect(await run('hypertask_search_tasks', { viewId: board.id, query: 'release published' })).toMatchObject({
        viewId: board.id, tasks: [{ rowId, title: 'Release published', status: 'Done' }],
      });

      const generalBinding = await service.bind({ view: 'general' }, signal);
      const [general, secondGeneral] = await Promise.all([
        service.create({ title: 'Follow up on feedback', assignees: [second] }, signal, generalBinding.fingerprint),
        service.create({ title: 'Send weekly update' }, signal, generalBinding.fingerprint),
      ]);
      expect(general.viewId).not.toBe(board.id);
      expect(secondGeneral.viewId).toBe(general.viewId);
      expect(general).toMatchObject({ view: 'general', task: { title: 'Follow up on feedback', status: 'To Do', assignees: [second] } });
      expect(await run('hypertask_search_tasks', { view: 'general' })).toMatchObject({ viewId: general.viewId, tasks: [general.task, secondGeneral.task] });
      expect(await run('hypertask_list_task_views', { view: 'general' })).toMatchObject({ views: [{ viewId: general.viewId }] });
      await expect(service.update({ viewId: general.viewId, rowId, status: 'Done' }, signal)).rejects.toThrow('no longer in the selected view');
      await expect(service.update({ viewId: board.id, rowId, status: 'Does not exist' }, signal)).rejects.toThrow('Use one of these statuses');

      const binding = await service.bind({ viewId: board.id, rowId }, signal);
      const switched = new HyperBotsProjectTasks(async (event, payload) => {
        const reply = await request(event, payload);
        if (event !== 'GetCurrentWorkspaceSetting') return reply;
        const workspace = fromBinary(WorkspaceLatestPBSchema, reply.payload);
        workspace.workspaceId = 'different-workspace';
        return { ...reply, payload: toBinary(WorkspaceLatestPBSchema, workspace) };
      }, identity!.key);
      await expect(switched.update({ viewId: board.id, rowId, title: 'Unexpected' }, signal, binding.fingerprint)).rejects.toThrow('destination changed');
      const persisted = await service.search({ viewId: board.id, rowId }, signal);
      expect(persisted.tasks[0]?.title).toBe('Release published');
    } finally {
      await core.stop();
      fs.rmSync(support, { recursive: true, force: true, maxRetries: 4 });
    }
  });
});
