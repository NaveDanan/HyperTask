import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { expect, it, vi } from 'vitest';
import { CellIdPBSchema, CellPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { DatabasePBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { FieldType, RepeatedFieldPBSchema } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { CreateRowPayloadPBSchema } from '@shared/protobuf/hyper-database2/row_entities_pb';
import { RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/hyper-folder/workspace_pb';
import { UserProfilePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import { hyperBotsReadIdentity } from '../HyperBotsHub';
import { Status } from '../core/protocol';
import { HyperHubMirror } from './HyperHubMirror';
import { hyperHubEmptyState, hyperHubIndex, hyperHubOriginKey, type HyperHubInventory } from './HyperTaskHubStore';
import { record } from './HyperTaskHub.test-support';

it('writes the origin key, link and title atomically, then reconciles a lost acknowledgement by key across restarts and concurrent calls', async () => {
  const done = <D extends DescMessage>(schema: D, input: MessageInitShape<D>) => ({ status: Status.Ok, payload: toBinary(schema,create(schema,input)) });
  const view = { id:'board',layout:ViewLayoutPB.Board,name:'Hyper-Kanban',oneOfExtra:{case:'extra' as const,value:'{"hyper_general_kanban":true}'} };
  const rows: Record<string,string>[] = [];
  const request = vi.fn(async (op: string, bytes: Uint8Array) => {
    switch (op) {
      case 'GetUserProfile': return done(UserProfilePBSchema,{id:1n});
      case 'GetCurrentWorkspaceSetting': return done(WorkspaceLatestPBSchema,{workspaceId:'workspace'});
      case 'GetAllViews': return done(RepeatedViewPBSchema,{items:[view]});
      case 'GetView': return done(ViewPBSchema,view);
      case 'GetDatabase': return done(DatabasePBSchema,{id:'db',rows:rows.map((_,i)=>({id:String(i)}))});
      case 'GetFields': return done(RepeatedFieldPBSchema,{items:['Title','Source link','HyperTask Hub origin'].map(name=>({id:name,name,isPrimary:name==='Title',fieldType:FieldType.RichText}))});
      case 'CreateRow': rows.push(fromBinary(CreateRowPayloadPBSchema,bytes).data); throw Error('Lost ack');
      case 'GetCell': {
        const {rowId, fieldId} = fromBinary(CellIdPBSchema,bytes);
        return done(CellPBSchema,{data:new TextEncoder().encode(rows[+rowId][fieldId])});
      }
      default: throw Error(op);
    }
  });
  const account = (await hyperBotsReadIdentity(request))!.key;
  const open = () => new HyperHubMirror(request,account,'workspace'), signal = new AbortController().signal, check = vi.fn(async()=>{});
  const input = { ...await open().destination(signal), originKey:'scoped-origin', title:'Approved title',link:'https://source.invalid/project' };
  await expect(open().apply(input,signal,check)).rejects.toThrow();
  const results = await Promise.all([open().apply(input,signal,check),open().apply(input,signal,check)]);
  expect(results[0]).toEqual(results[1]); expect(results[0].rowId).toBe('0');
  expect(rows).toEqual([{Title:'Approved title','Source link':input.link,'HyperTask Hub origin':'scoped-origin'}]);
  expect(request.mock.calls.filter(([op]) => op === 'DeleteRows')).toHaveLength(0);
});
it('rebuilds non-Jira mirror joins by scoped key, including duplicates', () => {
  const d = hyperHubEmptyState(), a = record(), b = { ...record(), id:'other' };
  for (const r of [a,b]) { r.key = {kind:'newsletter-task', connectionId:'newsletter',projectId:'p',taskId:r.id}; delete r.jiraAlias; }
  const copies = [a,b,a].map((r,i)=>({...record(true),id:'copy'+i,originKey:hyperHubOriginKey(r),jiraAlias:undefined}));
  const batch = {records:[...copies,a,b]} as HyperHubInventory;
  d.cache.one = batch; hyperHubIndex(d);
  const first = {...d.ledger.mirrorActionIds};
  d.cache = {}; d.ledger.mirrorActionIds = {}; d.cache.two = structuredClone(batch); hyperHubIndex(d);
  expect(d.ledger.mirrorActionIds).toEqual(first);
  expect(first).toEqual({copy0:d.ledger.actionIds[a.id],copy1:d.ledger.actionIds[b.id],copy2:d.ledger.actionIds[a.id]});
});
