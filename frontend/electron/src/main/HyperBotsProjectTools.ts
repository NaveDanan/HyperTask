import { z } from 'zod';
import { HYPER_BOTS_TOOLS, type HyperBotsProjectToolName } from '@shared/HyperBots';
import { hyperBotsParseArgs } from './HyperBotsOutlookTools';
import type { HyperBotsProjectTasks } from './HyperBotsProjectTasks';
import type { HyperBotsTool } from './HyperBotsRuntime';

const kind = z.enum(['general', 'board', 'gantt']);
const line = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\r\n]/.test(value), 'Use one line.');
const destination = {
  view: kind.optional().describe('Use general for HyperHome, board for a project Kanban, or gantt for a Gantt view. Defaults to general when no view ID is given.'),
  viewId: line(128).optional().describe('View ID returned by hypertask_list_task_views. Required for a project Kanban or Gantt view.'),
};
const assignees = z.array(z.strictObject({ name: line(150), email: z.email().max(320) })).max(20);
const schedule = {
  startDate: z.iso.date().optional().describe('Gantt start as a local calendar date, YYYY-MM-DD.'),
  endDate: z.iso.date().optional().describe('Gantt end as an inclusive local calendar date, YYYY-MM-DD.'),
};
const changes = {
  title: line(300),
  description: z.string().max(10_000).optional(),
  status: line(100).optional().describe('Column name, such as To Do, Doing, Done, or No status to clear an existing status.'),
  assignees: assignees.optional().describe('Set the task’s People field to these coworkers. Use verified names and emails from directory results or the user. An empty list clears it.'),
  ...schedule,
};
const rowId = line(128).describe('Task row ID returned by hypertask_search_tasks or hypertask_create_task.');
const listViewsArgs = z.strictObject({ view: kind.optional(), query: line(100).optional() });
const searchArgs = z.strictObject({ ...destination, query: line(200).optional(), rowId: rowId.optional(), offset: z.int().min(0).optional(), limit: z.int().min(1).max(30).optional() });
const peopleArgs = z.strictObject({ query: line(150) });
const createArgs = z.strictObject({ ...destination, ...changes });
const updateArgs = z.strictObject({
  ...destination, ...changes, title: changes.title.optional(), rowId,
  addAssignees: assignees.min(1).optional().describe('Tag these coworkers while keeping the task’s current assignees.'),
  clearSchedule: z.boolean().optional().describe('Clear a Gantt task’s dates.'),
}).refine(input => [input.title, input.description, input.status, input.assignees, input.addAssignees, input.startDate, input.endDate, input.clearSchedule || undefined].some(value => value !== undefined), 'Specify at least one task change.');

export type HyperBotsProjectCreate = z.output<typeof createArgs>;
export type HyperBotsProjectUpdate = z.output<typeof updateArgs>;
export type HyperBotsProjectSearch = z.output<typeof searchArgs>;
export type HyperBotsProjectListViews = z.output<typeof listViewsArgs>;
export type HyperBotsProjectFindPeople = z.output<typeof peopleArgs>;
export type HyperBotsProjectDestination = Pick<HyperBotsProjectCreate, 'view' | 'viewId'>;

export function hyperBotsProjectTools(tasks: HyperBotsProjectTasks): HyperBotsTool[] {
  const tool = <S extends z.ZodType>(name: HyperBotsProjectToolName, schema: S, description: string,
    summarize: (args: z.output<S>) => string, run: (args: z.output<S>, signal: AbortSignal, fingerprint?: string | null) => Promise<unknown>,
    bind: (args: z.output<S>, signal: AbortSignal) => ReturnType<NonNullable<HyperBotsTool['bind']>>): HyperBotsTool => ({
    name, access: HYPER_BOTS_TOOLS[name].access, description, parameters: z.toJSONSchema(schema),
    parse: args => hyperBotsParseArgs(schema, args), summarize: args => summarize(args as z.output<S>),
    run: (args, signal, fingerprint) => run(args as z.output<S>, signal, fingerprint),
    bind: (args, signal) => bind(args as z.output<S>, signal),
  });
  return [
    tool('hypertask_list_task_views', listViewsArgs,
      'Find Kanban and Gantt views by workspace path or view name. Use the returned view ID for a specific project.',
      args => args.query ? `Find HyperTask views matching “${args.query}”` : 'List Kanban and Gantt views',
      (args, signal, fingerprint) => tasks.listViews(args, signal, fingerprint), (_, signal) => tasks.bindWorkspace(signal)),
    tool('hypertask_search_tasks', searchArgs,
      'Find native HyperTask tasks by title or look up a task by row ID. Results include status, assignees and Gantt dates. Use before editing an existing task.',
      args => args.query ? `Find tasks matching “${args.query}”` : 'Read HyperTask tasks',
      (args, signal, fingerprint) => tasks.search(args, signal, fingerprint), (args, signal) => tasks.bind(args, signal)),
    tool('hypertask_find_people', peopleArgs,
      'Find a coworker in the current HyperTask workspace by name or email. Use the returned name and email to tag that person. Ask which person when there are multiple matches.',
      args => `Find workspace coworkers matching “${args.query}”`,
      (args, signal, fingerprint) => tasks.findPeople(args, signal, fingerprint), (_, signal) => tasks.bindWorkspace(signal)),
    tool('hypertask_create_task', createArgs,
      'Create a native HyperTask task in HyperHome General Kanban, a project Kanban, or a Gantt view. Use view discovery for a specific project. Linked views of the same database share the task.',
      args => `Create task “${args.title}”`, (args, signal, fingerprint) => tasks.create(args, signal, fingerprint), (args, signal) => tasks.bind(args, signal)),
    tool('hypertask_update_task', updateArgs,
      'Edit a native HyperTask task’s title, description, status, assignees, or Gantt schedule. Search in the target view to find its row ID. For tagging without removing current assignees, use addAssignees.',
      args => args.title ? `Update task title to “${args.title}”` : 'Update an existing HyperTask task',
      (args, signal, fingerprint) => tasks.update(args, signal, fingerprint), (args, signal) => tasks.bind(args, signal)),
  ];
}
