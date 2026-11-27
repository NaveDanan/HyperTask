import { OpenDocumentPayloadPBSchema, DocumentTextPBSchema } from '@shared/protobuf/hyper-document/entities_pb';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { HyperHubReadScope } from '@shared/HyperTaskHub';
import { ErrorCode } from '@shared/protobuf/hyper-error/code_pb';
import { HyperErrorSchema } from '@shared/protobuf/hyper-error/errors_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { CellPBSchema, CellIdPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { FieldType, RepeatedFieldPBSchema, GetFieldPayloadPBSchema } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { ViewLayoutPB, RepeatedViewPBSchema, ViewIdPBSchema, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { Status } from '../core/protocol';
import { hyperTaskViewKind } from '@shared/HyperTaskView';
import { HyperBotsProjectCore, type HyperBotsProjectRequest } from '../HyperBotsProjectCore';
import { HyperBotsGanttTasks } from '../HyperBotsGanttTasks';
import { HyperBotsProjectTasks } from '../HyperBotsProjectTasks';
import { hyperHubEmailIdentity, hyperHubHash, hyperHubInstant, type HyperHubRecord } from './HyperTaskHubStore';
import { HyperHubAccessLost, type HyperHubBatch, type HyperHubQuery } from './HyperTaskHubSync';

export function hyperHubMirror(key: string, link: string, instance?: string) {
  return instance && /^[A-Z][A-Z0-9_]*-\d+$/i.test(key) && link === instance + '/browse/' + key ? link : undefined;
}

function checkedWorkspaceRequest(request: HyperBotsProjectRequest): HyperBotsProjectRequest {
  return async (event, payload) => {
    const reply = await request(event, payload);
    if (reply.status === Status.Err && [ErrorCode.UserUnauthorized, ErrorCode.NotEnoughPermissions]
      .includes(fromBinary(HyperErrorSchema, reply.payload).code)) throw new HyperHubAccessLost();
    return reply;
  };
}

export async function hyperHubReadView(request: HyperBotsProjectRequest, databaseId: string, viewId: string, calendar: boolean, scope: HyperHubReadScope, signal: AbortSignal) {
  const core = new HyperBotsProjectCore(checkedWorkspaceRequest(request), scope.accountId, signal);
  await core.scope(scope.workspaceId);
  const { items } = await core.read('GetAllViews', RepeatedViewPBSchema);
  if (!items.some(v => v.id === viewId)) throw new HyperHubAccessLost();
  const reply = await request('GetView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, { value: viewId })));
  if (reply.status === Status.Err) {
    const { code } = fromBinary(HyperErrorSchema, reply.payload);
    if ([ErrorCode.RecordNotFound, ErrorCode.UserUnauthorized, ErrorCode.NotEnoughPermissions].includes(code)) throw new HyperHubAccessLost();
  }
  if (reply.status !== Status.Ok) throw new Error('HyperTask could not verify the selected view.');
  const view = fromBinary(ViewPBSchema, reply.payload);
  if (view.id !== viewId || (calendar ? view.layout !== ViewLayoutPB.Calendar : !hyperTaskViewKind(view))) throw new HyperHubAccessLost();
  const db = await core.read('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, { value: viewId });
  if (db.id !== databaseId) throw new HyperHubAccessLost();
  return { core, db, view };
}

export class HyperHubProjectSource implements HyperHubQuery {
  readonly kind = 'hypertask';
  readonly connectionId = 'hypertask';
  readonly queryId: string;
  readonly label = 'HyperTask';
  constructor(private readonly request: HyperBotsProjectRequest, readonly databaseId: string, readonly viewId: string,
    private readonly zone: string, private readonly jiraInstance?: string, private readonly now = Date.now) {
    this.queryId = hyperHubHash(databaseId, viewId);
  }


  async check(record: HyperHubRecord, signal: AbortSignal, verifyRevision = false) {
    if (verifyRevision) {
      const latest = (await this.read(record.scope, signal)).records.find(r => r.id === record.id);
      if (!latest) throw new HyperHubAccessLost();
      if (latest.revision !== record.revision) throw new Error('Row changed.');
      return;
    }
    const { core, db } = await hyperHubReadView(this.request, this.databaseId, this.viewId, false, record.scope, signal);
    const rowId = record.key.kind === 'hypertask' && record.key.rowId;
    if (!db.rows.some(r => r.id === rowId)) throw new HyperHubAccessLost();
    await core.scope(record.scope.workspaceId);
  }

  async read(scope: HyperHubReadScope, signal: AbortSignal): Promise<HyperHubBatch> {
    const { core, view, db } = await hyperHubReadView(this.request, this.databaseId, this.viewId, false, scope, signal);
    const { items } = await core.read('GetFields', RepeatedFieldPBSchema, GetFieldPayloadPBSchema, { viewId: this.viewId });
    const field = (name: string) => items.find(f => f.fieldType === FieldType.RichText && f.name.toLowerCase() === name)?.id;
    const originField = field('hypertask hub origin');
    const keyField = field('jira key'), linkField = field('jira link');
    const text = async (rowId: string, fieldId: string) => new TextDecoder().decode((await core.read('GetCell', CellPBSchema,
      CellIdPBSchema, { viewId: this.viewId, rowId, fieldId })).data);
    const gantt = hyperTaskViewKind(view) === 'gantt' ? new HyperBotsGanttTasks(core, view, items, db.rows.map(r => r.id)) : undefined;
    const tasks = new HyperBotsProjectTasks(checkedWorkspaceRequest(this.request), scope.accountId);
    const records: HyperHubRecord[] = [];
    const observedAt = hyperHubInstant(this.now());
    const expected = new Set(db.rows.map(r => r.id));
    let offset: number | null = 0;
    do {
      const page = await tasks.search({ viewId: this.viewId, offset, limit: 30 }, signal);
      for (const row of page.tasks) {
        const [jiraKey, link] = keyField && linkField ? await Promise.all([text(row.rowId, keyField), text(row.rowId, linkField)]) : ['', ''];
        const schedule = await gantt?.sourceSchedule(row.rowId, this.zone);
        const origin = originField && await text(row.rowId, originField);
        const originKey = origin && /^[a-f0-9]{64}$/.test(origin) ? origin : undefined;
        const jiraAlias = hyperHubMirror(jiraKey.trim(), link, this.jiraInstance);
        const key = { kind: this.kind, workspaceId: scope.workspaceId, databaseId: this.databaseId, rowId: row.rowId } as const;
        const civil = (date?: string | null) => date ? { kind: 'civil-date' as const, date, zone: this.zone } : undefined;
        records.push({ id: hyperHubHash(scope.workspaceId, this.databaseId, row.rowId), key, scope, openTarget: { ...key, viewId: this.viewId },
          label: view.name || 'HyperTask', title: row.title, rawStatus: row.status ?? undefined,
          completion: /^(done|complete|completed|closed|resolved|finished)$/i.test(row.status ?? '') ? 'complete' : 'open',
          initialState: 'ready', observedAt, revision: hyperHubHash(row.title, row.status, row.startDate, row.endDate, jiraAlias, row.assignees, row.description),
          role: originKey || jiraAlias ? 'mirror' : 'origin', originKey, jiraAlias, mirrorFingerprint: jiraKey && link ? hyperHubHash(jiraKey.trim(), link) : undefined,
          verifiedIdentityIds: row.assignees.flatMap(p => hyperHubEmailIdentity('email' in p && typeof p.email === 'string' ? p.email : '') ?? []),
          briefExcerpt: (row.description || row.title).slice(0, 1024),
          people: row.assignees.map(person => ({ id: hyperHubHash(scope.connectionId, 'email' in person ? person.email : person.name), name: person.name, role: 'assignee' })),
          schedule: schedule?.interval && { start: hyperHubInstant(schedule.interval.start), end: hyperHubInstant(schedule.interval.end) },
          due: schedule ? schedule.due : civil(row.endDate), planned: schedule ? schedule.planned : civil(row.startDate), projectId: this.databaseId });
      }
      offset = page.nextOffset;
    } while (offset !== null);
    await core.scope(scope.workspaceId);
    const ids = new Set(records.map(r => r.id));
    const complete = records.length === expected.size && ids.size === expected.size &&
      records.every(r => r.key.kind === 'hypertask' && !!r.key.rowId && expected.has(r.key.rowId));
    return { records, cursor: null, completeness: complete ? 'complete' : 'partial' };
  }
}

export class HyperHubPageSource {
  readonly kind = 'hypertask';
  readonly connectionId = 'hypertask';
  readonly label = 'HyperTask page';
  readonly queryId: string;
  constructor(private readonly request: HyperBotsProjectRequest, private readonly viewId: string, private readonly meetingId?: string) {
    this.queryId = hyperHubHash('page', viewId, meetingId);
  }

  async read(scope: HyperHubReadScope, signal: AbortSignal): Promise<HyperHubBatch> {
    const core = new HyperBotsProjectCore(checkedWorkspaceRequest(this.request), scope.accountId, signal);
    await core.scope(scope.workspaceId);
    const { items } = await core.read('GetAllViews', RepeatedViewPBSchema);
    const page = items.find(v => v.id === this.viewId && v.layout === ViewLayoutPB.Document);
    if (!page) throw new HyperHubAccessLost();
    const reply = await this.request('GetDocumentText', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, { documentId: page.id })));
    if (reply.status === Status.Err && [ErrorCode.RecordNotFound, ErrorCode.UserUnauthorized, ErrorCode.NotEnoughPermissions]
      .includes(fromBinary(HyperErrorSchema, reply.payload).code)) throw new HyperHubAccessLost();
    if (reply.status !== Status.Ok) throw new Error('Page unavailable.');
    const excerpt = fromBinary(DocumentTextPBSchema, reply.payload).text.slice(0, 1024);
    await core.scope(scope.workspaceId);
    const key = { kind: this.kind, workspaceId: scope.workspaceId, pageId: page.id } as const;
    return { records: [], cursor: null, completeness: 'complete', evidence: [{ key, scope, openTarget: { ...key, viewId: page.id },
      id: hyperHubHash(key), observedAt: hyperHubInstant(Date.now()), revision: hyperHubHash(page.name, String(page.lastEdited), excerpt),
      label: page.name, briefExcerpt: excerpt, projectId: '', completion: 'unknown', initialState: 'ready', role: 'mentions',
      linkedMeetingId: this.meetingId, document: { kind: 'hypertask-page' } }] };
  }

  async check(record: HyperHubRecord, signal: AbortSignal) {
    const item = (await this.read(record.scope, signal)).evidence?.[0];
    if (item?.id !== record.id) throw new HyperHubAccessLost();
    if (item.revision !== record.revision) throw new Error('Page changed.');
  }
}
