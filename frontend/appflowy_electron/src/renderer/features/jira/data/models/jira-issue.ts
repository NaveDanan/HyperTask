export enum JiraStatusCategory { toDo = 'new', inProgress = 'indeterminate', done = 'done', unknown = 'undefined' }
export const jiraStatusCategoryLabels: Record<JiraStatusCategory, string> = { new: 'To Do', indeterminate: 'In Progress', done: 'Done', undefined: 'No category' };
export function statusCategoryFromKey(value: unknown): JiraStatusCategory {
  return Object.values(JiraStatusCategory).includes(value as JiraStatusCategory) ? value as JiraStatusCategory : JiraStatusCategory.unknown;
}
export function jsonObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
export function jsonObjects(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(x => x !== null && typeof x === 'object' && !Array.isArray(x)) : [];
}
export function parseJiraDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return Number.isNaN(d.getTime()) ? null : d;
}
export class HyperJiraUser {
  constructor(readonly name: string, readonly displayName: string, readonly key = '', readonly emailAddress = '') {}
  static fromJson(j: Record<string, unknown>): HyperJiraUser { return new HyperJiraUser(String(j.name ?? j.accountId ?? ''), String(j.displayName ?? ''), String(j.key ?? ''), String(j.emailAddress ?? '')); }
  toJson() { return { name: this.name, key: this.key, displayName: this.displayName, emailAddress: this.emailAddress }; }
}
export class HyperJiraIssueType {
  constructor(readonly id: string, readonly name: string, readonly subtask = false, readonly description = '') {}
  static fromJson(j: Record<string, unknown>): HyperJiraIssueType { return new HyperJiraIssueType(String(j.id ?? ''), String(j.name ?? ''), j.subtask === true, String(j.description ?? '')); }
}
export class HyperJiraProject {
  constructor(readonly id: string, readonly key: string, readonly name: string, readonly issueTypes: HyperJiraIssueType[] = []) {}
  static fromJson(j: Record<string, unknown>): HyperJiraProject { return new HyperJiraProject(String(j.id ?? ''), String(j.key ?? ''), String(j.name ?? ''), jsonObjects(j.issueTypes).map(HyperJiraIssueType.fromJson)); }
}
export interface JiraFieldOption { id: string; name: string }
export interface JiraTransitionField { id: string; name: string; required: boolean; allowedValues: JiraFieldOption[] }
export interface JiraTransitionInput { id: string; name: string; toStatusName: string; toCategory: JiraStatusCategory; fields?: JiraTransitionField[]; hasScreen?: boolean }
export class HyperJiraTransition {
  readonly id: string; readonly name: string; readonly toStatusName: string; readonly toCategory: JiraStatusCategory;
  readonly fields: JiraTransitionField[]; readonly hasScreen: boolean;
  constructor(i: JiraTransitionInput) { this.id = i.id; this.name = i.name; this.toStatusName = i.toStatusName; this.toCategory = i.toCategory; this.fields = i.fields ?? []; this.hasScreen = i.hasScreen ?? false; }
  static fromJson(j: Record<string, unknown>): HyperJiraTransition {
    const to = jsonObject(j.to);
    return new HyperJiraTransition({ id: String(j.id ?? ''), name: String(j.name ?? ''), toStatusName: String(to.name ?? ''),
      toCategory: statusCategoryFromKey(jsonObject(to.statusCategory).key), hasScreen: j.hasScreen === true,
      fields: Object.entries(jsonObject(j.fields)).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).map(([id, v]) => {
        const f = jsonObject(v); return { id, name: String(f.name ?? id), required: f.required === true,
          allowedValues: jsonObjects(f.allowedValues).map(o => ({ id: String(o.id ?? ''), name: String(o.name ?? o.value ?? '') })) };
      }) });
  }
  get closesIssue(): boolean { return this.toCategory === JiraStatusCategory.done; }
  get resolutionField(): JiraTransitionField | undefined { return this.fields.find(f => f.id === 'resolution'); }
  get unsupportedRequiredFields(): JiraTransitionField[] { return this.fields.filter(f => f.required && f.id !== 'resolution' && f.id !== 'comment'); }
}
export function pickCloseTransition(ts: HyperJiraTransition[]): HyperJiraTransition | null {
  const score = (t: HyperJiraTransition) => { const n = (t.name + ' ' + t.toStatusName).toLowerCase();
    return (n.includes('close') ? 4 : 0) + (n.includes('done') ? 3 : 0) + (n.includes('resolve') ? 2 : 0)
      - (['reject', "won't", 'cancel', 'duplicate'].some(s => n.includes(s)) ? 5 : 0) - t.unsupportedRequiredFields.length * 10; };
  return ts.filter(t => t.closesIssue).sort((a, b) => score(b) - score(a))[0] ?? null;
}
export interface JiraIssueInput {
  id: string; key: string; summary: string; statusName: string; statusCategory: JiraStatusCategory; issueTypeName: string; updated: Date;
  description?: string; issueTypeId?: string; priorityName?: string; assignee?: HyperJiraUser | null; reporter?: HyperJiraUser | null;
  created?: Date | null; resolutionName?: string; dueDate?: Date | null;
}
/** Serializes in REST shape so cached Flutter issues load unchanged. */
export class HyperJiraIssue {
  readonly id: string; readonly key: string; readonly summary: string; readonly statusName: string; readonly statusCategory: JiraStatusCategory;
  readonly issueTypeName: string; readonly updated: Date; readonly description: string; readonly issueTypeId: string; readonly priorityName: string;
  readonly assignee: HyperJiraUser | null; readonly reporter: HyperJiraUser | null; readonly created: Date | null; readonly resolutionName: string; readonly dueDate: Date | null;
  constructor(i: JiraIssueInput) {
    this.id = i.id; this.key = i.key; this.summary = i.summary; this.statusName = i.statusName; this.statusCategory = i.statusCategory;
    this.issueTypeName = i.issueTypeName; this.updated = i.updated; this.description = i.description ?? ''; this.issueTypeId = i.issueTypeId ?? '';
    this.priorityName = i.priorityName ?? ''; this.assignee = i.assignee ?? null; this.reporter = i.reporter ?? null;
    this.created = i.created ?? null; this.resolutionName = i.resolutionName ?? ''; this.dueDate = i.dueDate ?? null;
  }
  static readonly searchFields = ['summary', 'description', 'status', 'issuetype', 'priority', 'assignee', 'reporter', 'created', 'updated', 'resolution', 'duedate'];
  static fromJson(j: Record<string, unknown>): HyperJiraIssue {
    const f = jsonObject(j.fields), s = jsonObject(f.status), t = jsonObject(f.issuetype);
    return new HyperJiraIssue({ id: String(j.id ?? ''), key: String(j.key ?? ''), summary: String(f.summary ?? ''), description: typeof f.description === 'string' ? f.description : '',
      statusName: String(s.name ?? ''), statusCategory: statusCategoryFromKey(jsonObject(s.statusCategory).key), issueTypeName: String(t.name ?? ''), issueTypeId: String(t.id ?? ''),
      priorityName: String(jsonObject(f.priority).name ?? ''), assignee: f.assignee == null ? null : HyperJiraUser.fromJson(jsonObject(f.assignee)),
      reporter: f.reporter == null ? null : HyperJiraUser.fromJson(jsonObject(f.reporter)), created: parseJiraDate(f.created), updated: parseJiraDate(f.updated) ?? new Date(0),
      resolutionName: String(jsonObject(f.resolution).name ?? ''), dueDate: parseJiraDate(f.duedate) });
  }
  get isDone(): boolean { return this.statusCategory === JiraStatusCategory.done; }
  get assigneeLabel(): string { return this.assignee?.displayName || (this.assignee ? this.assignee.name : 'Unassigned'); }
  toJson(): Record<string, unknown> {
    return { id: this.id, key: this.key, fields: { summary: this.summary, description: this.description, status: { name: this.statusName, statusCategory: { key: this.statusCategory } },
      issuetype: { id: this.issueTypeId, name: this.issueTypeName }, ...(this.priorityName ? { priority: { name: this.priorityName } } : {}),
      ...(this.assignee ? { assignee: this.assignee.toJson() } : {}), ...(this.reporter ? { reporter: this.reporter.toJson() } : {}),
      ...(this.created ? { created: this.created.toISOString() } : {}), updated: this.updated.toISOString(),
      ...(this.resolutionName ? { resolution: { name: this.resolutionName } } : {}), ...(this.dueDate ? { duedate: this.dueDate.toISOString().slice(0, 10) } : {}) } };
  }
}
export class HyperJiraSearchPage {
  constructor(readonly issues: HyperJiraIssue[], readonly startAt: number, readonly maxResults: number, readonly total: number) {}
  get isLast(): boolean { return !this.issues.length || this.startAt + this.issues.length >= this.total; }
}
export interface JiraIssueDraftInput { summary?: string | null; description?: string | null; issueTypeId?: string | null; assigneeName?: string | null }
/** Null/undefined omit fields; empty assignee explicitly unassigns. */
export class HyperJiraIssueDraft implements JiraIssueDraftInput {
  readonly summary?: string | null; readonly description?: string | null; readonly issueTypeId?: string | null; readonly assigneeName?: string | null;
  constructor(i: JiraIssueDraftInput = {}) { Object.assign(this, i); }
  toFields(projectKey?: string): Record<string, unknown> {
    return { ...(projectKey !== undefined ? { project: { key: projectKey } } : {}), ...(this.issueTypeId != null ? { issuetype: { id: this.issueTypeId } } : {}),
      ...(this.summary != null ? { summary: this.summary } : {}), ...(this.description != null ? { description: this.description } : {}),
      ...(this.assigneeName != null ? { assignee: this.assigneeName ? { name: this.assigneeName } : null } : {}) };
  }
}
export { HyperJiraUser as JiraUser, HyperJiraIssueType as JiraIssueType, HyperJiraProject as JiraProject,
  HyperJiraTransition as JiraTransition, HyperJiraIssue as JiraIssue, HyperJiraSearchPage as JiraSearchPage, HyperJiraIssueDraft as JiraIssueDraft };
