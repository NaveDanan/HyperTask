// Copyright (c) 2026 CopilotKit. MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest as request } from "../transport";
export type HyperApprovalDecision =
  | "allow_once"
  | "allow_conversation"
  | "allow_always"
  | "deny"
  | "handled";
export type RuleBehaviour = "allow" | "pre_approved" | "ask" | "hand_off";
/** The kinds of action OpenBot asks about by name, as server/src/approvals/types.ts lists them. */
export type ActionKind =
  | "deleting"
  | "sending"
  | "sharing"
  | "publishing"
  | "payments"
  | "credentials"
  | "security_settings";
/** What the admin lets members do about a kind: open, ask every time, or leave it to them. */
export type ActionKindPolicy = "open" | "ask" | "hand_off";
/**
 * One "Allow for this conversation": what it allows, and in which conversation. Drawn in that
 * conversation, with a way to turn it off.
 */
export type HyperConversationGrant = {
  id: string;
  threadId: string;
  botId: string;
  toolRef: string;
  effect: string;
  scope: string;
  account?: string;
  kind?: ActionKind;
  createdAt: string;
};
export type HyperHostCommandPolicy = "ask" | "allow" | "never";
export type HyperApprovalRuleInput = {
  botId: string;
  toolRef: string;
  effect: string;
  scope: string;
  behaviour: RuleBehaviour;
};
export type HyperApprovalRuleRow = HyperApprovalRuleInput & {
  id: string;
  /** The one account at the app a saved rule is for, where the person holds several. */
  account?: string | null;
};
export const BEHAVIOUR_LABELS: Record<RuleBehaviour, string> = {
  allow: "Take action without asking",
  pre_approved: "Take action if pre-approved",
  ask: "Ask before taking action",
  hand_off: "Hand off to you",
};
export type HyperApprovalInboxData = {
  enabled: boolean;
  requests: {
    id: string;
    status: string;
    createdAt: string;
    /** When the person (or a rule) decided it; null while it waits. */
    decidedAt?: string | null;
    /** What the person answered; null while it waits. */
    decision?: HyperApprovalDecision | null;
    action: {
      botId: string;
      toolRef: string;
      effect: string;
      scope: string;
      threadId: string;
      toolCallId?: string;
      args: unknown;
      target: unknown;
      /** Which of the person's accounts at the app, where they hold several. */
      account?: string;
      policy?: {
        behaviour: "allow" | "ask" | "hand_off" | "deny";
        source: string;
        reason: string;
        kind?: ActionKind;
        /** The admin set this kind to ask every time: Allow once and Deny only. */
        closed?: boolean;
      };
    };
  }[];
  rules: HyperApprovalRuleRow[];
  teamRules: HyperApprovalRuleRow[];
  /** "Allow for this conversation" answers still in force, in every conversation. */
  conversationGrants?: HyperConversationGrant[];
  preferences?: {
    enabled: boolean;
    autoReview: boolean;
    hostCommands: HyperHostCommandPolicy;
  };
  team?: {
    enforceAutoReview: boolean;
    customRulesEnabled: boolean;
    hostCommandsCap: HyperHostCommandPolicy;
    /** The kinds the admin closed. A kind not named is open. */
    actionKinds?: Partial<Record<ActionKind, ActionKindPolicy>>;
  };
  /** The member's command policy after the team cap. */
  hostCommands?: HyperHostCommandPolicy;
  questions: {
    id: string;
    botId: string;
    /** The Bot whose conversation this belongs to: for a hand-off, the Bot that handed it on. */
    conversationBotId?: string;
    threadId: string;
    /** The conversation it was asked in, which is where it is answered. */
    channelId?: string;
    question: string;
    why?: string;
    /** The separate decisions inside the question, each answered on its own. */
    parts?: { header: string; question: string; options?: string[] }[];
    createdAt: string;
  }[];
};

export const HyperLoadInbox = () => request<HyperApprovalInboxData>('/api/approvals');
export const HyperDecide = (id: string, decision: HyperApprovalDecision) => request(`/api/approvals/${encodeURIComponent(id)}/decision`, 'POST', { decision });
export const HyperAnswer = (id: string, response: string) => request(`/api/approvals/questions/${encodeURIComponent(id)}/respond`, 'POST', { response });
export const HyperDismiss = (id: string) => request(`/api/approvals/questions/${encodeURIComponent(id)}/dismiss`, 'POST');
export const HyperPreferences = (input: { enabled?: boolean; autoReview?: boolean; hostCommands?: HyperHostCommandPolicy }) => request('/api/approvals/preferences', 'PATCH', input);
export const HyperSaveRule = (input: HyperApprovalRuleInput, id?: string) => request('/api/approvals/rules' + (id ? '/' + encodeURIComponent(id) : ''), id ? 'PATCH' : 'POST', input);
export const HyperRemoveRule = (id: string) => request('/api/approvals/rules/' + encodeURIComponent(id), 'DELETE');
export const HyperRevokeGrant = (id: string) => request('/api/approvals/conversation-grants/' + encodeURIComponent(id), 'DELETE');

export const HyperClearSharedBotConsents = () => request('/api/team-bots/consents', 'DELETE');

/** Resolve older inbox items too: the channel roster is cursor-paginated upstream. */
export async function HyperFindConversation(threadId: string): Promise<string | undefined> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page: { channels: { id: string; threadId: string }[]; nextCursor: string | null } =
      await request('/api/channels' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    const channel = page.channels.find(row => row.threadId === threadId);
    if (channel) return channel.id;
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Channel pagination did not advance');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return undefined;
}
export const HyperChangeRule = (id: string, behaviour: RuleBehaviour) =>
  request('/api/approvals/rules/' + encodeURIComponent(id), 'PATCH', { behaviour });
