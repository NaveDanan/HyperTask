import type { HyperBotConfig, HyperBotMode, HyperBotsDelivery, HyperBotsToolName } from './HyperBots';

// Shared IPC contracts for HyperTask's personal voice assistant pipeline (EN + HE bot resolution,
// Outlook/AD employee directory resolution, pre-send confirmation, and inline approval execution).

export const HyperAssistantChannel = {
  ParseCommand: 'hyper-assistant:parse-command',
  SearchPeople: 'hyper-assistant:search-people',
  Dispatch: 'hyper-assistant:dispatch',
  DecideApproval: 'hyper-assistant:decide-approval',
  ListBots: 'hyper-assistant:list-bots',
} as const;

export type HyperAssistantIntent = 'meeting' | 'email' | 'general';
export type HyperAssistantLanguage = 'en' | 'he' | 'mixed';
export type HyperAssistantPersonStatus = 'exact' | 'fuzzy' | 'ambiguous' | 'unresolved';

export interface HyperAssistantBotCandidate {
  id: string;
  name: string;
  /** Display handle with leading @, e.g. '@abby', '@משה', '@אבי'. */
  handle: string;
  roomId: string | null;
  mode: HyperBotMode;
  avatar?: HyperBotConfig['avatar'];
  tools: HyperBotsToolName[];
  confidence?: 'exact' | 'fuzzy' | 'default';
  matchedText?: string;
}

export interface HyperAssistantPerson {
  name: string;
  email: string;
  title: string;
  department: string;
  phone: string;
  office: string;
  company: string;
  photo?: string;
  source: 'ad' | 'outlook';
}

export interface HyperAssistantPersonSlot {
  id: string;
  /** Raw name phrase extracted from the command (e.g., "Aaron Mitchel" or "לישראל ישראלי"). */
  rawName: string;
  /** Normalized lookup query (e.g., "Aaron Mitchel" or "ישראל ישראלי"). */
  query: string;
  role?: 'to' | 'cc' | 'attendee' | 'person';
  status: HyperAssistantPersonStatus;
  selected: HyperAssistantPerson | null;
  candidates: HyperAssistantPerson[];
  error?: string;
}

export interface HyperVoiceCommandPlan {
  rawText: string;
  /** Command body with conversational bot trigger removed (e.g., "set meeting with Aaron Mitchel tomorrow at six PM"). */
  cleanedCommand: string;
  /** Human-readable preview with @bot and @Person tags (e.g., "@abby set meeting with @Aaron Mitchel tomorrow at six PM"). */
  normalizedText: string;
  /** Canonical dispatch text with verified @[Display Name](mailto:email) tokens for selected people. */
  canonicalText: string;
  language: HyperAssistantLanguage;
  intent: HyperAssistantIntent;
  resolvedBot: HyperAssistantBotCandidate | null;
  targetRoomId: string | null;
  availableBots: HyperAssistantBotCandidate[];
  people: HyperAssistantPersonSlot[];
  missingTools: HyperBotsToolName[];
  requiresConfirmation: boolean;
  warnings: string[];
  signedIn: boolean;
}

export interface HyperAssistantParseInput {
  text: string;
  activeRoomId?: string | null;
}

export interface HyperAssistantSearchPeopleInput {
  query: string;
  limit?: number;
}

export interface HyperAssistantConfirmedPerson {
  slotId?: string;
  rawName?: string;
  name: string;
  email: string;
}

export interface HyperAssistantDispatchInput {
  botId: string;
  targetRoomId?: string | null;
  text: string;
  confirmedPeople: HyperAssistantConfirmedPerson[];
  enableMissingTools?: HyperBotsToolName[];
  clientMessageId?: string;
  model?: string | null;
}

export interface HyperAssistantDispatchResult {
  ok: boolean;
  error?: string;
  roomId?: string;
  messageId?: string;
  runId?: string | null;
  botId?: string;
  botName?: string;
  dispatchedText?: string;
}

export interface HyperAssistantDecideApprovalInput {
  approvalId: string;
  approved: boolean;
  delivery?: HyperBotsDelivery;
}

export interface HyperAssistantApi {
  parseCommand(input: HyperAssistantParseInput): Promise<HyperVoiceCommandPlan>;
  searchPeople(input: HyperAssistantSearchPeopleInput): Promise<HyperAssistantPerson[]>;
  dispatch(input: HyperAssistantDispatchInput): Promise<HyperAssistantDispatchResult>;
  decideApproval(input: HyperAssistantDecideApprovalInput): Promise<{ ok: boolean; error?: string }>;
  listBots(): Promise<HyperAssistantBotCandidate[]>;
}
