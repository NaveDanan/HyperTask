import { AFRolePB, AuthTypePB, WorkspaceTypePB, UserWorkspaceIdPBSchema } from '@shared/protobuf/hyper-user/workspace_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import { AFAccessLevelPB, SharedViewSectionPB, GetSharedViewSectionResponsePBSchema,
  RepeatedSharedUserPBSchema, GetSharedUsersPayloadPBSchema, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { hyperIsGeneralKanban } from '@shared/HyperTaskView';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { CreateFieldPayloadPBSchema, FieldPBSchema, FieldType, GetFieldPayloadPBSchema, RepeatedFieldPBSchema } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { CellIdPBSchema, CellPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { CreateRowPayloadPBSchema, RowMetaPBSchema } from '@shared/protobuf/hyper-database2/row_entities_pb';
import { OrderObjectPositionTypePB } from '@shared/protobuf/hyper-database2/position_entities_pb';
import { HyperBotsProjectCore, type HyperBotsProjectRequest } from '../HyperBotsProjectCore';

const queues = new Map<string, Promise<unknown>>();
export class HyperHubMirror {
  constructor(private readonly request: HyperBotsProjectRequest, private readonly account: string, private readonly workspace: string) {}
  private async writable(core: HyperBotsProjectCore, view?: ViewPB) {
    const user = await core.read('GetUserProfile', UserProfilePBSchema);
    if (user.userAuthType === AuthTypePB.Local || user.workspaceType === WorkspaceTypePB.LocalW) return;
    if (view?.oneOfCreatedBy.value === user.id) return;
    const workspace = await core.read('GetUserWorkspace', UserWorkspacePBSchema, UserWorkspaceIdPBSchema, { workspaceId: this.workspace });
    if (workspace.workspaceId !== this.workspace) throw new Error('Workspace changed.');
    const member = workspace.oneOfRole.case === 'role' && workspace.oneOfRole.value !== AFRolePB.Guest;
    if (member && (!view || (await core.read('GetSharedViewSection', GetSharedViewSectionResponsePBSchema,
      ViewIdPBSchema, { value: view.id })).section === SharedViewSectionPB.PublicSection)) return;
    if (view && user.email) {
      const users = await core.read('GetSharedUsers', RepeatedSharedUserPBSchema, GetSharedUsersPayloadPBSchema, { viewId: view.id });
      if (users.items.some(u => u.email === user.email && [AFAccessLevelPB.FullAccess, AFAccessLevelPB.ReadAndWrite].includes(u.accessLevel))) return;
    }
    throw new Error('Board write access denied.');
  }
  private async board(signal: AbortSignal, create: boolean) {
    const core = new HyperBotsProjectCore(this.request, this.account, signal);
    if (await core.pin() !== this.workspace) throw new Error('Workspace changed.');
    const boards = await core.read('GetAllViews', RepeatedViewPBSchema);
    const board = boards.items.find(v => v.layout === ViewLayoutPB.Board && hyperIsGeneralKanban(v));
    if (!board) await this.writable(core);
    const view = board ? await core.read('GetView', ViewPBSchema, ViewIdPBSchema, { value: board.id }) :
      create ? await core.write('CreateView', ViewPBSchema, CreateViewPayloadPBSchema, { parentViewId: this.workspace, layout: ViewLayoutPB.Board,
        name: 'Hyper-Kanban', oneOfExtra: { case: 'extra', value: JSON.stringify({ hyper_general_kanban: true }) } }) : undefined;
    if (view && (!hyperIsGeneralKanban(view) || view.oneOfIsLocked.value)) throw new Error('Board is unavailable.');
    if (view) await this.writable(core, view);
    await core.pin();
    return { core, view };
  }
  async destination(signal: AbortSignal) {
    const { view } = await this.board(signal, false);
    return { boardId: view?.id, destination: view?.name || 'Hyper-Kanban', audience: this.workspace };
  }
  apply(input: { boardId?: string; destination: string; title: string; link: string; originKey: string }, signal: AbortSignal, check: () => Promise<void>) {
    const key = JSON.stringify([this.account, this.workspace]);
    const work = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await check();
      const { core, view } = await this.board(signal, true);
      if (!view || input.boardId && input.boardId !== view.id || (view.name || 'Hyper-Kanban') !== input.destination) throw new Error('Board changed.');
      const viewId = view.id;
      const db = await core.read('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: viewId });
      const { items } = await core.read('GetFields', RepeatedFieldPBSchema, GetFieldPayloadPBSchema, { viewId });
      const title = items.find(f => f.isPrimary && f.fieldType === FieldType.RichText);
      if (!title) throw new Error('Board has no title field.');
      const ensure = async (name: string) => {
        const fields = items.filter(f => f.name === name);
        if (fields.length > 1 || fields[0] && (fields[0].isPrimary || fields[0].fieldType !== FieldType.RichText)) throw new Error('Ambiguous board fields.');
        return fields[0] ?? core.write('CreateField', FieldPBSchema, CreateFieldPayloadPBSchema, {
          viewId, fieldType: FieldType.RichText, oneOfFieldName: { case: 'fieldName', value: name } });
      };
      const origin = await ensure('HyperTask Hub origin');
      const target = (rowId: string) => ({ kind: 'hypertask' as const, rowId, viewId, databaseId: db.id, workspaceId: this.workspace });
      for (const row of db.rows) {
        const cell = await core.read('GetCell', CellPBSchema, CellIdPBSchema, { viewId, rowId: row.id, fieldId: origin.id });
        if (new TextDecoder().decode(cell.data) === input.originKey) { await check(); return target(row.id); }
      }
      const link = await ensure('Source link');
      await check();
      const current = await core.read('GetView', ViewPBSchema, ViewIdPBSchema, { value: viewId });
      if (current.id !== viewId || current.oneOfIsLocked.value || !hyperIsGeneralKanban(current)) throw new Error('Board changed.');
      await this.writable(core, current);
      const row = await core.write('CreateRow', RowMetaPBSchema, CreateRowPayloadPBSchema, { viewId, rowPosition: { position: OrderObjectPositionTypePB.End },
        data: { [title.id]: input.title, [link.id]: input.link, [origin.id]: input.originKey } });
      if (!row.id) throw new Error('Missing row receipt.');
      return target(row.id);
    });
    queues.set(key, work);
    return work.finally(() => { if (queues.get(key) === work) queues.delete(key); });
  }
}
