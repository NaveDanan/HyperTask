import type { HyperBotAssetUpdate, HyperBotSkillLibrary } from './HyperBotSkills';

// HyperBots: bots in rooms, inside HyperTask. Main owns the runtime, storage and connectors;
// the renderer shows rooms, approvals and bot settings over IPC (window.hypertask.hyperBots).
// Connections are the app's own: the OpenAI-compatible endpoint from Settings → AI, classic
// Outlook through HyperOutlookBridge, Jira settings, and the Newsletter connection.

export type HyperBotsAccess = 'read' | 'write';
export type HyperBotsPolicy = 'ask' | 'allow';
export const HYPER_BOTS_PERMISSION_LEVELS = ['supervised', 'elevated', 'full'] as const;
export type HyperBotsPermissionLevel = typeof HYPER_BOTS_PERMISSION_LEVELS[number];
export interface HyperBotsPermissions { level: HyperBotsPermissionLevel; legacyReadOverrides: boolean }
/** Read tools: each can be pre-allowed in Bot settings. */
export type HyperBotsReadToolName = 'outlook_list_events' | 'outlook_get_event' | 'outlook_list_messages' | 'outlook_read_message' | 'outlook_search_people';
export const HYPER_BOTS_PROJECT_TOOLS = ['hypertask_list_task_views', 'hypertask_search_tasks', 'hypertask_find_people', 'hypertask_create_task', 'hypertask_update_task'] as const;
const HYPER_BOTS_JIRA_TOOLS = ['jira_search_issues', 'jira_get_issue', 'jira_get_create_fields', 'jira_create_issue', 'jira_get_edit_fields', 'jira_update_issue', 'jira_list_transitions', 'jira_transition_issue'] as const;
type HyperBotsNewsletterToolName = 'newsletter_list_articles' | 'newsletter_get_article' | 'newsletter_create_article' | 'newsletter_update_article'
  | 'newsletter_list_gantts' | 'newsletter_get_gantt' | 'newsletter_create_gantt' | 'newsletter_update_gantt'
  | 'newsletter_create_gantt_task' | 'newsletter_update_gantt_task';
const OUTLOOK_CALENDAR_REMOVAL = ['outlook_delete_event', 'outlook_cancel_event'] as const;
export type HyperBotsProjectToolName = typeof HYPER_BOTS_PROJECT_TOOLS[number];
export type HyperBotsToolName = HyperBotsReadToolName
  | HyperBotsProjectToolName
  | typeof HYPER_BOTS_JIRA_TOOLS[number] | HyperBotsNewsletterToolName
  | 'outlook_create_event' | 'outlook_update_event' | 'outlook_forward_event' | 'outlook_respond_meeting'
  | 'outlook_delete_event' | 'outlook_cancel_event' | 'outlook_delete_message'
  | 'outlook_send_message' | 'outlook_reply_message' | 'outlook_forward_message';
export const HYPER_BOTS_PERSONAL_TOOLS = [
  'outlook_list_events', 'outlook_get_event', 'outlook_create_event', ...OUTLOOK_CALENDAR_REMOVAL,
  'outlook_list_messages', 'outlook_read_message', 'outlook_search_people', 'outlook_send_message', 'outlook_delete_message',
  ...HYPER_BOTS_PROJECT_TOOLS,
] as const satisfies readonly HyperBotsToolName[];
export type HyperBotsToolGroup = 'outlook-calendar' | 'outlook-mail' | 'jira' | 'hypertask-projects' | 'newsletter';
export const HYPER_BOTS_TOOL_GROUPS: Record<HyperBotsToolGroup, string> = { 'outlook-calendar': 'Outlook calendar', 'outlook-mail': 'Outlook mail', jira: 'Jira', 'hypertask-projects': 'HyperTask projects', newsletter: 'Newsletter' };
export const HYPER_BOTS_TOOL_CONNECTIONS = {
  outlook: { label: 'Outlook', groups: ['outlook-calendar', 'outlook-mail'] },
  jira: { label: 'Jira', groups: ['jira'] },
  newsletter: { label: 'Newsletter', groups: ['newsletter'] },
  projects: { label: 'HyperTask projects', groups: ['hypertask-projects'] },
} satisfies Record<string, { label: string; groups: HyperBotsToolGroup[] }>;
export type HyperBotsToolConnection = keyof typeof HYPER_BOTS_TOOL_CONNECTIONS;
/** What an approved mail write does: send it now, or save it in Outlook Drafts for the owner to send. */
export type HyperBotsDelivery = 'send' | 'draft';
/** `delivery`: the owner picks Send or Save to Drafts when approving. Order is the order shown in Bot settings. */
export const HYPER_BOTS_TOOLS: Record<HyperBotsToolName, { access: HyperBotsAccess; label: string; group: HyperBotsToolGroup; delivery?: true }> = {
  outlook_list_events: { access: 'read', label: 'Read Outlook calendar', group: 'outlook-calendar' },
  outlook_get_event: { access: 'read', label: 'Read an event in full', group: 'outlook-calendar' },
  outlook_create_event: { access: 'write', label: 'Create events and meetings', group: 'outlook-calendar' },
  outlook_update_event: { access: 'write', label: 'Edit meetings', group: 'outlook-calendar' },
  outlook_forward_event: { access: 'write', label: 'Forward meetings', group: 'outlook-calendar' },
  outlook_delete_event: { access: 'write', label: 'Delete appointments', group: 'outlook-calendar' },
  outlook_cancel_event: { access: 'write', label: 'Cancel meetings', group: 'outlook-calendar' },
  outlook_list_messages: { access: 'read', label: 'List Outlook mail', group: 'outlook-mail' },
  outlook_read_message: { access: 'read', label: 'Read Outlook mail', group: 'outlook-mail' },
  outlook_search_people: { access: 'read', label: 'Search Outlook and employee directory', group: 'outlook-mail' },
  outlook_send_message: { access: 'write', label: 'Send mail', group: 'outlook-mail', delivery: true },
  outlook_reply_message: { access: 'write', label: 'Reply to mail', group: 'outlook-mail', delivery: true },
  outlook_forward_message: { access: 'write', label: 'Forward mail', group: 'outlook-mail', delivery: true },
  outlook_delete_message: { access: 'write', label: 'Delete mail', group: 'outlook-mail' },
  outlook_respond_meeting: { access: 'write', label: 'Answer meeting invitations', group: 'outlook-mail', delivery: true },
  jira_search_issues: { access: 'read', label: 'Search Jira issues', group: 'jira' },
  jira_get_issue: { access: 'read', label: 'Read Jira issues', group: 'jira' },
  jira_get_create_fields: { access: 'read', label: 'Read Jira issue creation fields', group: 'jira' },
  jira_create_issue: { access: 'write', label: 'Create Jira issues', group: 'jira' },
  jira_get_edit_fields: { access: 'read', label: 'Read Jira issue editing fields', group: 'jira' },
  jira_update_issue: { access: 'write', label: 'Edit Jira issues', group: 'jira' },
  jira_list_transitions: { access: 'read', label: 'Read Jira status transitions', group: 'jira' },
  jira_transition_issue: { access: 'write', label: 'Change Jira issue status', group: 'jira' },
  hypertask_list_task_views: { access: 'read', label: 'Find Kanban and Gantt views', group: 'hypertask-projects' },
  hypertask_search_tasks: { access: 'read', label: 'Search HyperTask tasks', group: 'hypertask-projects' },
  hypertask_find_people: { access: 'read', label: 'Find workspace coworkers', group: 'hypertask-projects' },
  hypertask_create_task: { access: 'write', label: 'Create HyperTask tasks', group: 'hypertask-projects' },
  hypertask_update_task: { access: 'write', label: 'Edit and assign HyperTask tasks', group: 'hypertask-projects' },
  newsletter_list_articles: { access: 'read', label: 'Search newsletters', group: 'newsletter' },
  newsletter_get_article: { access: 'read', label: 'Read a newsletter', group: 'newsletter' },
  newsletter_create_article: { access: 'write', label: 'Create newsletters', group: 'newsletter' },
  newsletter_update_article: { access: 'write', label: 'Edit newsletters', group: 'newsletter' },
  newsletter_list_gantts: { access: 'read', label: 'List Newsletter Gantt projects', group: 'newsletter' },
  newsletter_get_gantt: { access: 'read', label: 'Read a Newsletter Gantt', group: 'newsletter' },
  newsletter_create_gantt: { access: 'write', label: 'Create Newsletter Gantt projects', group: 'newsletter' },
  newsletter_update_gantt: { access: 'write', label: 'Edit Newsletter Gantt projects', group: 'newsletter' },
  newsletter_create_gantt_task: { access: 'write', label: 'Add Newsletter Gantt tasks', group: 'newsletter' },
  newsletter_update_gantt_task: { access: 'write', label: 'Edit Newsletter Gantt tasks', group: 'newsletter' },
};
export function hyperBotsMailDelivery(tool: string, args: unknown, choice: HyperBotsDelivery): HyperBotsDelivery | null {
  if (!HYPER_BOTS_TOOLS[tool as HyperBotsToolName]?.delivery) return null;
  return (args as { draftOnly?: unknown } | null)?.draftOnly === true ? 'draft' : choice;
}
/** Pre-allowing reads is set per kind in Bot settings: calendar reads, mail reads, and people directory search. */
export const HYPER_BOTS_READ_POLICIES: { label: string; allow: string; tools: HyperBotsReadToolName[] }[] = [
  { label: 'Outlook calendar reads', allow: 'Allow calendar reads without asking', tools: ['outlook_list_events', 'outlook_get_event'] },
  { label: 'Outlook mail reads', allow: 'Allow mail reads without asking', tools: ['outlook_list_messages', 'outlook_read_message'] },
  { label: 'Directory & Outlook people search', allow: 'Allow employee & Outlook contact search without asking', tools: ['outlook_search_people'] },
];
/** A line of an approval card, built in main from the call and what it acts on (sender account, recipients, the message). */
export interface HyperBotsCardRow { label: string; value: string; tone?: 'warning'; long?: boolean }

export const HYPER_BOT_AVATAR_SHAPES = ['blob', 'cloud', 'square', 'sparkle', 'clover', 'heart', 'flower', 'teardrop', 'tablet', 'wedge', 'house', 'star', 'hex'] as const;
export const HYPER_BOT_AVATAR_COLORS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'gray'] as const;
export type HyperBotAvatarShape = typeof HYPER_BOT_AVATAR_SHAPES[number];
export type HyperBotAvatarColor = typeof HYPER_BOT_AVATAR_COLORS[number];
export type HyperBotMode = 'personal' | 'teammate';

export interface HyperBotConfig {
  avatar?: { shape: HyperBotAvatarShape; color: HyperBotAvatarColor };
  mode?: HyperBotMode;
  id: string;           // ^[a-z0-9-]{1,32}$, used in @mentions
  name: string;         // 1..40
  instructions: string; // 0..4000, system prompt
  model: string;        // '' = the endpoint's default model from Settings → AI
  tools: HyperBotsToolName[];
  permissionLevel?: HyperBotsPermissionLevel;
  toolPolicies?: Partial<Record<HyperBotsToolName, HyperBotsPolicy>>;
}
export interface HyperBotsRoom { id: string; name: string; botIds: string[]; kind?: 'direct' | 'group' }
export interface HyperBotsSettings {
  version: 1;
  projectToolsVersion?: 1;
  outlookRemovalVersion?: 1;
  bots: HyperBotConfig[];      // 1..8
  rooms: HyperBotsRoom[];      // 1..24 (8 direct rooms plus up to 16 groups)
  permissionLevel?: HyperBotsPermissionLevel;
  /** Legacy read overrides, honored until the owner selects a permission level. */
  policy: Partial<Record<HyperBotsReadToolName, HyperBotsPolicy>>;
}

const elevatedTools = new Set<HyperBotsToolName>(['outlook_list_events', 'outlook_get_event', 'outlook_list_messages', 'outlook_read_message']);

export function hyperBotsPermissions(settings: HyperBotsSettings, bot?: HyperBotConfig): HyperBotsPermissions {
  const level = bot?.permissionLevel ?? settings.permissionLevel;
  return { level: level ?? 'supervised', legacyReadOverrides: level === undefined && Object.values(settings.policy).includes('allow') };
}

export function hyperBotsToolPolicy(settings: HyperBotsSettings, bot: HyperBotConfig, tool: HyperBotsToolName): HyperBotsPolicy {
  const override = bot.toolPolicies?.[tool];
  if (override) return override;
  const level = bot.permissionLevel ?? settings.permissionLevel;
  if (level === 'full' || (level === 'elevated' && elevatedTools.has(tool))) return 'allow';
  if (level === undefined && settings.policy[tool as HyperBotsReadToolName] === 'allow') return 'allow';
  return 'ask';
}

export function hyperBotSetPermissionLevel(bot: HyperBotConfig, level: HyperBotsPermissionLevel): HyperBotConfig {
  return { ...bot, permissionLevel: level, toolPolicies: undefined };
}

export function hyperBotFindGroup(rooms: readonly HyperBotsRoom[], botIds: readonly string[]) {
  return rooms.find(room => room.kind !== 'direct' && room.botIds.length === botIds.length &&
    botIds.every(id => room.botIds.includes(id)));
}

export function hyperBotUniqueId(name: string, ids: string[], max = 24, fallback = 'bot') {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '') || fallback;
  let id = base, n = 2;
  while (ids.includes(id)) { const tail = '-' + n++; id = base.slice(0, max - tail.length).replace(/-+$/g, '') + tail; }
  return id;
}

export function hyperBotCreateGroup(settings: HyperBotsSettings, name: string, picked: readonly string[], idBase = name) {
  const botIds = settings.bots.filter(bot => picked.includes(bot.id)).map(bot => bot.id);
  if (botIds.length < 2) throw new Error('Choose at least 2 bots for a new group.');
  if (!name.trim() || name.trim().length > 40) throw new Error('Give the group a name (up to 40 characters).');
  if (settings.rooms.filter(room => room.kind !== 'direct').length >= 16) throw new Error('You can have up to 16 group chats.');
  const room = { id: hyperBotUniqueId(idBase, settings.rooms.map(room => room.id), 32, 'group'), name: name.trim(), kind: 'group' as const, botIds };
  return { room, settings: { ...settings, rooms: [...settings.rooms, room] } };
}

export const HYPER_BOTS_DEFAULT_SETTINGS: HyperBotsSettings = {
  version: 1,
  projectToolsVersion: 1,
  outlookRemovalVersion: 1,
  permissionLevel: 'supervised',
  bots: [
    // The personal assistant defaults include Outlook and HyperTask project tools.
    { id: 'scout', name: 'Scout', avatar: { shape: 'sparkle', color: 'blue' }, mode: 'personal', model: '',
      tools: [...HYPER_BOTS_PERSONAL_TOOLS],
      instructions: 'You are Scout. Manage the owner\'s HyperTask tasks and assignments, Outlook calendar and mail, and employee directory. Summarize your work clearly. When something needs a Jira ticket, hand it to @scribe with the exact details.' },
    { id: 'scribe', name: 'Scribe', avatar: { shape: 'tablet', color: 'green' }, mode: 'personal', model: '', tools: [...HYPER_BOTS_JIRA_TOOLS],
      instructions: 'You are Scribe. Find, create, and edit Jira issues when asked. Include the relevant issue keys in your reply.' },
  ],
  rooms: [{ id: 'ops', name: 'Ops', kind: 'group', botIds: ['scout', 'scribe'] }],
  policy: { outlook_list_events: 'ask', outlook_get_event: 'ask', outlook_list_messages: 'ask', outlook_read_message: 'ask', outlook_search_people: 'ask' },
};

/** Add the new capabilities once to the existing default assistant. Later tool choices are retained. */
export function hyperBotsWithProjectTools(settings: HyperBotsSettings): HyperBotsSettings {
  if (settings.projectToolsVersion === 1) return settings;
  return { ...settings, projectToolsVersion: 1, bots: settings.bots.map(bot => bot.id === 'scout'
    ? { ...bot, tools: [...new Set([...bot.tools, ...HYPER_BOTS_PROJECT_TOOLS])] }
    : bot) };
}

/** Upgrade Scout when the matching Outlook integration was already enabled. */
export function hyperBotsWithOutlookRemoval(settings: HyperBotsSettings): HyperBotsSettings {
  if (settings.outlookRemovalVersion === 1) return settings;
  return { ...settings, outlookRemovalVersion: 1, bots: settings.bots.map(bot => {
    if (bot.id !== 'scout') return bot;
    const tools = new Set(bot.tools);
    if (tools.has('outlook_list_events') && tools.has('outlook_create_event')) OUTLOOK_CALENDAR_REMOVAL.forEach(tool => tools.add(tool));
    if (tools.has('outlook_list_messages') && tools.has('outlook_send_message')) tools.add('outlook_delete_message');
    return { ...bot, tools: [...tools] };
  }) };
}

/** Add direct rooms without mutating settings. Legacy rooms remain group conversations. */
export function hyperBotsWithDirectRooms(settings: HyperBotsSettings): HyperBotsSettings {
  const rooms: HyperBotsRoom[] = settings.rooms.map(room => ({ ...room, kind: room.kind ?? 'group' }));
  const ids = new Set(rooms.map(room => room.id));
  for (const bot of settings.bots) {
    if (rooms.some(room => room.kind === 'direct' && room.botIds.length === 1 && room.botIds[0] === bot.id)) continue;
    const base = ('dm-' + bot.id).slice(0, 32);
    let id = base, suffix = 2;
    while (ids.has(id)) { const tail = '-' + suffix++; id = base.slice(0, 32 - tail.length) + tail; }
    ids.add(id);
    rooms.push({ id, name: bot.name, kind: 'direct', botIds: [bot.id] });
  }
  return { ...settings, rooms };
}

export type HyperBotsAuthor = { kind: 'user' } | { kind: 'bot'; botId: string };
export interface HyperBotsMessage {
  id: string; roomId: string; clientMessageId: string; author: HyperBotsAuthor; text: string;
  model: string | null; runId: string | null; hop: number; createdAt: string;
  a2ui?: import('./HyperBotA2ui').HyperBotA2uiMessage[];
  interaction?: import('./HyperBotA2ui').HyperBotA2uiInteraction;
}
export type HyperBotsRunStatus = 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed';
export interface HyperBotsRunSummary {
  id: string; roomId: string; botId: string; triggerMessageId: string; model: string;
  status: HyperBotsRunStatus; steps: number; error: string | null; createdAt: string; updatedAt: string;
}
// 'skipped': the call was never made because the bot lost the tool or the request no longer applies.
export type HyperBotsApprovalStatus = 'pending' | 'approved' | 'denied' | 'executing' | 'done' | 'failed' | 'unknown' | 'skipped';
export interface HyperBotsApproval {
  id: string; runId: string; roomId: string; botId: string; toolCallId: string; tool: string; access: HyperBotsAccess;
  /** Original owner message, shared by every bot and hand-off in this turn. */
  turnId?: string;
  args: unknown; summary: string;
  /** Where the call goes, captured when it was proposed (e.g. 'Jira project OPS at https://jira.example as nave'). */
  destination: string | null;
  /** What the owner approves, line by line (sender, recipients, the text, the message acted on); null for tools without one. */
  card: HyperBotsCardRow[] | null;
  /** For mail writes: Send or Save to Drafts, chosen by the owner when approving. */
  delivery: HyperBotsDelivery | null;
  status: HyperBotsApprovalStatus; decidedBy: 'policy' | 'owner' | null;
  result: string | null; error: string | null; createdAt: string; updatedAt: string;
}

export type HyperBotsConnectionState = { ready: true; detail: string } | { ready: false; problem: string; checking?: boolean };
export interface HyperBotsConnections {
  model: HyperBotsConnectionState & { defaultModel?: string };  // detail e.g. 'gpt-x at https://host/v1'
  outlook: HyperBotsConnectionState;
  jira: HyperBotsConnectionState & { projectKey?: string };
  newsletter?: HyperBotsConnectionState;
}

export interface HyperNewsletterConnectionState { baseUrl: string; gantt: boolean }
export interface HyperNewsletterConnectionInput { baseUrl: string; token: string }

export interface HyperBotsSnapshot {
  settings: HyperBotsSettings;
  connections: HyperBotsConnections;
  roomId: string;
  messages: HyperBotsMessage[];      // oldest first
  hasEarlier?: boolean;

  roomSummaries?: Record<string, { preview: string; activeRun: boolean; pendingApprovals: number }>;
  runs: HyperBotsRunSummary[];       // active runs and completed runs in the requested window
  approvals: HyperBotsApproval[];    // pending requests and decisions associated with the window
}

export interface HyperBotsPostInput { roomId: string; clientMessageId: string; text: string; model?: string | null }
export interface HyperBotsPosted { message: HyperBotsMessage; created: boolean; runs: HyperBotsRunSummary[] }

export type HyperBotsEvent =
  | { type: 'message'; roomId: string; messageId: string }
  | { type: 'run'; roomId: string; runId: string; status: HyperBotsRunStatus }
  | { type: 'approval'; roomId: string; approvalId: string; status: HyperBotsApprovalStatus }
  | { type: 'settings' }
  | { type: 'skills' }
  | { type: 'personalization'; botId: string }
  | { type: 'connections' };

/** Renderer API. Every call is refused unless it comes from the main window's top frame. */
export interface HyperBotsApi {
  /** Main reads the signed-in user from the core (never from the renderer) and returns that user's room. */
  open(args: { roomId?: string; limit?: number }): Promise<import('./api').IpcResult<HyperBotsSnapshot>>;
  snapshot(args: { roomId: string; limit?: number; fromMessageId?: string }): Promise<import('./api').IpcResult<HyperBotsSnapshot>>;
  post(input: HyperBotsPostInput): Promise<import('./api').IpcResult<HyperBotsPosted>>;
  act(input: import('./HyperBotA2ui').HyperBotA2uiInteraction & { roomId: string; clientMessageId: string }): Promise<import('./api').IpcResult<HyperBotsPosted>>;
  /** Decides once for the whole turn. Delivery applies to mail writes in the turn. */
  decide(args: { approvalId: string; approved: boolean; delivery?: HyperBotsDelivery }): Promise<import('./api').IpcResult<HyperBotsApproval>>;
  saveSettings(settings: HyperBotsSettings): Promise<import('./api').IpcResult<HyperBotsSettings>>;
  permissions(input?: HyperBotsPermissionLevel | { botId: string; level?: HyperBotsPermissionLevel }): Promise<import('./api').IpcResult<HyperBotsPermissions>>;
  skills(): Promise<import('./api').IpcResult<HyperBotSkillLibrary>>;
  saveSkill(input: HyperBotAssetUpdate): Promise<import('./api').IpcResult<HyperBotSkillLibrary>>;
  personalization(input: { botId: string }): Promise<import('./api').IpcResult<import('./HyperBotPersonalization').HyperBotPersonalizationView>>;
  savePersonalization(input: import('./HyperBotPersonalization').HyperBotPersonalizationUpdate): Promise<import('./api').IpcResult<import('./HyperBotPersonalization').HyperBotPersonalizationView>>;
  /** Model IDs offered by the configured endpoint (/models); [] when discovery is unavailable. */
  models(): Promise<import('./api').IpcResult<string[]>>;
  newsletterConnection(): Promise<import('./api').IpcResult<HyperNewsletterConnectionState | null>>;
  saveNewsletterConnection(connection: HyperNewsletterConnectionInput | null): Promise<import('./api').IpcResult<HyperNewsletterConnectionState | null>>;
  onEvent(listener: (event: HyperBotsEvent) => void): () => void;
}

export const HyperBotsChannel = {
  Open: 'hyper-bots:open',
  Snapshot: 'hyper-bots:snapshot',
  Post: 'hyper-bots:post',
  Act: 'hyper-bots:act',
  Decide: 'hyper-bots:decide',
  SaveSettings: 'hyper-bots:save-settings',
  Permissions: 'hyper-bots:permissions',
  Skills: 'hyper-bots:skills',
  SaveSkill: 'hyper-bots:save-skill',
  Personalization: 'hyper-bots:personalization',
  SavePersonalization: 'hyper-bots:save-personalization',
  Models: 'hyper-bots:models',
  NewsletterConnection: 'hyper-bots:newsletter-connection',
  SaveNewsletterConnection: 'hyper-bots:save-newsletter-connection',
  Event: 'hyper-bots:event',
} as const;
