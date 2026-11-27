import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { expect, it, vi } from 'vitest';
import { CellIdPBSchema, CellPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { DatabasePBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { FieldType, RepeatedFieldPBSchema } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/hyper-folder/workspace_pb';
import { UserProfilePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import { hyperBotsReadIdentity } from '../HyperBotsHub';
import { DateCellDataPBSchema } from '@shared/protobuf/hyper-database2/date_entities_pb';
import { FieldPBSchema } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { HyperBotsGanttTasks } from '../HyperBotsGanttTasks';
import { HyperBotsProjectTasks } from '../HyperBotsProjectTasks';
import { Status } from '../core/protocol';
import { DocumentTextPBSchema } from '@shared/protobuf/hyper-document/entities_pb';
import { HyperHubAccessLost } from './HyperTaskHubSync';
import { HyperHubPageSource, HyperHubProjectSource, hyperHubMirror } from './HyperHubProjectSource';
import { scope } from './HyperTaskHub.test-support';

it('requires the configured origin, context path and exact key for automatic mirror matching', () => {
  const base = 'https://jira.example/context';
  expect(hyperHubMirror('ENG-5', base + '/browse/ENG-5', base)).toBe(base + '/browse/ENG-5');
  for (const link of ['https://jira.example/browse/ENG-5', 'https://other/context/browse/ENG-5', base + '/browse/ENG-4', '']) {
    expect(hyperHubMirror('ENG-5', link, base)).toBeUndefined();
  }
});
it('pins to the workspace, reads both Jira text cells and emits the typed row target', async ({ onTestFinished }) => {
  const base = 'https://jira.example/context';
  const done = <D extends DescMessage>(schema: D, input: MessageInitShape<D>) => ({ status: Status.Ok, payload: toBinary(schema, create(schema, input)) });
  const request = vi.fn(async (event: string, payload: Uint8Array) => {
    switch (event) {
      case 'GetUserProfile': return done(UserProfilePBSchema, { id: 1n });
      case 'GetCurrentWorkspaceSetting': return done(WorkspaceLatestPBSchema, { workspaceId: 'workspace' });
      case 'GetAllViews': return done(RepeatedViewPBSchema, { items: [{ id: 'board', name: 'Kanban', layout: ViewLayoutPB.Board }] });
      case 'GetView': return done(ViewPBSchema, { id: 'board', name: 'Kanban', layout: ViewLayoutPB.Board });
      case 'GetDatabase': return done(DatabasePBSchema, { id: 'db', rows: [{ id: 'row' }] });
      case 'GetFields': return done(RepeatedFieldPBSchema, { items: ['Jira Key', 'Jira Link'].map(name => ({ id: name, name, fieldType: FieldType.RichText })) });
      case 'GetCell': return done(CellPBSchema, { data: new TextEncoder().encode(fromBinary(CellIdPBSchema, payload).fieldId === 'Jira Key' ? 'ENG-5' : base + '/browse/ENG-5') });
      default: throw Error(event);
    }
  });
  const search = vi.spyOn(HyperBotsProjectTasks.prototype, 'search').mockResolvedValue({ viewId: 'board', nextOffset: null,
    tasks: [{ rowId: 'row', title: 'Release', description: '', status: 'Doing', assignees: [] }] });
  onTestFinished(() => search.mockRestore());
  const source = new HyperHubProjectSource(request, 'db', 'board', 'Asia/Jerusalem', base);
  const accountId = (await hyperBotsReadIdentity(request))!.key;
  const bound = { ...scope, accountId, connectionId: source.connectionId };
  const batch = await source.read(bound, new AbortController().signal);
  expect(batch.records).toMatchObject([{ role: 'mirror', jiraAlias: base + '/browse/ENG-5', openTarget: {
    workspaceId: 'workspace', databaseId: 'db', viewId: 'board', rowId: 'row' } }]);
  expect(batch.completeness).toBe('complete');
  await expect(source.read({ ...bound, workspaceId: 'another' }, new AbortController().signal)).rejects.toThrow('workspace changed');
  expect(search).toHaveBeenCalledTimes(1);
});

it('reads selected page text only while the active workspace still contains its document view', async () => {
  let accessible = true;
  const done = <D extends DescMessage>(schema: D, input: MessageInitShape<D>) => ({ status: Status.Ok, payload: toBinary(schema, create(schema, input)) });
  const request = vi.fn(async (event: string) => {
    switch (event) {
      case 'GetUserProfile': return done(UserProfilePBSchema, { id: 1n });
      case 'GetCurrentWorkspaceSetting': return done(WorkspaceLatestPBSchema, { workspaceId: 'workspace' });
      case 'GetAllViews': return done(RepeatedViewPBSchema, { items: accessible ? [{ id: 'notes', name: 'Notes', layout: ViewLayoutPB.Document }] : [] });
      case 'GetDocumentText': return done(DocumentTextPBSchema, { text: 'Z'.repeat(2000) });
      default: throw Error(event);
    }
  });
  const source = new HyperHubPageSource(request, 'notes', 'meeting');
  const signal = new AbortController().signal;
  const bound = { ...scope, accountId: (await hyperBotsReadIdentity(request))!.key, connectionId: source.connectionId };
  const batch = await source.read(bound, signal);
  expect(batch.records).toEqual([]);
  const item = batch.evidence![0];
  expect(item).toMatchObject({ openTarget: { viewId: 'notes', workspaceId: 'workspace' }, linkedMeetingId: 'meeting' });
  expect(item.briefExcerpt).toHaveLength(1024);
  accessible = false;
  await expect(source.check(item, signal)).rejects.toBeInstanceOf(HyperHubAccessLost);
  expect(request.mock.calls.filter(([event]) => event === 'GetDocumentText')).toHaveLength(1);
});

it('pairs explicit native Gantt fields, preserving timed endpoints, and leaves independent start and due cells as markers', async () => {
  const first = 1800000000n, last = first + 7200n;
  const read = vi.fn(async (_event, _output, _input, args) => ({data:toBinary(DateCellDataPBSchema,create(DateCellDataPBSchema,
    {oneOfTimestamp:{case:'timestamp',value:args.fieldId==='start'?first:last},includeTime:true}))}));
  const fields = ['start','due'].map(id=>create(FieldPBSchema,{id,name:id,fieldType:FieldType.DateTime}));
  const schedule = (config:object) => new HyperBotsGanttTasks({read} as never,
    create(ViewPBSchema,{id:'view',oneOfExtra:{case:'extra',value:JSON.stringify({hyper_gantt:config})}}),fields,['row']).sourceSchedule('row','UTC');
  const explicit = await schedule({start_field_id:'start',end_field_id:'due'});
  expect(explicit.interval).toEqual({start:Number(first)*1000,end:Number(last)*1000});
  const inferred = await schedule({});
  expect(inferred.interval).toBeUndefined();
  expect(inferred.planned).toEqual(explicit.planned); expect(inferred.due).toEqual(explicit.due);
});
