import { createHash } from 'node:crypto';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { HyperBotsCardRow } from '@shared/HyperBots';
import { hyperParseMentions, hyperSerializeMention, type HyperMention } from '@shared/HyperPeopleMentions';
import { HyperPeopleFieldIcon, hyperIsPeopleField } from '@shared/HyperPeopleProperty';
import { hyperTaskViewExtra, hyperTaskViewKind } from '@shared/HyperTaskView';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { CellChangesetPBSchema, CellIdPBSchema, CellPBSchema, CreateSelectOptionPayloadPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { CreateFieldPayloadPBSchema, FieldChangesetPBSchema, FieldPBSchema, FieldType, GetFieldPayloadPBSchema, RepeatedFieldPBSchema, type FieldPB } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { RepeatedGroupPBSchema } from '@shared/protobuf/hyper-database2/group_pb';
import { OrderObjectPositionTypePB } from '@shared/protobuf/hyper-database2/position_entities_pb';
import { CreateRowPayloadPBSchema, RowMetaPBSchema } from '@shared/protobuf/hyper-database2/row_entities_pb';
import { RepeatedSelectOptionPayloadSchema, SelectOptionCellChangesetPBSchema, SelectOptionCellDataPBSchema, SelectOptionColorPB, SelectOptionPBSchema, SingleSelectTypeOptionPBSchema, MultiSelectTypeOptionPBSchema } from '@shared/protobuf/hyper-database2/select_option_entities_pb';
import { DatabaseViewSettingPBSchema } from '@shared/protobuf/hyper-database2/setting_entities_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, UpdateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { QueryWorkspacePBSchema, RepeatedWorkspaceMemberPBSchema } from '@shared/protobuf/hyper-user/workspace_pb';
import { HyperBotsGanttTasks } from './HyperBotsGanttTasks';
import { HyperBotsProjectCore, type HyperBotsProjectRequest } from './HyperBotsProjectCore';
import type { HyperBotsProjectCreate, HyperBotsProjectDestination, HyperBotsProjectFindPeople, HyperBotsProjectListViews, HyperBotsProjectSearch, HyperBotsProjectUpdate } from './HyperBotsProjectTools';
import { HyperBotsToolError, type HyperBotsBinding } from './HyperBotsRuntime';

const decoder = new TextDecoder();
const fold = (value: string) => value.trim().toLowerCase();
const statusKey = (value: string) => fold(value).replace(/[\s_-]+/g, '');
const statuses = [
  { name: 'To Do', color: SelectOptionColorPB.Purple, aliases: ['todo', 'new', 'backlog', 'open', 'notstarted'] },
  { name: 'Doing', color: SelectOptionColorPB.Orange, aliases: ['doing', 'inprogress', 'started', 'active', 'working'] },
  { name: 'Done', color: SelectOptionColorPB.Green, aliases: ['done', 'complete', 'completed', 'closed', 'resolved', 'finished'] },
];
const statusCategory = (label: string) => statuses.find(status => status.aliases.includes(statusKey(label)));
const text = (value: string) => hyperParseMentions(value).map(part => part.kind === 'mention' ? part.person.name : part.text).join('');
const peopleIn = (value: string) => hyperParseMentions(value).flatMap(part => part.kind === 'mention' ? [part.person] : []);
const uniquePeople = (people: HyperMention[]) => [...new Map(people.map(person => [fold(person.email), person])).values()];
const fingerprintFor = (user: string, workspace: string, view: string, rowId?: string) => createHash('sha256').update(JSON.stringify([user, workspace, view, rowId])).digest('hex');

function selectOptions(field: FieldPB) {
  if (field.fieldType === FieldType.SingleSelect) return fromBinary(SingleSelectTypeOptionPBSchema, field.typeOptionData).options;
  if (field.fieldType === FieldType.MultiSelect) return fromBinary(MultiSelectTypeOptionPBSchema, field.typeOptionData).options;
  return [];
}

/** Native tasks in the owner's current workspace. All writes use the same view and row events as the renderer. */
export class HyperBotsProjectTasks {
  private mutations: Promise<unknown> = Promise.resolve();

  constructor(private readonly request: HyperBotsProjectRequest, private readonly userKey: string) {}

  private core(signal: AbortSignal) { return new HyperBotsProjectCore(this.request, this.userKey, signal); }

  async bindWorkspace(signal: AbortSignal): Promise<HyperBotsBinding> {
    const workspace = await this.core(signal).pin();
    return { destination: 'Current HyperTask workspace', fingerprint: fingerprintFor(this.userKey, workspace, '') };
  }

  async bind(input: HyperBotsProjectDestination & Partial<HyperBotsProjectUpdate>, signal: AbortSignal): Promise<HyperBotsBinding> {
    const scope = await this.destination(input, signal);
    const cards: HyperBotsCardRow[] = [];
    if (input.rowId && scope.view) {
      const table = await this.table(scope.core, scope.view);
      if (!table.rowIds.includes(input.rowId)) throw new HyperBotsToolError('refused', 'That task is no longer in the selected view. Search for it again.');
      cards.push({ label: 'Existing task', value: (await table.title(input.rowId)).slice(0, 300) || 'Untitled' });
    }
    if (input.title) cards.push({ label: 'Title', value: input.title });
    if (input.description !== undefined) cards.push({ label: 'Description', value: input.description || 'Clear description', long: true });
    if (input.status) cards.push({ label: 'Status', value: input.status });
    if (input.assignees) cards.push({ label: 'Set assignees', value: input.assignees.map(person => `${person.name} (${person.email})`).join(', ') || 'Clear assignees' });
    if (input.addAssignees) cards.push({ label: 'Tag coworkers', value: input.addAssignees.map(person => `${person.name} (${person.email})`).join(', ') });
    if (input.startDate) cards.push({ label: 'Start', value: input.startDate });
    if (input.endDate) cards.push({ label: 'End', value: input.endDate });
    if (input.clearSchedule) cards.push({ label: 'Schedule', value: 'Clear dates' });
    await scope.core.pin();
    const label = scope.view && scope.kind !== 'general' ? (scope.view.name || 'Untitled') + (scope.kind === 'gantt' ? ' · Gantt' : ' · Kanban') : 'General Kanban on HyperHome';
    return { destination: label, fingerprint: scope.fingerprint, ...(cards.length ? { card: cards } : {}) };
  }

  private async destination(input: HyperBotsProjectDestination & { rowId?: string }, signal: AbortSignal, approved?: string | null) {
    const core = this.core(signal);
    const workspaceId = await core.pin();
    if (!input.viewId && input.view && input.view !== 'general') throw new HyperBotsToolError('args', 'Find the project view first and use its view ID.');
    const picked = input.viewId ?? (await core.read('GetAllViews', RepeatedViewPBSchema)).items.find(view => hyperTaskViewKind(view) === 'general')?.id;
    const view = picked ? await core.read('GetView', ViewPBSchema, ViewIdPBSchema, { value: picked }) : undefined;
    const kind = view ? hyperTaskViewKind(view) : 'general';
    if (!kind || (input.view && kind !== input.view)) throw new HyperBotsToolError('refused', 'That ID does not identify the requested Kanban or Gantt view.');
    // General is a named workspace destination even when HyperHome has yet to create it.
    const fingerprint = fingerprintFor(this.userKey, workspaceId, input.viewId ?? 'general-kanban', input.rowId);
    if (approved && approved !== fingerprint) throw new HyperBotsToolError('refused', 'The task destination changed since approval. Start another request.');
    return { core, workspaceId, view, kind, fingerprint };
  }

  private async workspace(signal: AbortSignal, approved?: string | null) {
    const core = this.core(signal);
    const workspaceId = await core.pin();
    if (approved && approved !== fingerprintFor(this.userKey, workspaceId, '')) throw new HyperBotsToolError('refused', 'The HyperTask workspace changed since approval. Start another request.');
    return { core, workspaceId };
  }

  async listViews(input: HyperBotsProjectListViews, signal: AbortSignal, approved?: string | null) {
    const { core } = await this.workspace(signal, approved);
    const { items } = await core.read('GetAllViews', RepeatedViewPBSchema);
    const byId = new Map(items.map(view => [view.id, view]));
    const checked = new Map<string, Promise<ViewPB | undefined>>();
    const accessible = (id: string) => {
      let entry = checked.get(id);
      if (!entry) {
        entry = core.read('GetView', ViewPBSchema, ViewIdPBSchema, { value: id }).catch(error => {
          signal.throwIfAborted();
          if (error instanceof HyperBotsToolError && error.kind === 'refused') return undefined;
          throw error;
        });
        checked.set(id, entry);
      }
      return entry;
    };
    const output: { viewId: string; view: NonNullable<ReturnType<typeof hyperTaskViewKind>>; name: string; path: string }[] = [];
    const query = fold(input.query ?? '');
    for (const item of items) {
      const kind = hyperTaskViewKind(item);
      if (!kind || (input.view && input.view !== kind)) continue;
      const lineage = [item];
      let parent = byId.get(item.parentViewId);
      while (parent && !lineage.includes(parent)) { lineage.unshift(parent); parent = byId.get(parent.parentViewId); }
      if (query && !fold(lineage.map(view => view.name).join(' / ')).includes(query) && !(kind === 'general' && 'general kanban'.includes(query))) continue;
      const view = await accessible(item.id);
      if (!view || hyperTaskViewKind(view) !== kind) continue;
      const path = (await Promise.all(lineage.map(ancestor => accessible(ancestor.id)))).flatMap(ancestor => ancestor ? [ancestor.name || 'Untitled'] : []).join(' / ');
      if (query && !fold(path).includes(query) && !(kind === 'general' && 'general kanban'.includes(query))) continue;
      output.push({ viewId: view.id, view: kind, name: view.name, path });
      if (output.length >= 40) break;
    }
    await core.pin();
    return { views: output };
  }

  async findPeople(input: HyperBotsProjectFindPeople, signal: AbortSignal, approved?: string | null) {
    const { core, workspaceId } = await this.workspace(signal, approved);
    const { items } = await core.read('GetWorkspaceMembers', RepeatedWorkspaceMemberPBSchema, QueryWorkspacePBSchema, { workspaceId });
    const query = fold(input.query).replace(/^@/, '');
    const matches = items.filter(person => person.email && (fold(person.name).includes(query) || fold(person.email).includes(query)));
    const exact = matches.filter(person => fold(person.name) === query || fold(person.email) === query);
    await core.pin();
    return { people: uniquePeople((exact.length ? exact : matches).slice(0, 15).map(({ name, email }) => ({ name: name || email, email }))) };
  }

  async search(input: HyperBotsProjectSearch, signal: AbortSignal, approved?: string | null) {
    const { core, view } = await this.destination(input, signal, approved);
    if (!view) return { viewId: null, tasks: [], nextOffset: null };
    const table = await this.table(core, view);
    const offset = input.offset ?? 0, limit = input.limit ?? 15;
    const query = fold(input.query ?? '');
    const rows = input.rowId ? table.rowIds.filter(id => id === input.rowId) : table.rowIds.slice(offset);
    const matches: { rowId: string; title: string }[] = [];
    let scanned = 0;
    while (matches.length < limit && scanned < rows.length) {
      const ids = rows.slice(scanned, scanned + Math.min(16, limit - matches.length));
      const titles = await Promise.all(ids.map(id => table.title(id)));
      for (const [index, title] of titles.entries()) if (fold(title).includes(query)) matches.push({ rowId: ids[index]!, title });
      scanned += ids.length;
    }
    const tasks = await Promise.all(matches.map(async match => ({ ...await table.summary(match.rowId), ...match })));
    await core.pin();
    return { viewId: view.id, tasks, nextOffset: !input.rowId && scanned < rows.length ? offset + scanned : null };
  }

  create(input: HyperBotsProjectCreate, signal: AbortSignal, approved?: string | null) {
    return this.mutate(input, signal, approved);
  }

  update(input: HyperBotsProjectUpdate, signal: AbortSignal, approved?: string | null) {
    return this.mutate(input, signal, approved);
  }

  private mutate(input: HyperBotsProjectCreate | HyperBotsProjectUpdate, signal: AbortSignal, approved?: string | null) {
    const work = this.mutations.then(async () => {
      const scope = await this.destination(input, signal, approved);
      const rowId = 'rowId' in input ? input.rowId : undefined;
      if (scope.kind !== 'gantt' && (input.startDate || input.endDate || ('clearSchedule' in input && input.clearSchedule))) {
        throw new HyperBotsToolError('args', 'Select a Gantt view to change a task schedule.');
      }
      if (!scope.view && rowId) throw new HyperBotsToolError('refused', 'The General Kanban does not have that task.');
      const view = scope.view ?? await scope.core.write('CreateView', ViewPBSchema, CreateViewPayloadPBSchema, {
        parentViewId: scope.workspaceId, layout: ViewLayoutPB.Board, name: 'Hyper-Kanban',
        oneOfExtra: { case: 'extra', value: JSON.stringify({ hyper_general_kanban: true }) },
      });
      if (view.oneOfIsLocked.value) throw new HyperBotsToolError('refused', 'The selected view is locked.');
      return this.changeTask(await this.table(scope.core, view), input, rowId);
    });
    this.mutations = work.catch(() => {});
    return work;
  }

  private async table(core: HyperBotsProjectCore, view: ViewPB) {
    const args = { value: view.id };
    const database = await core.read('GetDatabase', DatabasePBSchema, DatabaseViewIdPBSchema, args);
    const fields = await core.read('GetFields', RepeatedFieldPBSchema, GetFieldPayloadPBSchema, { viewId: view.id });
    const rowIds = database.rows.map(row => row.id);
    const primary = fields.items.find(field => field.isPrimary && field.fieldType === FieldType.RichText);
    if (!primary) throw new HyperBotsToolError('refused', 'The selected view has no task title field.');
    const kind = hyperTaskViewKind(view);
    const gantt = kind === 'gantt' ? new HyperBotsGanttTasks(core, view, fields.items, rowIds) : undefined;
    const getField = (id: string | null | undefined) => fields.items.find(field => field.id === id);
    const descriptionField = fields.items.find(field => field.fieldType === FieldType.RichText && !field.isPrimary && ['description', 'notes'].includes(fold(field.name)));
    const config = await gantt?.config();
    let groupField: FieldPB | undefined;
    if (!gantt) {
      const [settings, groups] = await Promise.all([
        core.read('GetDatabaseSetting', DatabaseViewSettingPBSchema, DatabaseViewIdPBSchema, args),
        core.read('GetGroups', RepeatedGroupPBSchema, DatabaseViewIdPBSchema, args),
      ]);
      groupField = getField(settings.groupSettings?.items[0]?.fieldId ?? groups.items[0]?.fieldId);
    }
    const ganttColorField = getField(config?.color_field_id);
    const requestedColorField = (hyperTaskViewExtra(view)?.hyper_gantt as { color_field_id?: unknown } | undefined)?.color_field_id;
    const statusFromColor = ganttColorField && (requestedColorField === ganttColorField.id || /status/i.test(ganttColorField.name)
      || selectOptions(ganttColorField).some(option => statusCategory(option.name))) ? ganttColorField : undefined;
    const statusField = statusFromColor
      ?? (groupField?.fieldType === FieldType.SingleSelect ? groupField : undefined)
      ?? fields.items.find(field => field.fieldType === FieldType.SingleSelect && statusKey(field.name) === 'status');
    const mappedAssignee = getField(config?.assignee_field_id);
    const peopleField = (mappedAssignee?.fieldType === FieldType.RichText && !mappedAssignee.isPrimary ? mappedAssignee : undefined)
      ?? fields.items.find(field => !field.isPrimary && hyperIsPeopleField(field) && /^(assignees?|owners?|people)$/i.test(field.name))
      ?? fields.items.find(field => !field.isPrimary && hyperIsPeopleField(field));
    const cell = (rowId: string, fieldId: string) => core.read('GetCell', CellPBSchema, CellIdPBSchema, { viewId: view.id, rowId, fieldId });
    const readText = async (rowId: string, fieldId: string) => decoder.decode((await cell(rowId, fieldId)).data);
    const selected = async (rowId: string, fieldId: string) => fromBinary(SelectOptionCellDataPBSchema, (await cell(rowId, fieldId)).data).selectOptions;
    const title = async (rowId: string) => text(await readText(rowId, primary.id));
    const summary = async (rowId: string) => {
      const [name, description, status, people, mapped, dates] = await Promise.all([
        title(rowId), descriptionField ? readText(rowId, descriptionField.id) : '',
        statusField ? selected(rowId, statusField.id) : [], peopleField ? readText(rowId, peopleField.id) : '',
        mappedAssignee && [FieldType.SingleSelect, FieldType.MultiSelect].includes(mappedAssignee.fieldType) ? selected(rowId, mappedAssignee.id) : [],
        gantt?.dates(rowId),
      ]);
      const assignees = peopleIn(people);
      return { rowId, title: name, description, status: status[0]?.name ?? null, assignees: assignees.length ? assignees : mapped.map(option => ({ name: option.name })), ...dates };
    };
    return { core, view, rowIds, primary, fields: fields.items, groupField, statusField, peopleField, mappedAssignee, descriptionField, gantt, config, readText, selected, title, summary };
  }

  private async changeTask(table: Awaited<ReturnType<HyperBotsProjectTasks['table']>>, input: HyperBotsProjectCreate | HyperBotsProjectUpdate, rowId?: string) {
    const { core, view, peopleField } = table;
    if (rowId && !table.rowIds.includes(rowId)) throw new HyperBotsToolError('refused', 'That task is no longer in the selected view. Search for it again.');
    const clearStatus = input.status !== undefined && statusKey(input.status) === 'nostatus';
    const category = statusCategory(input.status ?? 'To Do');
    const options = table.statusField ? selectOptions(table.statusField) : [];
    let status = clearStatus ? undefined : options.find(option => input.status && statusKey(option.name) === statusKey(input.status))
      ?? (category && options.find(option => statusCategory(option.name) === category));
    if (input.status && !clearStatus && !status && (table.statusField || !table.gantt || !category)) {
      throw new HyperBotsToolError('args', options.length ? 'Use one of these statuses: ' + options.map(option => option.name).join(', ') + '.' : 'This view has no matching status column.');
    }
    const addPeople = 'addAssignees' in input ? input.addAssignees : undefined;
    const updatePeople = !!(input.assignees || addPeople);
    const previousPeople = updatePeople && addPeople && input.assignees === undefined && peopleField && rowId ? await table.readText(rowId, peopleField.id) : '';
    const assignees = uniquePeople([...(input.assignees ?? peopleIn(previousPeople)), ...(addPeople ?? [])]);
    if (table.mappedAssignee?.fieldType === FieldType.SingleSelect && assignees.length > 1) {
      throw new HyperBotsToolError('args', 'This Gantt view allows one assignee. Choose one coworker.');
    }
    const applyDates = await table.gantt?.prepareSchedule(input, rowId);
    let statusField = table.statusField;
    let assigneeField = peopleField;
    let descriptionField = table.descriptionField;
    const ganttPatch: Record<string, string> = {};
    const createField = (fieldName: string, fieldType: FieldType, typeOptionData?: Uint8Array) => core.write('CreateField', FieldPBSchema, CreateFieldPayloadPBSchema, {
      viewId: view.id, fieldType, oneOfFieldName: { case: 'fieldName', value: fieldName },
      ...(typeOptionData ? { oneOfTypeOptionData: { case: 'typeOptionData' as const, value: typeOptionData } } : {}),
    });
    if (!statusField && table.gantt && category && input.status && !clearStatus) {
      const statusesWithIds = statuses.map(option => ({ id: statusKey(option.name), name: option.name, color: option.color }));
      statusField = await createField('Status', FieldType.SingleSelect, toBinary(SingleSelectTypeOptionPBSchema, create(SingleSelectTypeOptionPBSchema, { options: statusesWithIds })));
      status = selectOptions(statusField).find(option => statusCategory(option.name) === category);
      if (!status) throw new HyperBotsToolError('refused', 'The view could not create that status.');
      ganttPatch.color_field_id = statusField.id;
    }
    if (updatePeople && !assigneeField && assignees.length) {
      assigneeField = await createField(table.fields.some(field => /^assignees?$/i.test(field.name)) ? 'People' : 'Assignees', FieldType.RichText);
      await core.writeVoid('UpdateField', FieldChangesetPBSchema, { viewId: view.id, fieldId: assigneeField.id, oneOfIcon: { case: 'icon', value: HyperPeopleFieldIcon } });
    }
    if (updatePeople && assigneeField && table.gantt && !table.mappedAssignee) ganttPatch.assignee_field_id = assigneeField.id;
    if (input.description && !descriptionField) descriptionField = await createField('Notes', FieldType.RichText);
    let assigneeOptionIds: string[] = [];
    const mapped = table.mappedAssignee;
    if (updatePeople && mapped && [FieldType.SingleSelect, FieldType.MultiSelect].includes(mapped.fieldType)) {
      const available = selectOptions(mapped);
      for (const person of assignees) {
        let option = available.find(option => fold(option.name) === fold(person.name));
        if (!option) {
          option = await core.read('CreateSelectOption', SelectOptionPBSchema, CreateSelectOptionPayloadPBSchema, { viewId: view.id, fieldId: mapped.id, optionName: person.name });
          await core.writeVoid('InsertOrUpdateSelectOption', RepeatedSelectOptionPayloadSchema, { viewId: view.id, fieldId: mapped.id, items: [option] });
          available.push(option);
        }
        assigneeOptionIds.push(option.id);
      }
      if (rowId && addPeople && !input.assignees) {
        assigneeOptionIds = [...new Set([...(await table.selected(rowId, mapped.id)).map(option => option.id), ...assigneeOptionIds])];
        if (mapped.fieldType === FieldType.SingleSelect && assigneeOptionIds.length > 1) throw new HyperBotsToolError('args', 'This Gantt view allows one assignee. Use assignees to replace the current assignment.');
      }
    }
    const textCells: Record<string, string> = {};
    if (input.title !== undefined) textCells[table.primary.id] = input.title;
    if (input.description !== undefined && descriptionField) textCells[descriptionField.id] = input.description;
    if (updatePeople && assigneeField) {
      const priorEmails = new Set(peopleIn(previousPeople).map(person => fold(person.email)));
      const additional = assignees.filter(person => !priorEmails.has(fold(person.email))).map(hyperSerializeMention);
      textCells[assigneeField.id] = [previousPeople, ...additional].filter(Boolean).join(' ');
    }
    let targetRowId = rowId;
    try {
      if (!targetRowId) {
        const data = { ...textCells };
        if (statusField && status) data[statusField.id] = status.id;
        if (mapped && assigneeOptionIds.length) data[mapped.id] = assigneeOptionIds.join(',');
        const created = await core.write('CreateRow', RowMetaPBSchema, CreateRowPayloadPBSchema, {
          viewId: view.id, rowPosition: { position: OrderObjectPositionTypePB.End }, data,
          ...(status && table.groupField?.id === statusField?.id ? { oneOfGroupId: { case: 'groupId', value: status.id } } : {}),
        });
        if (!created.id) throw new HyperBotsToolError('transport', 'HyperTask created a row without returning its ID. Check the selected view before retrying.');
        targetRowId = created.id;
      } else {
        for (const [fieldId, cellChangeset] of Object.entries(textCells)) {
          await core.writeVoid('UpdateCell', CellChangesetPBSchema, { viewId: view.id, rowId: targetRowId, fieldId, cellChangeset });
        }
        const setSelection = async (field: FieldPB, ids: string[]) => {
          const selected = await table.selected(targetRowId!, field.id);
          await core.writeVoid('UpdateSelectOptionCell', SelectOptionCellChangesetPBSchema, {
            cellIdentifier: { viewId: view.id, rowId: targetRowId!, fieldId: field.id }, insertOptionIds: ids,
            deleteOptionIds: selected.filter(option => !ids.includes(option.id)).map(option => option.id),
          });
        };
        if (input.status && statusField) await setSelection(statusField, status ? [status.id] : []);
        if (updatePeople && mapped && [FieldType.SingleSelect, FieldType.MultiSelect].includes(mapped.fieldType)) await setSelection(mapped, assigneeOptionIds);
      }
      await applyDates?.(targetRowId);
      if (Object.keys(ganttPatch).length) {
        const fresh = await core.read('GetView', ViewPBSchema, ViewIdPBSchema, { value: view.id });
        const extra = hyperTaskViewExtra(fresh);
        await core.writeVoid('UpdateView', UpdateViewPayloadPBSchema, { viewId: view.id, oneOfExtra: { case: 'extra', value: JSON.stringify({ ...extra, hyper_gantt: { ...extra?.hyper_gantt as object | undefined, ...ganttPatch } }) } });
      }
      const currentView = await core.read('GetView', ViewPBSchema, ViewIdPBSchema, { value: view.id });
      const current = await this.table(core, currentView);
      const task = await current.summary(targetRowId);
      await core.pin();
      return { viewId: view.id, view: hyperTaskViewKind(view), task };
    } catch (error) {
      if (!targetRowId) throw error;
      throw new HyperBotsToolError('transport', `HyperTask could not confirm every change to task ${targetRowId}. Check the task in the selected view before retrying.`);
    }
  }
}
