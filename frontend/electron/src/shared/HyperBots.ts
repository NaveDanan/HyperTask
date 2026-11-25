// HyperBots: bots in rooms, inside HyperTask. Main owns the runtime, storage and connectors;
// the renderer shows rooms, approvals and bot settings over IPC (window.hypertask.hyperBots).
// Connections are the app's own: the OpenAI-compatible endpoint from Settings → AI, classic
// Outlook through HyperOutlookBridge, Jira settings, and the Newsletter connection.

export type HyperBotsAccess = 'read' | 'write';
export type HyperBotsPolicy = 'ask' | 'allow';
/** Read tools: each can be pre-allowed in Bot settings. */
export type HyperBotsReadToolName = 'outlook_list_events' | 'outlook_get_event' | 'outlook_list_messages' | 'outlook_read_message' | 'outlook_search_people';
const HYPER_BOTS_JIRA_TOOLS = ['jira_search_issues', 'jira_get_issue', 'jira_get_create_fields', 'jira_create_issue', 'jira_get_edit_fields', 'jira_update_issue', 'jira_list_transitions', 'jira_transition_issue'] as const;
type HyperBotsNewsletterToolName = 'newsletter_list_articles' | 'newsletter_get_article' | 'newsletter_create_article' | 'newsletter_update_article'
  | 'newsletter_list_gantts' | 'newsletter_get_gantt' | 'newsletter_create_gantt' | 'newsletter_update_gantt'
  | 'newsletter_create_gantt_task' | 'newsletter_update_gantt_task';
export type HyperBotsToolName = HyperBotsReadToolName
  | typeof HYPER_BOTS_JIRA_TOOLS[number] | HyperBotsNewsletterToolName
  | 'outlook_create_event' | 'outlook_update_event' | 'outlook_forward_event' | 'outlook_respond_meeting'
  | 'outlook_send_message' | 'outlook_reply_message' | 'outlook_forward_message';
export type HyperBotsToolGroup = 'outlook-calendar' | 'outlook-mail' | 'jira' | 'newsletter';
export const HYPER_BOTS_TOOL_GROUPS: Record<HyperBotsToolGroup, string> = { 'outlook-calendar': 'Outlook calendar', 'outlook-mail': 'Outlook mail', jira: 'Jira', newsletter: 'Newsletter' };
/** What an approved mail write does: send it now, or save it in Outlook Drafts for the owner to send. */
export type HyperBotsDelivery = 'send' | 'draft';
/** `delivery`: the owner picks Send or Save to Drafts when approving. Order is the order shown in Bot settings. */
export const HYPER_BOTS_TOOLS: Record<HyperBotsToolName, { access: HyperBotsAccess; label: string; group: HyperBotsToolGroup; delivery?: true }> = {
  outlook_list_events: { access: 'read', label: 'Read Outlook calendar', group: 'outlook-calendar' },
  outlook_get_event: { access: 'read', label: 'Read an event in full', group: 'outlook-calendar' },
  outlook_create_event: { access: 'write', label: 'Create events and meetings', group: 'outlook-calendar' },
  outlook_update_event: { access: 'write', label: 'Edit meetings', group: 'outlook-calendar' },
  outlook_forward_event: { access: 'write', label: 'Forward meetings', group: 'outlook-calendar' },
  outlook_list_messages: { access: 'read', label: 'List Outlook mail', group: 'outlook-mail' },
  outlook_read_message: { access: 'read', label: 'Read Outlook mail', group: 'outlook-mail' },
  outlook_search_people: { access: 'read', label: 'Search Outlook and employee directory', group: 'outlook-mail' },
  outlook_send_message: { access: 'write', label: 'Send mail', group: 'outlook-mail', delivery: true },
  outlook_reply_message: { access: 'write', label: 'Reply to mail', group: 'outlook-mail', delivery: true },
  outlook_forward_message: { access: 'write', label: 'Forward mail', group: 'outlook-mail', delivery: true },
  outlook_respond_meeting: { access: 'write', label: 'Answer meeting invitations', group: 'outlook-mail', delivery: true },
  jira_search_issues: { access: 'read', label: 'Search Jira issues', group: 'jira' },
  jira_get_issue: { access: 'read', label: 'Read Jira issues', group: 'jira' },
  jira_get_create_fields: { access: 'read', label: 'Read Jira issue creation fields', group: 'jira' },
  jira_create_issue: { access: 'write', label: 'Create Jira issues', group: 'jira' },
  jira_get_edit_fields: { access: 'read', label: 'Read Jira issue editing fields', group: 'jira' },
  jira_update_issue: { access: 'write', label: 'Edit Jira issues', group: 'jira' },
  jira_list_transitions: { access: 'read', label: 'Read Jira status transitions', group: 'jira' },
  jira_transition_issue: { access: 'write', label: 'Change Jira issue status', group: 'jira' },
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
}
export interface HyperBotsRoom { id: string; name: string; botIds: string[]; kind?: 'direct' | 'group' }
export interface HyperBotsSettings {
  version: 1;
  bots: HyperBotConfig[];      // 1..8
  rooms: HyperBotsRoom[];      // 1..24 (8 direct rooms plus up to 16 groups)
  policy: Partial<Record<HyperBotsReadToolName, HyperBotsPolicy>>; // a read tool left out asks; writes always ask
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
  bots: [
    // Personal assistant defaults include directory search plus calendar/mail create & send (writes always require approval).
    { id: 'scout', name: 'Scout', avatar: { shape: 'sparkle', color: 'blue' }, mode: 'personal', model: '',
      tools: ['outlook_list_events', 'outlook_get_event', 'outlook_create_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people', 'outlook_send_message'],
      instructions: 'You are Scout. You read and manage the owner\'s Outlook calendar, mail, and employee directory, and summarize them clearly. When something needs a Jira ticket, hand it to @scribe with the exact details.' },
    { id: 'scribe', name: 'Scribe', avatar: { shape: 'tablet', color: 'green' }, mode: 'personal', model: '', tools: [...HYPER_BOTS_JIRA_TOOLS],
      instructions: 'You are Scribe. Find, create, and edit Jira issues when asked. Include the relevant issue keys in your reply.' },
  ],
  rooms: [{ id: 'ops', name: 'Ops', kind: 'group', botIds: ['scout', 'scribe'] }],
  policy: { outlook_list_events: 'ask', outlook_get_event: 'ask', outlook_list_messages: 'ask', outlook_read_message: 'ask', outlook_search_people: 'ask' },
};

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
  args: unknown; summary: string;
  /** Where the call goes, captured when it was proposed (e.g. 'Jira project OPS at https://jira.example as nave'). A change before execution sends it back for approval. */
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
  | { type: 'connections' };

/** Renderer API. Every call is refused unless it comes from the main window's top frame. */
export interface HyperBotsApi {
  /** Main reads the signed-in user from the core (never from the renderer) and returns that user's room. */
  open(args: { roomId?: string; limit?: number }): Promise<import('./api').IpcResult<HyperBotsSnapshot>>;
  snapshot(args: { roomId: string; limit?: number; fromMessageId?: string }): Promise<import('./api').IpcResult<HyperBotsSnapshot>>;
  post(input: HyperBotsPostInput): Promise<import('./api').IpcResult<HyperBotsPosted>>;
  /** `delivery` is required to approve a mail write (HYPER_BOTS_TOOLS[tool].delivery) and refused for any other tool. */
  decide(args: { approvalId: string; approved: boolean; delivery?: HyperBotsDelivery }): Promise<import('./api').IpcResult<HyperBotsApproval>>;
  saveSettings(settings: HyperBotsSettings): Promise<import('./api').IpcResult<HyperBotsSettings>>;
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
  Decide: 'hyper-bots:decide',
  SaveSettings: 'hyper-bots:save-settings',
  Models: 'hyper-bots:models',
  NewsletterConnection: 'hyper-bots:newsletter-connection',
  SaveNewsletterConnection: 'hyper-bots:save-newsletter-connection',
  Event: 'hyper-bots:event',
} as const;
