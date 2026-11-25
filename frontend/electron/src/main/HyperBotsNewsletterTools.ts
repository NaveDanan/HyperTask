import { z } from 'zod';
import { hyperBotsHttpTools, type HyperBotsHttpAccess, type HyperBotsHttpDeps } from './HyperBotsHttpTools';
import { HyperBotsToolError } from './HyperBotsRuntime';

const identifier = z.string().trim().regex(/^[\w-]{1,128}$/);
const title = z.string().trim().min(1).max(500);
const articleStatus = z.enum(['draft', 'published']);
const ganttStatus = z.enum(['pending', 'in-progress', 'completed', 'delayed']);
const offset = z.int().min(0).default(0);
const limit = z.int().min(1).max(20).default(10);
const articlePath = (id: string) => '/api/newsletters/' + id;
const projectPath = (id: string) => '/api/projects/' + id;
const articleFields = {
  subtitle: z.string().max(500).optional(), content: z.string().max(50_000).describe('Article body in HTML.').optional(),
  excerpt: z.string().max(2000).optional(), author: z.string().max(255).optional(),
  tags: z.array(z.string().max(80)).max(30).optional(), status: articleStatus.optional(),
  textAlignment: z.enum(['left', 'center', 'right', 'justify']).optional(),
};
const taskFields = {
  startDate: z.iso.date().optional(), durationDays: z.int().min(1).max(3650).optional(), status: ganttStatus.optional(),
  progress: z.int().min(0).max(100).optional(), predecessorIds: z.array(identifier).max(100).optional(),
  resourceId: identifier.nullable().optional(), milestone: z.boolean().optional(),
};
const chart = z.strictObject({
  tasks: z.array(z.strictObject({ ...taskFields, id: identifier, name: title, durationDays: z.int().min(0).max(3650).optional(),
    indentLevel: z.int().min(0).max(20).optional(), endDate: z.iso.date().optional() })).max(200),
  resources: z.array(z.record(z.string(), z.unknown())).max(100),
  roles: z.array(z.record(z.string(), z.unknown())).max(100),
  zoom: z.enum(['day', 'week', 'month', 'quarter']),
});
const projectFields = {
  description: z.string().max(4000).optional(), department: z.string().max(255).optional(),
  devision: z.string().max(255).describe('Project division.').optional(), field: z.string().max(255).optional(),
  status: ganttStatus.optional(), isVisibleInGantt: z.boolean().optional(),
};
const nonempty = (value: object) => Object.keys(value).length > 0;
function record(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new HyperBotsToolError('transport', 'Newsletter returned an unexpected response.');
  }
  return response as Record<string, unknown>;
}
function savedRecord(response: unknown) {
  const { id, title, name, status, updated } = record(response);
  if (typeof id !== 'string' || !id) throw new HyperBotsToolError('transport', 'Newsletter did not return a record ID. Check the site before retrying.');
  return { id, title, name, status, updated };
}
function savedTask(response: unknown) {
  savedRecord(response);
  return response;
}
function page(items: unknown[], start: number, size: number) {
  return { items: items.slice(start, start + size), totalItems: items.length, nextOffset: start + size < items.length ? start + size : null };
}

export function hyperBotsNewsletterTools(deps: HyperBotsHttpDeps<HyperBotsHttpAccess & { fingerprint: string }>) {
  const tool = hyperBotsHttpTools('Newsletter', deps, access => ({ destination: 'Newsletter at ' + access.baseUrl, fingerprint: access.fingerprint }));
  return [
    tool({
      name: 'newsletter_list_articles', access: 'read',
      description: 'Search published newsletters and drafts accessible to the connected account.',
      schema: z.strictObject({ query: z.string().trim().max(500).optional(), status: articleStatus.optional(),
        page: z.int().min(1).default(1), perPage: limit }),
      summarize: args => `Search newsletters${args.query ? ' for ' + args.query : ''}`,
      request: args => {
        const query = new URLSearchParams({ view: 'summary', compact: '1', page: String(args.page), perPage: String(args.perPage) });
        if (args.status) query.set('status', args.status);
        if (args.query) query.set('q', args.query);
        return { path: '/api/newsletters?' + query };
      },
      result: response => {
        const { items, ...paging } = record(response);
        if (!Array.isArray(items)) throw new HyperBotsToolError('transport', 'Newsletter returned an invalid article list.');
        return { ...paging, items: items.map(item => {
          const { id, title, subtitle, status, author, excerpt, updated } = record(item);
          return { id, title: String(title ?? '').slice(0, 500), subtitle: String(subtitle ?? '').slice(0, 300),
            status, author: String(author ?? '').slice(0, 255), excerpt, updated };
        }) };
      },
    }),
    tool({
      name: 'newsletter_get_article', access: 'read',
      description: 'Read a newsletter by ID. If nextContentOffset is present, pass it as contentOffset to read the next part of the HTML.',
      schema: z.strictObject({ articleId: identifier, contentOffset: offset }),
      summarize: args => `Read newsletter ${args.articleId}`,
      request: ({ articleId, contentOffset }) => ({ path: articlePath(articleId) + '?contentOffset=' + contentOffset }),
    }),
    tool({
      name: 'newsletter_create_article', access: 'write',
      description: 'Create a newsletter article. Use status published only when asked to publish. New articles otherwise start as drafts.',
      schema: z.strictObject({ ...articleFields, title, content: z.string().min(1).max(50_000).describe('Article body in HTML.') }),
      summarize: args => `Create newsletter ${args.status === 'published' ? 'and publish' : 'draft'} "${args.title}"`,
      request: args => ({ path: '/api/newsletters', method: 'POST', body: args }),
      result: savedRecord,
    }),
    tool({
      name: 'newsletter_update_article', access: 'write',
      description: 'Edit a newsletter. Pass only the fields to change. The content field replaces the article HTML.',
      schema: z.strictObject({ articleId: identifier, changes: z.strictObject({ ...articleFields, title: title.optional() }).refine(nonempty) }),
      summarize: ({ articleId, changes }) => `Edit newsletter ${articleId}${changes.status ? ' and set status to ' + changes.status : ''}`,
      request: ({ articleId, changes }) => ({ path: articlePath(articleId), method: 'PATCH', body: changes }),
      result: savedRecord,
    }),
    tool({
      name: 'newsletter_list_gantts', access: 'read',
      description: 'List accessible Newsletter Gantt projects. Filter by project title and use nextOffset to continue.',
      schema: z.strictObject({ query: z.string().trim().max(500).optional(), offset, limit }),
      summarize: args => `List Newsletter Gantt projects${args.query ? ' matching ' + args.query : ''}`,
      request: () => ({ path: '/api/projects?view=summary' }),
      result: (response, args) => {
        const { items } = record(response);
        if (!Array.isArray(items)) throw new HyperBotsToolError('transport', 'Newsletter returned an invalid project list.');
        const query = args.query?.toLowerCase() ?? '';
        return page(items.filter(item => String(record(item).title ?? '').toLowerCase().includes(query)), args.offset, args.limit);
      },
    }),
    tool({
      name: 'newsletter_get_gantt', access: 'read',
      description: 'Read a Newsletter project, its resources and roles, and a page of Gantt tasks. Use nextOffset to continue. Use updated as expectedUpdatedAt when replacing a chart.',
      schema: z.strictObject({ projectId: identifier, offset, limit }),
      summarize: args => `Read Newsletter Gantt ${args.projectId}`,
      request: args => ({ path: projectPath(args.projectId) }),
      result: (response, args) => {
        const { id, title, description, department, devision, field, status, isVisibleInGantt, updated, gantt } = record(response);
        const { tasks, resources, roles, zoom, lastEditedAt } = record(gantt);
        if (!Array.isArray(tasks)) throw new HyperBotsToolError('transport', 'Newsletter returned an invalid Gantt.');
        const { items, ...paging } = page(tasks, args.offset, args.limit);
        return { id, title, description, department, devision, field, status, isVisibleInGantt, updated,
          gantt: { resources, roles, zoom, lastEditedAt, tasks: items, ...paging } };
      },
    }),
    tool({
      name: 'newsletter_create_gantt', access: 'write',
      description: 'Create a Newsletter project with a Gantt. Optionally include the initial tasks, resources, roles and zoom.',
      schema: z.strictObject({ ...projectFields, title, gantt: chart.optional() }),
      summarize: args => `Create Newsletter Gantt "${args.title}"`,
      request: args => ({ path: '/api/projects', method: 'POST', body: args }),
      result: savedRecord,
    }),
    tool({
      name: 'newsletter_update_gantt', access: 'write',
      description: 'Edit project details or replace a complete Gantt chart. Chart replacement requires the latest updated timestamp from newsletter_get_gantt and all tasks, resources and roles. Use task tools for individual task edits.',
      schema: z.strictObject({ projectId: identifier, expectedUpdatedAt: z.string().min(1).max(100).optional(),
        changes: z.strictObject({ ...projectFields, title: title.optional(), gantt: chart.optional() }).refine(nonempty) })
        .refine(args => !args.changes.gantt || !!args.expectedUpdatedAt, 'Fetch the current Gantt and provide expectedUpdatedAt.'),
      summarize: ({ projectId, changes }) => `${changes.gantt ? 'Replace chart for' : 'Edit'} Newsletter Gantt ${projectId}`,
      request: ({ projectId, changes, expectedUpdatedAt }) => ({ path: projectPath(projectId), method: 'PATCH', body: { ...changes, expectedUpdatedAt } }),
      result: savedRecord,
    }),
    tool({
      name: 'newsletter_create_gantt_task', access: 'write',
      description: 'Add a task or milestone to a Newsletter Gantt. Pass parentTaskId to create a subtask.',
      schema: z.strictObject({ ...taskFields, projectId: identifier, parentTaskId: identifier.optional(), id: identifier.optional(), name: title }),
      summarize: args => `Add "${args.name}" to Newsletter Gantt ${args.projectId}`,
      request: ({ projectId, parentTaskId, ...body }) => ({
        path: projectPath(projectId) + '/tasks' + (parentTaskId ? `/${parentTaskId}/subtasks` : ''), method: 'POST', body,
      }),
      result: savedTask,
    }),
    tool({
      name: 'newsletter_update_gantt_task', access: 'write',
      description: 'Edit an existing Gantt task or milestone. Use both the project and task IDs.',
      schema: z.strictObject({ projectId: identifier, taskId: identifier, changes: z.strictObject({
        ...taskFields, name: title.optional(), indentLevel: z.int().min(0).max(20).optional(),
      }).refine(nonempty) }),
      summarize: args => `Edit task ${args.taskId} in Newsletter Gantt ${args.projectId}`,
      request: ({ projectId, taskId, changes }) => ({ path: projectPath(projectId) + '/tasks/' + taskId, method: 'PATCH', body: changes }),
      result: savedTask,
    }),
  ];
}
