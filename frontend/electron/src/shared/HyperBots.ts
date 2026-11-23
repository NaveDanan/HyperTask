// HyperBots: bots in rooms, inside HyperTask. Main owns the runtime, storage and connectors;
// the renderer shows rooms, approvals and bot settings over IPC (window.hypertask.hyperBots).
// Connections are the app's own: the OpenAI-compatible endpoint from Settings → AI, classic
// Outlook through HyperOutlookBridge, and the Jira tab's saved settings and credentials.

export type HyperBotsAccess = 'read' | 'write';
export type HyperBotsPolicy = 'ask' | 'allow';
/** Read tools: each can be pre-allowed in Bot settings. */
export type HyperBotsReadToolName = 'outlook_list_events' | 'outlook_get_event' | 'outlook_list_messages' | 'outlook_read_message' | 'outlook_search_people';
export type HyperBotsToolName = HyperBotsReadToolName
  | 'outlook_create_event' | 'outlook_update_event' | 'outlook_forward_event' | 'outlook_respond_meeting'
  | 'outlook_send_message' | 'outlook_reply_message' | 'outlook_forward_message' | 'jira_create_issue';
export type HyperBotsToolGroup = 'outlook-calendar' | 'outlook-mail' | 'jira';
export const HYPER_BOTS_TOOL_GROUPS: Record<HyperBotsToolGroup, string> = { 'outlook-calendar': 'Outlook calendar', 'outlook-mail': 'Outlook mail', jira: 'Jira' };
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
  jira_create_issue: { access: 'write', label: 'Create Jira issues', group: 'jira' },
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
export const HYPER_BOTS_DEFAULT_SETTINGS: HyperBotsSettings = {
  version: 1,
  bots: [
    // Personal assistant defaults include directory search plus calendar/mail create & send (writes always require approval).
    { id: 'scout', name: 'Scout', avatar: { shape: 'sparkle', color: 'blue' }, mode: 'personal', model: '',
      tools: ['outlook_list_events', 'outlook_get_event', 'outlook_create_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people', 'outlook_send_message'],
      instructions: 'You are Scout. You read and manage the owner\'s Outlook calendar, mail, and employee directory, and summarize them clearly. When something needs a Jira ticket, hand it to @scribe with the exact details.' },
    { id: 'scribe', name: 'Scribe', avatar: { shape: 'tablet', color: 'green' }, mode: 'personal', model: '', tools: ['jira_create_issue'],
      instructions: 'You are Scribe. You file concise, actionable Jira issues when asked. Reply with the new issue key.' },
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

export type HyperBotsConnectionState = { ready: true; detail: string } | { ready: false; problem: string };
export interface HyperBotsConnections {
  model: HyperBotsConnectionState & { defaultModel?: string };  // detail e.g. 'gpt-x at https://host/v1'
  outlook: HyperBotsConnectionState;
  jira: HyperBotsConnectionState & { projectKey?: string };
}

export interface HyperBotsSnapshot {
  settings: HyperBotsSettings;
  connections: HyperBotsConnections;
  roomId: string;
  messages: HyperBotsMessage[];      // last 200 of roomId, oldest first
  runs: HyperBotsRunSummary[];       // runs of roomId that are not done, plus the last 20 finished
  approvals: HyperBotsApproval[];    // pending of roomId first, then the last 20 decided
}

export interface HyperBotsPostInput { roomId: string; clientMessageId: string; text: string; model?: string | null }
export interface HyperBotsPosted { message: HyperBotsMessage; created: boolean; runs: HyperBotsRunSummary[] }

export type HyperBotsEvent =
  | { type: 'message'; roomId: string; messageId: string }
  | { type: 'run'; roomId: string; runId: string; status: HyperBotsRunStatus }
  | { type: 'approval'; roomId: string; approvalId: string; status: HyperBotsApprovalStatus }
  | { type: 'settings' };

/** Renderer API. Every call is refused unless it comes from the main window's top frame. */
export interface HyperBotsApi {
  /** Main reads the signed-in user from the core (never from the renderer) and returns that user's room. */
  open(args: { roomId?: string }): Promise<import('./api').IpcResult<HyperBotsSnapshot>>;
  snapshot(args: { roomId: string }): Promise<import('./api').IpcResult<HyperBotsSnapshot>>;
  post(input: HyperBotsPostInput): Promise<import('./api').IpcResult<HyperBotsPosted>>;
  /** `delivery` is required to approve a mail write (HYPER_BOTS_TOOLS[tool].delivery) and refused for any other tool. */
  decide(args: { approvalId: string; approved: boolean; delivery?: HyperBotsDelivery }): Promise<import('./api').IpcResult<HyperBotsApproval>>;
  saveSettings(settings: HyperBotsSettings): Promise<import('./api').IpcResult<HyperBotsSettings>>;
  /** Model IDs offered by the configured endpoint (/models); [] when discovery is unavailable. */
  models(): Promise<import('./api').IpcResult<string[]>>;
  onEvent(listener: (event: HyperBotsEvent) => void): () => void;
}

export const HyperBotsChannel = {
  Open: 'hyper-bots:open',
  Snapshot: 'hyper-bots:snapshot',
  Post: 'hyper-bots:post',
  Decide: 'hyper-bots:decide',
  SaveSettings: 'hyper-bots:save-settings',
  Models: 'hyper-bots:models',
  Event: 'hyper-bots:event',
} as const;
