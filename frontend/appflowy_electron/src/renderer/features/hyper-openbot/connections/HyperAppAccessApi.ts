// Adapted from OpenBot lib/app-access/{queries,mutations}.ts, MIT Copyright (c) 2026 CopilotKit.
import { hyperOpenBotRequest } from '../transport';
export type HyperAppAccessState =
  | "ready"
  | "not_connected"
  | "reconnect"
  | "shared_not_connected"
  | "shared_not_approved"
  | "disabled"
  | "not_granted"
  | "owner_grantable";

/**
 * Why an app is switched off. `absent` — nobody switched it on here. `composio_unconfigured` — a
 * brokered app (Composio or Arcade) on a deployment with no key for its broker. The other three — a scheme the server cannot
 * read, an OAuth client nobody registered, a token nobody pasted — are a set-up left unfinished.
 */
export type HyperAppUnavailable =
  | "absent"
  | "composio_unconfigured"
  | "scheme_unreadable"
  | "oauth_client_missing"
  | "token_missing";

/** What a press of Request access asks an administrator for. */
export type HyperAppAccessRequestKind = "enable" | "grant" | "connect_shared";

export type HyperAppAccess = {
  /** The server id the app has, or the one enabling it would mint. What a request names. */
  key: string;
  /** The app's own name — "Gmail", never a humanised server id. */
  displayName: string;
  logo: string | null;
  /** A brokered app names its broker; a catalogue or custom app is reached directly. */
  provider: "composio" | "arcade" | "catalogue" | "custom";
  /** Whose account calls land in: each person's own, one team account, or nobody's. */
  account: "personal" | "shared" | "deployment";
  /** How the account is connected: this deployment's OAuth flow, a broker's consent, or a key form. */
  connect: "oauth" | "consent" | "key" | null;
  authScheme: string | null;
  accountMode: "personal" | "shared" | null;
  state: HyperAppAccessState;
  /** Why the app is switched off, when state is "disabled"; null otherwise. */
  unavailable: HyperAppUnavailable | null;
  /**
   * Whose account a personal-account app's calls use for this person on this Bot: "you", or "owner"
   * when this is somebody else's published Team Bot and its owner has connected the app (calls then
   * run on the owner's account). null when the app is not a personal-account app.
   */
  accountHolder: "you" | "owner" | null;
  /**
   * True when calls will use this person's OWN account on somebody else's Team Bot and they have not
   * given standing consent: the first use raises an "Allow once / Always allow" card. State is "ready".
   */
  asksFirst: boolean;
  /** Whether this Bot holds any of the app's tools. */
  granted: boolean;
  /** Who may give the app to a Bot: any Bot's owner, or only an admin. */
  ownerGrants: "any" | "admin";
  /** Whether everything this Bot holds of the app was given by its owner, who may take it back. */
  givenByOwner: boolean;
  /**
   * In `owner_grantable`, whether giving it has to start with connecting the person's own account.
   * False in every other state.
   */
  needsConnect: boolean;
  /**
   * When the account this app runs in for this person was connected, or null. Read by the chat card
   * to tell an account lost at the vendor from one connected again since. See `AppAccessCard`.
   */
  connectedAt: string | null;
  /** The request Request access files for this state; null where the next step is the person's. */
  requestKind: HyperAppAccessRequestKind | null;
  /** This person's pending request of exactly that kind — drawn as "Requested". */
  request: { id: string; kind: HyperAppAccessRequestKind; createdAt: string } | null;
};

/** A request as the person who filed it and the administrator answering it both read it. */
export type HyperAppAccessRequest = {
  id: string;
  appKey: string;
  appTitle: string;
  kind: HyperAppAccessRequestKind;
  status: "pending" | "approved" | "dismissed" | "cancelled";
  agentId: string | null;
  botName: string | null;
  requestedBy: string;
  requesterEmail: string | null;
  requesterName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

/** The administrator's inbox: the requests asked for, and a count per app for the Plugins list. */
export type HyperAppAccessInbox = {
  requests: HyperAppAccessRequest[];
  counts: { total: number; byApp: Record<string, number> };
};


export const hyperLoadAppAccess = (agentId: string, app: string) => hyperOpenBotRequest<{ app: HyperAppAccess }>(`/api/plugins/for/${encodeURIComponent(agentId)}/apps/${encodeURIComponent(app)}`);
export const hyperRequestAppAccess = (agentId: string, app: string) => hyperOpenBotRequest('/api/plugins/access-requests', 'POST', { agentId, app });
export const hyperCancelAppAccess = (id: string) => hyperOpenBotRequest(`/api/plugins/access-requests/${encodeURIComponent(id)}`, 'DELETE');
export const hyperGiveApp = (agentId: string, app: string, give = true) => hyperOpenBotRequest(`/api/plugins/for/${encodeURIComponent(agentId)}/apps/${encodeURIComponent(app)}/give`, give ? 'POST' : 'DELETE');
export const hyperApproveBotApp = (agentId: string, app: string) => hyperOpenBotRequest(`/api/plugins/for/${encodeURIComponent(agentId)}/apps/${encodeURIComponent(app)}/approve`, 'POST');
export const hyperLoadAppRequests = (app?: string) => hyperOpenBotRequest<HyperAppAccessInbox>(`/api/plugins/access-requests${app ? `?app=${encodeURIComponent(app)}` : ''}`);
export const hyperDecideAppRequest = (id: string, decision: 'approve' | 'dismiss', refs?: string[]) => hyperOpenBotRequest(`/api/plugins/access-requests/${encodeURIComponent(id)}/${decision}`, 'POST', refs ? { refs } : undefined);
