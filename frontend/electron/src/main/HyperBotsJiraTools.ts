import { z } from 'zod';
import { hyperBotsJiraBinding, hyperBotsJiraTool, type HyperBotsJiraAccess } from './HyperBotsConnectors';
import { hyperBotsHttpTools, type HyperBotsHttpDeps } from './HyperBotsHttpTools';
import { HyperBotsToolError } from './HyperBotsRuntime';

const issueKey = z.string().trim().regex(/^(?:[a-z][a-z0-9_]*-\d+|\d+)$/i).max(100).toUpperCase();
const projectKey = z.string().trim().regex(/^[a-z][a-z0-9_]*$/i).max(50).toUpperCase();
const fieldNames = z.array(z.string().regex(/^[*\w-]+$/).max(80)).min(1).max(30);
const fields = z.record(z.string().regex(/^[\w-]+$/), z.unknown());
const issuePath = (key: string) => '/rest/api/2/issue/' + key;

export function hyperBotsJiraTools(deps: HyperBotsHttpDeps<HyperBotsJiraAccess>) {
  const tool = hyperBotsHttpTools('Jira', deps, access => ({
    ...hyperBotsJiraBinding(access), destination: `Jira at ${access.baseUrl} as ${access.username || 'token'}`,
  }));
  return [
    tool({
      name: 'jira_search_issues', access: 'read',
      description: 'Search issues across accessible Jira projects using JQL. Defaults to the configured project. Use nextPageToken (Cloud) or startAt (Data Center) to continue.',
      schema: z.strictObject({ jql: z.string().trim().min(1).max(4000).optional(), fields: fieldNames.optional(),
        maxResults: z.int().min(1).max(20).default(10), startAt: z.int().min(0).optional(), nextPageToken: z.string().min(1).max(4000).optional() }),
      summarize: args => `Search Jira issues${args.jql ? ' using ' + args.jql : ''}`,
      request: ({ jql, fields, maxResults, startAt, nextPageToken }, access) => {
        const host = new URL(access.baseUrl).hostname;
        const cloud = host.endsWith('.atlassian.net') || host === 'api.atlassian.com' || nextPageToken !== undefined;
        const query = { jql: jql ?? 'project = ' + JSON.stringify(access.projectKey), maxResults,
          fields: fields ?? ['summary', 'issuetype', 'status', 'priority', 'assignee', 'updated'] };
        return cloud
          ? { path: '/rest/api/2/search/jql', method: 'POST', body: { ...query, nextPageToken } }
          : { path: '/rest/api/2/search', method: 'POST', body: { ...query, startAt: startAt ?? 0 } };
      },
    }),
    tool({
      name: 'jira_get_issue', access: 'read',
      description: 'Fetch a Jira issue or task by key or numeric ID. Pass fields to select specific fields such as description, customfield_12345, or parent.',
      schema: z.strictObject({ issueKey, fields: fieldNames.optional() }),
      summarize: args => `Read Jira issue ${args.issueKey}`,
      request: args => ({ path: issuePath(args.issueKey) + (args.fields ? '?fields=' + encodeURIComponent(args.fields.join(',')) : '') }),
    }),
    tool({
      name: 'jira_get_create_fields', access: 'read',
      description: 'List issue types for a Jira project, or list the create fields and required values for a specific issueTypeId.',
      schema: z.strictObject({ projectKey: projectKey.optional(), issueTypeId: z.string().regex(/^\d{1,30}$/).optional(), startAt: z.int().min(0).default(0) }),
      summarize: args => `Read Jira create requirements${args.projectKey ? ' for ' + args.projectKey : ''}`,
      request: (args, access) => ({
        path: '/rest/api/2/issue/createmeta/' + encodeURIComponent(args.projectKey ?? access.projectKey) + '/issuetypes'
          + (args.issueTypeId ? '/' + args.issueTypeId : '') + '?maxResults=10&startAt=' + args.startAt,
      }),
    }),
    hyperBotsJiraTool(deps),
    tool({
      name: 'jira_get_edit_fields', access: 'read',
      description: 'Fetch edit metadata for a Jira issue, including editable field names and allowed options.',
      schema: z.strictObject({ issueKey }),
      summarize: args => `Read Jira edit fields for ${args.issueKey}`,
      request: args => ({ path: issuePath(args.issueKey) + '/editmeta' }),
    }),
    tool({
      name: 'jira_update_issue', access: 'write',
      description: 'Edit one Jira issue. Use native REST v2 field values for summary, plain-text description, labels, assignee, and custom fields. Use jira_transition_issue for status changes.',
      schema: z.strictObject({ issueKey, fields: fields.refine(value => Object.keys(value).length > 0 && !Object.hasOwn(value, 'status'), 'Provide editable fields. Use a transition to change status.') }),
      summarize: args => `Edit Jira issue ${args.issueKey} (${Object.keys(args.fields).join(', ')})`,
      request: args => ({ path: issuePath(args.issueKey), method: 'PUT', body: { fields: args.fields } }),
      result: (response, args, access) => {
        if (response !== null) throw new HyperBotsToolError('transport', 'Jira returned an unexpected response after editing the issue.');
        return { issueKey: args.issueKey, url: access.baseUrl + '/browse/' + args.issueKey, updated: true };
      },
    }),
    tool({
      name: 'jira_list_transitions', access: 'read',
      description: 'List available status transitions and any required transition fields for a Jira issue.',
      schema: z.strictObject({ issueKey }),
      summarize: args => `Read Jira transitions for ${args.issueKey}`,
      request: args => ({ path: issuePath(args.issueKey) + '/transitions?expand=transitions.fields' }),
    }),
    tool({
      name: 'jira_transition_issue', access: 'write',
      description: 'Change a Jira issue status using a transition ID returned by jira_list_transitions. Pass fields required by the transition.',
      schema: z.strictObject({ issueKey, transitionId: z.string().regex(/^\d{1,30}$/), fields: fields.optional() }),
      summarize: args => `Apply Jira transition ${args.transitionId} to ${args.issueKey}`,
      request: args => ({ path: issuePath(args.issueKey) + '/transitions', method: 'POST', body: { transition: { id: args.transitionId }, fields: args.fields } }),
      result: (response, args) => {
        if (response !== null) throw new HyperBotsToolError('transport', 'Jira returned an unexpected response after transitioning the issue.');
        return { issueKey: args.issueKey, transitionId: args.transitionId, updated: true };
      },
    }),
  ];
}
