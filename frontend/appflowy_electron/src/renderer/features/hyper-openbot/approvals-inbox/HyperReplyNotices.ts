// Copyright (c) 2026 CopilotKit. MIT. See ../LICENSE and REUSE.md.
import { HyperConversationTag, HyperInSight, HyperShowNotice, HyperNotificationPermissionState, type HyperNotice } from './HyperNotifications';
export type HyperChannelActivityEvent = {
  channelId: string; lastMessageAgentId: string | null; lastMessage: string | null; firstLine?: string | null;
  summary?: unknown; opening?: unknown; pinned?: unknown; busy?: boolean; work?: unknown; deleted?: unknown;
};
export type HyperBotNotify = 'all' | 'needs_input' | 'none';
export type HyperNoticeBot = { agentId: string; name: string; waitingIn?: string | null };
export type HyperNoticeAgent = { id: string; name: string };
/** The conversations owner supplies fresh reads from its existing roster/event subscription. */
export interface HyperReplyNoticeReads {
  attention(): Promise<HyperNoticeBot[]>;
  notify(agentId: string): Promise<HyperBotNotify | null>;
  agents(): HyperNoticeAgent[] | undefined;
}
const HyperNotificationsAllowed = async () => HyperNotificationPermissionState() === 'granted';
/**
 * A notification when a Bot replies while OpenBot is out of sight: what the offer to turn them on
 * promises with "when your Bot finishes". It comes off the roster's socket, which hears every reply
 * in every conversation the person is in, whoever started the run: this tab, another one, a routine
 * or a hand-off.
 */

/** A Bot's message, as the socket announces it: never a person's, a name, a pin or a busy dot. */
export function HyperIsBotReply(activity: HyperChannelActivityEvent): boolean {
  return (
    activity.lastMessageAgentId !== null &&
    activity.lastMessage !== null &&
    activity.summary === undefined &&
    activity.opening === undefined &&
    activity.pinned === undefined &&
    activity.busy === undefined &&
    activity.work === undefined &&
    activity.deleted === undefined
  );
}

/** The tag is one per reply, so two open tabs show one notice; the path is the conversation. */
export type HyperReplyNoticeData = Omit<HyperNotice, "onClick">;

/**
 * What one reply's notice says, or null when there is none to show: not a Bot's reply, or a Bot the
 * person told to reach them only when it needs them, or never. `notify` is the Bot's own setting,
 * read from the Bot (`/lifecycle`): the attention list names only Bots with something waiting, so a
 * Bot missing from it says nothing about its setting. Unknown, there is no notice.
 */
export function HyperReplyNotice(
  activity: HyperChannelActivityEvent,
  notify: HyperBotNotify | null,
  bots: readonly HyperNoticeBot[] | undefined,
  agents: readonly Pick<HyperNoticeAgent, "id" | "name">[] | undefined,
): HyperReplyNoticeData | null {
  if (!HyperIsBotReply(activity)) return null;
  if (notify !== "all") return null;
  const agentId = activity.lastMessageAgentId;
  const bot = bots?.find((each) => each.agentId === agentId);
  const name = bot?.name ?? agents?.find((each) => each.id === agentId)?.name;
  // A server older than `firstLine` sends only the preview, every line run into one.
  const body =
    typeof activity.firstLine === "string"
      ? activity.firstLine
      : (activity.lastMessage ?? "");
  return {
    title: name ? `${name} replied` : "Your Bot replied",
    body,
    tag: HyperConversationTag(activity.channelId),
    path: `/channel/${encodeURIComponent(activity.channelId)}`,
  };
}

/**
 * ONE MOMENT, ONE NOTICE. A turn reports its reply more than once (each run of a turn reports what
 * it said, and a placeholder is reported again once filled in), and a turn that ends asking the
 * person something also raises "needs you" from the attention counts, as does the server's own
 * "A question needs your answer" line. So a reply is not announced when it arrives:
 *
 * - it waits for the conversation's turn to end (its `busy` signal goes off), and then a moment
 *   more, keeping only the newest reply of the turn;
 * - it is dropped when the conversation is then waiting on the person (`waitingIn`, read fresh):
 *   the "needs you" notice is that moment's one notice;
 * - a reply already announced, by its words, is not announced again;
 * - its tag is the conversation's, shared with the "needs you" notice, so a browser or Windows
 *   replaces one with the other rather than stacking them.
 */
export const HyperReplyTiming = {
  /** After the turn ends, how long more replies of it may still arrive. */
  settleMs: 1500,
  /** The longest a reply waits on a turn whose end never arrives. */
  turnMs: 120_000,
};

type Pending = {
  activity: HyperChannelActivityEvent;
  timer: ReturnType<typeof setTimeout> | null;
  since: number;
};

/** Per conversation, the newest reply of a turn not yet announced. */
const pending = new Map<string, Pending>();
/** Conversations whose turn is under way, as the socket's busy signals say. */
const busy = new Set<string>();
let sessionGeneration = 0;
const channelVersions = new Map<string, number>();
/** Replies already announced, by conversation and words. */
const announced = new Set<string>();
const ANNOUNCED_KEPT = 200;

const wordsKey = (activity: HyperChannelActivityEvent) =>
  `${activity.channelId}\u0000${activity.lastMessageAgentId}\u0000${
    activity.firstLine ?? activity.lastMessage ?? ""
  }`;

function remember(key: string) {
  announced.add(key);
  if (announced.size > ANNOUNCED_KEPT) {
    const oldest = announced.values().next().value;
    if (oldest !== undefined) announced.delete(oldest);
  }
}

/** For tests: forget every turn and reply, as a fresh page does. */
export function HyperForgetReplies() {
  sessionGeneration++;
  for (const each of pending.values()) if (each.timer) clearTimeout(each.timer);
  pending.clear();
  busy.clear();
  channelVersions.clear();
  announced.clear();
}

/**
 * Every event of the roster's socket passes here: a Bot's reply is held for its turn's end, and a
 * busy signal ends or starts a turn. `open` takes a browser to the conversation when the notice is
 * clicked; OpenBot Desktop opens the notice's own `path` instead.
 */
export function HyperNoticeChannelEvent(
  activity: HyperChannelActivityEvent,
  reads: HyperReplyNoticeReads,
  open: (channelId: string) => void,
): void {
  const { channelId } = activity;
  if (activity.busy !== undefined) {
    if (activity.busy && !busy.has(channelId)) channelVersions.set(channelId, (channelVersions.get(channelId) ?? 0) + 1);
    if (activity.busy) busy.add(channelId);
    else busy.delete(channelId);
    const held = pending.get(channelId);
    if (held) arm(held, reads, open);
    return;
  }
  if (!HyperIsBotReply(activity)) return;
  if (announced.has(wordsKey(activity))) return;
  channelVersions.set(channelId, (channelVersions.get(channelId) ?? 0) + 1);
  const held = pending.get(channelId);
  if (held?.timer) clearTimeout(held.timer);
  const next: Pending = {
    activity,
    timer: null,
    since: held?.since ?? Date.now(),
  };
  pending.set(channelId, next);
  arm(next, reads, open);
}

/** Wait for the turn to end and settle; a turn still running waits on, up to its limit. */
function arm(
  held: Pending,
  reads: HyperReplyNoticeReads,
  open: (channelId: string) => void,
) {
  if (held.timer) clearTimeout(held.timer);
  const { channelId } = held.activity;
  const overdue = Date.now() - held.since >= HyperReplyTiming.turnMs;
  if (busy.has(channelId) && !overdue) {
    held.timer = setTimeout(
      () => arm(held, reads, open),
      Math.max(0, HyperReplyTiming.turnMs - (Date.now() - held.since)),
    );
    return;
  }
  held.timer = setTimeout(() => {
    if (pending.get(channelId) !== held) return;
    if (busy.has(channelId) && Date.now() - held.since < HyperReplyTiming.turnMs) {
      arm(held, reads, open);
      return;
    }
    pending.delete(channelId);
    void announce(held.activity, reads, open);
  }, HyperReplyTiming.settleMs);
}

async function announce(
  activity: HyperChannelActivityEvent,
  reads: HyperReplyNoticeReads,
  open: (channelId: string) => void,
): Promise<void> {
  const generation = sessionGeneration;
  const version = channelVersions.get(activity.channelId);
  const current = () => generation === sessionGeneration && version === channelVersions.get(activity.channelId);
  const key = wordsKey(activity);
  if (announced.has(key) || HyperInSight()) return;
  // Waits for OpenBot Desktop's answer when it is still on its way; looked at again after.
  if (!(await HyperNotificationsAllowed())) return;
  if (!current() || announced.has(key) || HyperInSight()) return;

  // Read fresh: whether this conversation now waits on the person decides which notice it is.
  let bots: HyperNoticeBot[] | undefined;
  try { bots = await reads.attention(); } catch { return; }
  if (!current()) return;
  if (bots?.some(bot => bot.waitingIn === activity.channelId)) return;
  let notify: HyperBotNotify | null = null;
  if (activity.lastMessageAgentId) {
    try { notify = await reads.notify(activity.lastMessageAgentId); } catch { return; }
  }
  const notice = HyperReplyNotice(activity, notify, bots, reads.agents());
  if (!current() || !notice || announced.has(key) || HyperInSight()) return;
  remember(key);
  HyperShowNotice({ ...notice, onClick: () => open(activity.channelId) });
}
