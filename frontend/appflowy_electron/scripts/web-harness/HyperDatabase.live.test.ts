import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fromBinary } from '@bufbuild/protobuf';
import { CoreProcess } from '../../src/main/core/process';
import { UserEventSignUp } from '@/backend/events/flowy-user';
import { FolderEventGetCurrentWorkspaceSetting } from '@/backend/events/flowy-folder';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { unwrap } from '@/backend/dispatch';
import { SubscribeObjectSchema } from '@shared/protobuf/flowy-notification/subject_pb';
import { hyperDatabaseBackend } from '@/features/hyper-database/HyperDatabaseBackend';
import { HyperDatabaseController } from '@/features/hyper-database/HyperDatabaseController';
import { seedHyperDatabaseSamples } from '@/features/hyper-database/HyperDatabaseSeed';

it('drives a real core through the Hyper controller and seeds four sample databases', async () => {
  const repo = path.resolve(process.cwd(), '../..');
  const support = process.env.HYPER_SMOKE_SUPPORT ?? path.join(repo, '.cache/hyper-views/live-support');
  await fs.mkdir(support, { recursive: true });
  const binary = process.env.APPFLOWY_CORE_BINARY ?? path.resolve(process.cwd(), '../rust-lib/target/debug/appflowy_core');
  const core = new CoreProcess(binary); const log: string[] = [];
  const backend = { ...hyperDatabaseBackend, subscribe: (listener: Parameters<typeof hyperDatabaseBackend.subscribe>[0]) => { const handle = (bytes: Uint8Array) => listener(fromBinary(SubscribeObjectSchema, bytes)); core.on('notification', handle); return () => core.off('notification', handle); } };
  vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload) } } });
  let controller: HyperDatabaseController | undefined;
  try {
    await core.start(bytes => log.push(bytes.toString()));
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: path.join(support, 'data_dev'), origin_app_path: path.join(support, 'data_dev'), device_id: 'hyper-foundation-smoke', platform: 'linux', authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '', base_web_domain: '', enable_sync_trace: false }, envs: {} })).toBe(0);
    unwrap(await UserEventSignUp({ email: 'anon@appflowy.io', name: 'Hyper sample user', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-foundation-smoke' }));
    const workspace = unwrap(await FolderEventGetCurrentWorkspaceSetting());
    const samples = await seedHyperDatabaseSamples(workspace.workspaceId, backend, 12);
    await fs.writeFile(path.join(repo, '.cache/hyper-views/sample-views.json'), JSON.stringify(samples, null, 2));
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
    await fs.writeFile(path.join(repo, '.cache/hyper-views/live-smoke.json'), JSON.stringify({ passed: true, binary, support, samples: samples.length, rows: 48, titleEdited: true, boardMove: true, calendarMove: true, rangePreserved: true }, null, 2));
  } finally { controller?.dispose(); await core.stop(); vi.unstubAllGlobals(); await fs.writeFile(path.join(repo, '.cache/hyper-views/live-core.log'), log.join('')); }
}, 240000);
