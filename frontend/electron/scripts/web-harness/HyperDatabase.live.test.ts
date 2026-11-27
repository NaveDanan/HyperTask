import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fromBinary } from '@bufbuild/protobuf';
import { addDays } from 'date-fns';
import { CoreProcess } from '../../src/main/core/process';
import { HyperBotsTools } from '../../src/main/HyperBotsConnectors';
import { hyperBotsReadIdentity } from '../../src/main/HyperBotsHub';
import { HyperBotsProjectTasks } from '../../src/main/HyperBotsProjectTasks';
import { hyperBotsProjectTools } from '../../src/main/HyperBotsProjectTools';
import { HyperBotsRuntime } from '../../src/main/HyperBotsRuntime';
import { HyperBotsStore } from '../../src/main/HyperBotsStore';
import { hyperCoreWithGeneralKanban } from '../../src/main/HyperGeneralKanbanCore';
import type { HyperBotsProjectToolName } from '@shared/HyperBots';
import { hyperTaskViewKind } from '@shared/HyperTaskView';
import { UserEventSignUp, UserEventInitUser } from '@/backend/events/hyper-user';
import { FolderEventCreateView, FolderEventGetAllViews, FolderEventGetCurrentWorkspaceSetting, FolderEventGetView, FolderEventUpdateView } from '@/backend/events/hyper-folder';
import { AuthTypePB } from '@shared/protobuf/hyper-user/workspace_pb';
import { unwrap } from '@/backend/dispatch';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { SubscribeObjectSchema } from '@shared/protobuf/hyper-notification/subject_pb';
import { hyperDatabaseBackend } from '@/features/hyper-database/HyperDatabaseBackend';
import { HyperDatabaseController, hyperCoreLayout, hyperLayout } from '@/features/hyper-database/HyperDatabaseController';
import { seedHyperDatabaseSamples } from '@/features/hyper-database/HyperDatabaseSeed';
import { ViewBackendService } from '@/features/view/view-service';
import { ViewLayoutPB, ViewSectionPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { createSpaceStore } from '@/features/sidebar/stores/space-store';
import { createViewBloc } from '@/features/sidebar/stores/view-bloc';
import { hyperGanttMap, hyperGanttReadConfig } from '@/features/hyper-database/views/gantt/HyperGanttMapping';

it('uses bot tools to persist tasks in General Kanban, project Kanban, and linked and standalone Gantt', async () => {
  const support = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-bot-gantt-'));
  const binary = process.env.HYPERTASK_CORE_BINARY ?? path.resolve(process.cwd(), '../rust-lib/target/debug/hypertask_core');
  const core = new CoreProcess(binary);
  const request = hyperCoreWithGeneralKanban(core.request.bind(core));
  const controllers: HyperDatabaseController[] = [];
  let runtime: HyperBotsRuntime | undefined;
  vi.stubGlobal('window', { hypertask: { core: { request } } });
  const backend = { ...hyperDatabaseBackend, subscribe: (listener: Parameters<typeof hyperDatabaseBackend.subscribe>[0]) => {
    const handle = (bytes: Uint8Array) => listener(fromBinary(SubscribeObjectSchema, bytes));
    core.on('notification', handle);
    return () => core.off('notification', handle);
  } };
  const open = async (view: ViewPB) => {
    const controller = new HyperDatabaseController(view.id, backend);
    controllers.push(controller);
    await controller.open();
    expect(controller.state.status).toBe('ready');
    return controller;
  };

  try {
    await core.start(() => {});
    const data = path.join(support, 'data');
    expect(await core.init({
      root: support, app_version: '0.11.4', custom_app_path: data, origin_app_path: data, device_id: 'hyper-bot-gantt',
      platform: process.platform === 'win32' ? 'windows' : process.platform, authenticator_type: 0,
      hypertask_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '', base_web_domain: '', enable_sync_trace: false }, envs: {},
    })).toBe(0);
    unwrap(await UserEventSignUp({ email: 'gantt@hypertask.test', name: 'Gantt test owner', password: 'Local!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-bot-gantt' }));
    const { workspaceId } = unwrap(await FolderEventGetCurrentWorkspaceSetting());
    const identity = await hyperBotsReadIdentity(request);
    expect(identity).not.toBeNull();
    const tools = hyperBotsProjectTools(new HyperBotsProjectTasks(request, identity!.key));
    const signal = new AbortController().signal;
    async function call(name: HyperBotsProjectToolName, input: unknown) {
      const tool = tools.find(candidate => candidate.name === name)!;
      const args = tool.parse(input);
      const context = await tool.bind!(args, signal);
      try {
        return await tool.run(args, signal, context.fingerprint) as {
          viewId: string;
          task: { rowId: string };
          tasks: { rowId: string }[];
        };
      } catch (error) {
        throw new Error(`${name} for ${context.destination}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
    const assignees = [{ name: 'Maya Levy', email: 'maya@hypertask.test' }];
    const openHomeBoard = () => ViewBackendService.createView({
      parentViewId: workspaceId, name: 'Hyper-Kanban', layoutType: ViewLayoutPB.Board, extra: '{"hyper_general_kanban":true}',
    }).then(unwrap);
    const [general, homeBoard, secondHomeBoard] = await Promise.all([
      call('hypertask_create_task', { title: 'Check release notes', assignees, status: 'To Do' }),
      openHomeBoard(),
      openHomeBoard(),
    ]);
    expect(general.task).toMatchObject({ title: 'Check release notes', assignees });
    expect(general.viewId).toBe(homeBoard.id);
    expect(secondHomeBoard.id).toBe(homeBoard.id);
    expect(unwrap(await FolderEventGetAllViews()).items.filter(view => hyperTaskViewKind(view) === 'general')).toHaveLength(1);
    expect(hyperTaskViewKind(unwrap(await FolderEventGetView({ value: general.viewId })))).toBe('general');
    await expect(call('hypertask_update_task', { rowId: general.task.rowId, status: 'Doing', description: 'Proofread the draft' }))
      .resolves.toMatchObject({ task: { description: 'Proofread the draft' } });
    await expect(call('hypertask_search_tasks', { query: 'release notes' }))
      .resolves.toMatchObject({ viewId: general.viewId, tasks: [{ rowId: general.task.rowId, assignees, description: 'Proofread the draft', status: expect.stringMatching(/doing|in progress/i) }] });

    const board = await open(unwrap(await FolderEventCreateView({ parentViewId: workspaceId, name: 'Release board', layout: ViewLayoutPB.Board })));
    const gantt = await open(await board.addView('gantt', 'Release timeline'));
    expect(gantt.state.databaseId).toBe(board.state.databaseId);
    const view = gantt.state.view!;
    const start = await gantt.createField('Kickoff', FieldType.DateTime);
    const end = await gantt.createField('Handoff', FieldType.DateTime);
    await gantt.updateViewExtra({ hyper_gantt: { start_field_id: start.id, end_field_id: end.id, scale: 'week' } });
    const target = { view: 'gantt', viewId: gantt.viewId };
    await expect(call('hypertask_list_task_views', { query: 'Release' })).resolves.toMatchObject({
      views: expect.arrayContaining([{ viewId: gantt.viewId, view: 'gantt', name: 'Release timeline', path: expect.stringContaining('Release timeline') }]),
    });
    await expect(call('hypertask_create_task', { ...target, title: 'Invalid schedule', startDate: '2026-03-09', endDate: '2026-03-05' })).rejects.toThrow('End date');
    const project = await call('hypertask_create_task', { view: 'board', viewId: board.viewId, title: 'Publish release', status: 'Doing', assignees });
    const id = project.task.rowId;
    expect(project.task).toMatchObject({ title: 'Publish release', status: expect.stringMatching(/doing|in progress/i), assignees });
    await expect(call('hypertask_update_task', { ...target, rowId: id, startDate: '2026-03-02', endDate: '2026-03-05', status: 'Done' }))
      .resolves.toMatchObject({ task: { rowId: id, status: 'Done', startDate: '2026-03-02', endDate: '2026-03-05' } });
    const title = gantt.state.fields.find(field => field.isPrimary)!.id;
    const reopened = await open(view);
    await reopened.loadRows([id], [title, start.id, end.id]);
    const mapped = hyperGanttMap(reopened.state, hyperGanttReadConfig(reopened.state.view!, reopened.state));
    expect(mapped.tasks.get(id)?.event).toMatchObject({
      title: 'Publish release', start: new Date(2026, 2, 2), end: addDays(new Date(2026, 2, 5), 1), allDay: true,
    });
    await board.refresh();
    await board.loadRows([id], [title]);
    expect(board.state.cells[id]?.[title]?.display).toBe('Publish release');

    await expect(call('hypertask_update_task', { ...target, rowId: id, endDate: '2026-03-06' }))
      .resolves.toMatchObject({ task: { startDate: '2026-03-02', endDate: '2026-03-06' } });
    await expect(call('hypertask_update_task', { ...target, rowId: id, clearSchedule: true }))
      .resolves.toMatchObject({ task: { startDate: null, endDate: null } });

    const onlyGantt = await open(unwrap(await ViewBackendService.createView({
      parentViewId: workspaceId, name: 'Blank timeline', layoutType: ViewLayoutPB.Grid, hyperLayout: 'gantt', openAfterCreate: false,
    })));
    expect(onlyGantt.state.fields.some(field => field.type === FieldType.DateTime)).toBe(false);
    const blank = { view: 'gantt', viewId: onlyGantt.viewId };
    const unscheduled = await call('hypertask_create_task', { ...blank, title: 'Review release plan' });
    expect(unscheduled.task).toMatchObject({ title: 'Review release plan', startDate: null, endDate: null });
    const blankReopened = await open(onlyGantt.state.view!);
    const blankConfig = hyperGanttReadConfig(blankReopened.state.view!, blankReopened.state);
    expect(blankConfig.start_field_id).toBeTruthy();
    expect(blankReopened.state.rowIds).toContain(unscheduled.task.rowId);
    const milestone = await call('hypertask_create_task', { ...blank, title: 'Release milestone', startDate: '2026-03-08', status: 'Doing', assignees });
    expect(milestone.task).toMatchObject({ startDate: '2026-03-08', endDate: '2026-03-08', status: 'Doing', assignees });
    await expect(call('hypertask_update_task', { ...blank, rowId: milestone.task.rowId, startDate: '2026-03-11', status: 'Done' }))
      .resolves.toMatchObject({ task: { startDate: '2026-03-11', endDate: '2026-03-11', status: 'Done' } });

    // Drive a full chat turn with a deterministic model and the same real tools and core.
    const store = new HyperBotsStore(path.join(support, 'hyper-bots.json'));
    const propose = (name: HyperBotsProjectToolName, args: unknown) => ({
      finishReason: 'tool_calls',
      message: { role: 'assistant' as const, content: null, tool_calls: [{ id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] },
    });
    runtime = new HyperBotsRuntime({
      store, tools: new HyperBotsTools(tools), defaultModel: async () => 'test-model',
      engine: { async complete({ messages }) {
        const last = messages.at(-1);
        if (last?.role !== 'tool') return propose('hypertask_create_task', { ...target, title: 'QA review', status: 'To Do' });
        const result = JSON.parse(last.content);
        if (result.source === 'hypertask_create_task') {
          return propose('hypertask_update_task', { ...target, rowId: result.untrusted_data.task.rowId, status: 'Doing', startDate: '2026-03-12', endDate: '2026-03-14' });
        }
        return { finishReason: 'stop', message: { role: 'assistant', content: 'QA review scheduled.' } };
      } },
    });
    await runtime.post({ roomId: 'dm-scout', clientMessageId: randomUUID(), text: 'Create a QA review task on the Release timeline, start it, and schedule it for March 12 to 14.' });
    await runtime.idle();
    const pending = store.listApprovals({ status: ['pending'] });
    expect(pending).toHaveLength(1);
    await expect(call('hypertask_search_tasks', { ...target, query: 'QA review' })).resolves.toMatchObject({ tasks: [] });
    runtime.decide(pending[0].id, true);
    await runtime.idle();
    expect(store.listApprovals().map(item => [item.tool, item.status])).toEqual([
      ['hypertask_create_task', 'done'], ['hypertask_update_task', 'done'],
    ]);
    await expect(call('hypertask_search_tasks', { ...target, query: 'QA review' })).resolves.toMatchObject({
      tasks: [{ title: 'QA review', status: 'Doing', startDate: '2026-03-12', endDate: '2026-03-14' }],
    });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(JSON.stringify(error), { cause: error });
  } finally {
    await runtime?.stop();
    for (const controller of controllers) controller.dispose();
    await core.stop();
    vi.unstubAllGlobals();
    await fs.rm(support, { recursive: true, force: true, maxRetries: 4 });
  }
});

it('creates page-menu and linked database views on a fresh core and drives four seeded samples', async () => {
  const repo = path.resolve(process.cwd(), '../..');
  const artifacts = path.join(repo, '.cache/hyper-views');
  await fs.mkdir(artifacts, { recursive: true });
  const support = process.env.HYPER_SMOKE_SUPPORT ?? await fs.mkdtemp(path.join(artifacts, 'live-support-'));
  await fs.mkdir(support, { recursive: true });
  // Never silently exercise a previously seeded workspace (or remove somebody else's data).
  expect(await fs.readdir(support)).toEqual([]);
  const binary = process.env.HYPERTASK_CORE_BINARY ?? path.resolve(process.cwd(), '../rust-lib/target/debug/hypertask_core');
  const core = new CoreProcess(binary); const log: string[] = [];
  const backend = { ...hyperDatabaseBackend, subscribe: (listener: Parameters<typeof hyperDatabaseBackend.subscribe>[0]) => { const handle = (bytes: Uint8Array) => listener(fromBinary(SubscribeObjectSchema, bytes)); core.on('notification', handle); return () => core.off('notification', handle); } };
  const replies: Array<{ event: string; bytes: number }> = [];
  vi.stubGlobal('window', { hypertask: { core: { request: async (event: string, payload: Uint8Array) => {
    const reply = await core.request(event, payload);
    if (['CreateView', 'UpdateView', 'GetView'].includes(event)) replies.push({ event, bytes: reply.payload.length });
    return reply;
  } } } });
  let controller: HyperDatabaseController | undefined;
  try {
    await core.start(bytes => log.push(bytes.toString()));
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: path.join(support, 'data_dev'), origin_app_path: path.join(support, 'data_dev'), device_id: 'hyper-foundation-smoke', platform: 'linux', authenticator_type: 0, hypertask_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '', base_web_domain: '', enable_sync_trace: false }, envs: {} })).toBe(0);
    unwrap(await UserEventSignUp({ email: 'anon@hypertask.io', name: 'Hyper sample user', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-foundation-smoke' }));
    const workspace = unwrap(await FolderEventGetCurrentWorkspaceSetting());
    const layouts = ['grid', 'board', 'calendar', 'gantt'] as const;
    // The CreateView handler returns ViewPB for every layout, including extra and database_id.
    const wireGrid = unwrap(await FolderEventCreateView({ parentViewId: workspace.workspaceId, name: 'Wire Grid', layout: ViewLayoutPB.Grid }));
    expect(wireGrid.id).not.toBe('');
    const wireDatabaseId = unwrap(await backend.DatabaseEventGetDatabaseId({ value: wireGrid.id })).value;
    for (const linked of [false, true]) {
      for (const layout of layouts) {
        const view = unwrap(await FolderEventCreateView({ parentViewId: linked ? wireGrid.id : workspace.workspaceId,
          name: `Wire ${layout}`, layout: hyperCoreLayout(layout), meta: linked ? { database_id: wireDatabaseId } : {},
          ...(layout === 'gantt' ? { oneOfExtra: { case: 'extra', value: '{"hyper_layout":"gantt"}' } as const } : {}),
        }));
        expect(view.id).not.toBe('');
        expect(hyperLayout(view)).toBe(layout);
        const databaseId = unwrap(await backend.DatabaseEventGetDatabaseId({ value: view.id })).value;
        expect(databaseId).not.toBe('');
        if (linked) expect(databaseId).toBe(wireDatabaseId);
        // UpdateView is an acknowledgement for all layouts, even without extra.
        expect(unwrap(await FolderEventUpdateView({ viewId: view.id, oneOfName: { case: 'name', value: 'Wire renamed' } }))).toBeUndefined();
        expect(unwrap(await FolderEventGetView({ value: view.id })).name).toBe('Wire renamed');
      }
    }

    const parent = unwrap(await ViewBackendService.createView({ parentViewId: workspace.workspaceId, name: 'Page-menu smoke', layoutType: ViewLayoutPB.Document }));
    const space = createSpaceStore();
    space.store.setState({ currentSpace: parent });
    const nested = createViewBloc(parent);
    async function checkView(view: ViewPB, layout: typeof layouts[number]) {
      expect(view.id).not.toBe('');
      expect(hyperLayout(view)).toBe(layout);
      expect(hyperLayout(unwrap(await backend.views.getView(view.id)))).toBe(layout);
      const opened = new HyperDatabaseController(view.id, backend);
      try { await opened.open(); expect(opened.state.status).toBe('ready'); expect(opened.state.databaseId).not.toBe(''); }
      finally { opened.dispose(); }
      expect(unwrap(await FolderEventGetCurrentWorkspaceSetting()).oneOfLatestView.value?.id).toBe(view.id);
    }
    try {
      for (const layout of layouts) {
        const productLayout = layout === 'gantt' ? 'gantt' : undefined;
        // SidebarSpace's add-page menu and ViewItem's nested add-page menu use these actions.
        await space.actions.createPage({ name: '', layout: hyperCoreLayout(layout), hyperLayout: productLayout, index: 0, openAfterCreate: true });
        const page = space.store.getState().lastCreatedPage!;
        await checkView(page, layout);
        await nested.createView('Untitled', hyperCoreLayout(layout), { hyperLayout: productLayout, openAfterCreated: true, section: ViewSectionPB.Public });
        await checkView(nested.store.getState().lastCreatedView!, layout);
      }
    } finally { nested.dispose(); }

    const samples = await seedHyperDatabaseSamples(workspace.workspaceId, backend, 12);
    await fs.writeFile(path.join(repo, '.cache/hyper-views/sample-views.json'), JSON.stringify(samples, null, 2));
    const grid = samples.find(s => s.layout === 'grid')!;
    controller = new HyperDatabaseController(grid.viewId, backend); await controller.open();
    for (const layout of layouts) {
      // HyperDatabasePage's "+" menu opens the ViewPB returned by addView.
      const view = await controller.addView(layout, `Linked ${layout}`);
      expect(view.id).not.toBe(''); expect(hyperLayout(view)).toBe(layout);
      const linked = new HyperDatabaseController(view.id, backend);
      try {
        await linked.open(); expect(linked.state.status).toBe('ready');
        expect(linked.state.databaseId).toBe(grid.databaseId);
        expect(linked.state.rowIds).toEqual(grid.rowIds);
        expect(hyperLayout(linked.state.view!)).toBe(layout);
      } finally { linked.dispose(); }
    }
    // Also assert that the seed-created linked Gantt was persisted and remains linked.
    const seededGantt = controller.state.views.find(v => v.name === 'Gantt')!;
    expect(hyperLayout(seededGantt)).toBe('gantt');
    expect(unwrap(await backend.DatabaseEventGetDatabaseId({ value: seededGantt.id })).value).toBe(grid.databaseId);
    controller.dispose();
    const board = samples.find(s => s.layout === 'board')!; controller = new HyperDatabaseController(board.viewId, backend); await controller.open();
    const row = board.rowIds[0]; await controller.loadRows([row]);
    expect(controller.state.cells[row][board.fields.title].display).toBe('Define launch scope');
    await controller.updateCell(row, board.fields.title, { kind: 'text', text: 'Live smoke task updated' });
    expect(controller.state.cells[row][board.fields.title].display).toBe('Live smoke task updated');
    const before = controller.state.groups.find(g => g.rows.some(r => r.id === row))!;
    const target = controller.state.groups.find(g => !g.isDefault && g.groupId !== before.groupId)!;
    await controller.moveRowBetweenGroups(row, before.groupId, target.groupId);
    expect(controller.state.groups.find(g => g.groupId === target.groupId)?.rows.some(r => r.id === row)).toBe(true);
    controller.dispose();
    const calendar = samples.find(s => s.layout === 'calendar')!; controller = new HyperDatabaseController(calendar.viewId, backend); await controller.open();
    const events = await controller.getCalendarEvents(0n, 9999999999n); expect(events).toHaveLength(12);
    const event = events[0]; const moved = event.timestamp + 86400n;
    await controller.moveCalendarEvent(event.rowId, event.dateFieldId, moved);
    const after = (await controller.getCalendarEvents(0n, 9999999999n)).find(e => e.rowId === event.rowId)!;
    expect(after.timestamp).toBe(moved); expect(after.endTimestamp).toBe(event.endTimestamp! + 86400n);
    await fs.writeFile(path.join(repo, '.cache/hyper-views/live-smoke.json'), JSON.stringify({ passed: true, binary, support, samples: samples.length, rows: 48, pageMenuLayouts: layouts, nestedPageMenuLayouts: layouts, linkedLayouts: layouts, ganttCreated: true, titleEdited: true, boardMove: true, calendarMove: true, rangePreserved: true }, null, 2));
  } finally { controller?.dispose(); await core.stop(); vi.unstubAllGlobals(); await fs.writeFile(path.join(artifacts, 'live-core.log'), log.join('')); await fs.writeFile(path.join(artifacts, 'live-view-replies.json'), JSON.stringify(replies, null, 2)); }
}, 240000);


it('retains saved checklist cells on the first controller open after native restarts', async () => {
  const artifacts = path.resolve(process.cwd(), '../../.cache/hyper-views');
  await fs.mkdir(artifacts, { recursive: true });
  const support = await fs.mkdtemp(path.join(artifacts, 'cold-open-support-'));
  const binary = process.env.HYPERTASK_CORE_BINARY ?? path.resolve(process.cwd(), '../rust-lib/target/debug/hypertask_core');
  const config = { root: support, app_version: '0.11.4', custom_app_path: path.join(support, 'data_dev'), origin_app_path: path.join(support, 'data_dev'), device_id: 'hyper-cold-open-smoke', platform: 'linux', authenticator_type: 0, hypertask_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '', base_web_domain: '', enable_sync_trace: false }, envs: {} };
  let core = new CoreProcess(binary), controller: HyperDatabaseController | undefined;
  const log: string[] = [], rounds: Array<{ round: number; completed: boolean }> = [];
  const backend = { ...hyperDatabaseBackend, subscribe: (listener: Parameters<typeof hyperDatabaseBackend.subscribe>[0]) => {
    const process = core;
    const handle = (bytes: Uint8Array) => listener(fromBinary(SubscribeObjectSchema, bytes));
    process.on('notification', handle); return () => process.off('notification', handle);
  } };
  vi.stubGlobal('window', { hypertask: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload) } } });
  async function start() { await core.start(bytes => log.push(bytes.toString())); expect(await core.init(config)).toBe(0); }
  try {
    await start();
    unwrap(await UserEventSignUp({ email: 'anon@hypertask.io', name: 'Hyper cold-open proof', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-cold-open-smoke' }));
    const workspace = unwrap(await FolderEventGetCurrentWorkspaceSetting());
    const view = unwrap(await FolderEventCreateView({ parentViewId: workspace.workspaceId, name: 'Hyper cold-open checklist', layout: ViewLayoutPB.Grid }));
    controller = new HyperDatabaseController(view.id, backend); await controller.open();
    const rowId = controller.state.rowIds[0];
    const field = await controller.createField('Hyper checklist', FieldType.Checklist);
    await controller.updateCell(rowId, field.id, { kind: 'checklist', insert: [{ name: 'Hyper persisted completion' }] });
    const seeded = await controller.loadCell(rowId, field.id);
    expect(seeded?.kind).toBe('checklist');
    if (seeded?.kind !== 'checklist') throw new Error('Checklist fixture could not be loaded');
    const itemId = seeded.items[0].id;
    await controller.setChecklistItemCompleted(rowId, field.id, itemId, true);
    controller.dispose(); controller = undefined; await core.stop();
    for (let round = 0; round < 4; round++) {
      core = new CoreProcess(binary); await start(); unwrap(await UserEventInitUser());
      // No database or field read may prewarm the native editor before open().
      controller = new HyperDatabaseController(view.id, backend); await controller.open();
      expect(controller.state.status).toBe('ready');
      const cell = await controller.loadCell(rowId, field.id);
      expect(cell).toMatchObject({ kind: 'checklist', items: [{ id: itemId, completed: true }], progress: 1 });
      rounds.push({ round, completed: true });
      controller.dispose(); controller = undefined; await core.stop();
    }
  } finally {
    controller?.dispose(); await core.stop(); vi.unstubAllGlobals();
    await fs.writeFile(path.join(artifacts, 'cold-open-core.log'), log.join(''));
    await fs.writeFile(path.join(artifacts, 'cold-open-rounds.json'), JSON.stringify({ binary, support, rounds }, null, 2));
  }
}, 120000);
