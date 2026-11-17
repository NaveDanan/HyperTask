/** Nod (n8n-io/nod, Apache-2.0) personal assistant backend. Renderer data only: no tokens, URLs or hosts. */
export const HYPER_NOD_PIN = '866158b15302256b718e89dcaf5afdb5751adddb';
export const HYPER_NOD_TEXT_LIMIT = 100_000;
export type HyperNodProblem = 'none' | 'signed_out' | 'profile_required' | 'unsupported' | 'ssh_unavailable' | 'setup_required' | 'unsafe_deployment' | 'unreachable' | 'unauthorized' | 'model_required' | 'request_unavailable' | 'operation_failed';
export interface HyperNodStatus {
  ready: boolean;
  problem: HyperNodProblem;
  /** The server's specific reason, when it gave one. */
  detail?: string;
  provider?: string;
  model?: string;
}
export type HyperNodTurnStatus = 'queued' | 'running' | 'succeeded' | 'waiting' | 'failed' | 'cancelled';
export interface HyperNodTurn { id: string; status: HyperNodTurnStatus; createdAt: string; finishedAt: string | null; error: string | null }
export interface HyperNodChoice { id: string; label: string; description?: string }
export type HyperNodApprovalState = 'pending' | 'working' | 'done' | 'declined' | 'expired' | 'uncertain';
export interface HyperNodMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  turnId: string | null;
  createdAt: string;
  streamId: string | null;
  attachments: { id: string; name: string; mimeType: string; size: number }[];
  choices?: { multiple: boolean; options: HyperNodChoice[] };
  choicesPending: boolean;
  /** Nod's exact action details, shown with the approval controls. */
  approval?: { id: string; state: HyperNodApprovalState; title: string; app: string; fields: { label: string; value: string }[]; body?: string; bodyCut: boolean };
}
export interface HyperNodActivity { turnId: string; title: string | null; step: string | null; doing: 'queued' | 'model' | 'tool'; tool?: string }
export interface HyperNodSnapshot {
  threadId: string;
  messages: HyperNodMessage[];
  turns: HyperNodTurn[];
  hasEarlierMessages: boolean;
  activity: HyperNodActivity[];
  /** Recently hidden messages; previously shown copies must disappear. Nod lists at most 150. */
  hiddenMessageIds: string[];
  /** All hidden messages. More than the listed IDs means cached history may hold hidden rows. */
  hiddenMessageCount: number;
  /** Authoritative choice questions still waiting, across all history; null when Nod omits it. */
  pendingQuestionIds: string[] | null;
}
export interface HyperNodHistoryPage { messages: HyperNodMessage[]; hasMore: boolean }
export interface HyperNodHistoryCursor { threadId: string; before: string; beforeId: string }
/** Choice and written answers reply to a choice-backed question; an open question takes a plain reply. */
export type HyperNodAnswer =
  | { kind: 'choices'; choiceIds: string[]; custom?: true }
  | { kind: 'written' }
  | { kind: 'approval'; approvalId: string; approved: boolean };
export interface HyperNodSendInput {
  text: string;
  threadId: string;
  /** The retry identity: reuse it after an uncertain send, never for different input. */
  clientMessageId: string;
  replyToMessageId?: string;
  answer?: HyperNodAnswer;
}
export interface HyperNodSubmitted { threadId: string; turnId: string; messageId: string }
export type HyperNodEvent =
  | { type: 'connected' }
  | { type: 'refresh' }
  | { type: 'delta'; threadId: string; turnId: string; text: string; streamId: string | null; done: boolean }
  | { type: 'activity'; items: HyperNodActivity[] }
  | { type: 'disconnected'; reason: string };
export const HYPER_NOD_MESSAGES: Record<HyperNodProblem, string> = {
  none: 'Nod is ready.',
  signed_out: 'Sign in to HyperTask before using the Nod assistant.',
  profile_required: 'This Nod assistant belongs to another local HyperTask profile. Switch back to that profile to use it.',
  unsupported: 'The Nod assistant connection requires Windows or Linux with OS OpenSSH access to the configured VM.',
  ssh_unavailable: 'The VM running Nod cannot be reached. Check the VM, the network and your SSH access, then retry.',
  setup_required: 'Nod is not installed on the VM. Follow the HyperTask Nod runbook to set it up, then retry.',
  unsafe_deployment: 'The Nod installation on the VM does not match the private deployment HyperTask expects. Check its configuration before retrying.',
  unreachable: 'Nod is not responding on the VM. Start its services, then retry.',
  unauthorized: 'Nod refused HyperTask\'s access token. Check the token in the VM installation, then retry.',
  model_required: 'Nod has no model connected. Connect a model in Nod, then retry.',
  request_unavailable: 'This request is no longer waiting for an answer.',
  operation_failed: 'The Nod request failed.',
};
/** Nod's choiceAnswerText (src/shared/answer-choices.ts): the server compares the reply text exactly. */
export function hyperNodChoiceText(options: readonly HyperNodChoice[]) {
  return options.map(({ label, description }) => {
    const detail = description?.trim();
    return detail && detail.toLowerCase() !== label.trim().toLowerCase() ? `${label.trim()}: ${detail}` : label.trim();
  }).join('\n');
}
