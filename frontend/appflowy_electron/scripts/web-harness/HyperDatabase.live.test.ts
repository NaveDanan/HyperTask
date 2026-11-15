import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fromBinary } from '@bufbuild/protobuf';
import { CoreProcess } from '../../src/main/core/process';
import { UserEventSignUp } from '@/backend/events/flowy-user';
import { FolderEventCreateView, FolderEventGetCurrentWorkspaceSetting, FolderEventGetView, FolderEventUpdateView } from '@/backend/events/flowy-folder';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { unwrap } from '@/backend/dispatch';
import { SubscribeObjectSchema } from '@shared/protobuf/flowy-notification/subject_pb';
import { hyperDatabaseBackend } from '@/features/hyper-database/HyperDatabaseBackend';
import { HyperDatabaseController, hyperCoreLayout, hyperLayout } from '@/features/hyper-database/HyperDatabaseController';
import { seedHyperDatabaseSamples } from '@/features/hyper-database/HyperDatabaseSeed';
import { ViewBackendService } from '@/features/view/view-service';
import { ViewLayoutPB, ViewSectionPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { createSpaceStore } from '@/features/sidebar/stores/space-store';
import { createViewBloc } from '@/features/sidebar/stores/view-bloc';

it('creates page-menu and linked database views on a fresh core and drives four seeded samples', async () => {
  const repo = path.resolve(process.cwd(), '../..');
  const artifacts = path.join(repo, '.cache/hyper-views');
  await fs.mkdir(artifacts, { recursive: true });
  const support = process.env.HYPER_SMOKE_SUPPORT ?? await fs.mkdtemp(path.join(artifacts, 'live-support-'));
  await fs.mkdir(support, { recursive: true });
  // Never silently exercise a previously seeded workspace (or remove somebody else's data).
  expect(await fs.readdir(support)).toEqual([]);
  const binary = process.env.APPFLOWY_CORE_BINARY ?? path.resolve(process.cwd(), '../rust-lib/target/debug/appflowy_core');
  const core = new CoreProcess(binary); const log: string[] = [];
  const backend = { ...hyperDatabaseBackend, subscribe: (listener: Parameters<typeof hyperDatabaseBackend.subscribe>[0]) => { const handle = (bytes: Uint8Array) => listener(fromBinary(SubscribeObjectSchema, bytes)); core.on('notification', handle); return () => core.off('notification', handle); } };
  const replies: Array<{ event: string; bytes: number }> = [];
  vi.stubGlobal('window', { appflowy: { core: { request: async (event: string, payload: Uint8Array) => {
    const reply = await core.request(event, payload);
    if (['CreateView', 'UpdateView', 'GetView'].includes(event)) replies.push({ event, bytes: reply.payload.length });
    return reply;
  } } } });
  let controller: HyperDatabaseController | undefined;
  try {
    await core.start(bytes => log.push(bytes.toString()));
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: path.join(support, 'data_dev'), origin_app_path: path.join(support, 'data_dev'), device_id: 'hyper-foundation-smoke', platform: 'linux', authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '', base_web_domain: '', enable_sync_trace: false }, envs: {} })).toBe(0);
    unwrap(await UserEventSignUp({ email: 'anon@appflowy.io', name: 'Hyper sample user', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-foundation-smoke' }));
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
