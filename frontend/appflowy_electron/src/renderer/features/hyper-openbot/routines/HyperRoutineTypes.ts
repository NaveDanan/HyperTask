// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
export type RoutineRecord = {
  id: string;
  /** Which Bot carries it out, so a Bot's own dialog can show only its routines. */
  agentId: string;
  schedule: string;
  timezone: string;
  instruction: string;
  /** What the person called it, or null when they named it nothing: then its schedule heads the row. */
  title: string | null;
  /**
   * Where it posts. Name it by `title`, the conversation as the sidebar titles it: `name` is only its
   * Bots' names, so every conversation with General Assistant is called "General Assistant".
   */
  channel: {
    id: string;
    name: string | null;
    title: string | null;
    gone: boolean;
  };
  enabled: boolean;
  nextRunAt: string;
  /**
   * Null means no run has ever finished. An object with `status: null` means a run is open —
   * started but not yet finished, whether genuinely in flight or stuck there after repeated
   * dispatch failures. Neither is a failure; only `status: "failed"` is.
   */
  lastRun: {
    status: "succeeded" | "failed" | "skipped" | null;
    at: string | null;
  } | null;
  /**
   * The goal it runs, or null. The server resolves it, older routines included, so the Routines
   * list draws such a routine as a start of that goal's row (`lib/routines/merged.ts`). Absent from
   * a server that predates it, which reads as running none.
   */
  goalId?: string | null;
};


export type ResponsibilityRecord = {
  id: string;
  agentId: string;
  channelId: string;
  threadId: string;
  title: string;
  instruction: string;
  successCriteria: string;
  status: "active" | "paused" | "completed";
  progress: string;
  lastResult: string | null;
  subscriptions: {
    source:
      | "manual"
      | "slack"
      | "github"
      | "schedule"
      | "connector"
      | "webhook"
      | "linear"
      | "sentry"
      | "pagerduty"
      | "email";
    eventType: string;
  }[];
  /** Runs again and again with no end. Refused alongside `endsWhenMet`. */
  recurring: boolean;
  endsWhenMet: boolean;
  updatedAt: string;
};
export type ResponsibilityRunRecord = {
  id: string;
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "skipped";
  replyText: string | null;
  error: string | null;
  waiting: { kind: string; requestId?: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
export type GithubBindingRecord = {
  id: string;
  source: "github";
  repository: string;
  createdAt: string;
  webhookPath?: string;
};

export type LastCheckIn = {
  outcome: "running" | "quiet" | "raised" | "failed" | "skipped";
  trigger: "schedule" | "run_now";
  skipReason: string | null;
  why: string | null;
  itemsRaised: number;
  startedAt: string;
  finishedAt: string | null;
};

export type ProactiveSetting = {
  id: string;
  agentId: string;
  channelId: string;
  focus: string;
  /** What it watches, in the person's words. Empty on one that watches everything the Bot reads. */
  subject?: string;
  sourceLink?: string | null;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: "idle" | "running" | "succeeded" | "error";
  lastError: string | null;
  /** Absent from a server that predates it, which reads as no check-in yet. */
  lastRun?: LastCheckIn | null;
};

/**
 * What Run now answered: queued, or skipped at once with the reason a check-in would have been
 * skipped anyway. A Run now that can't be tried (one is running, or one ran in the last ten
 * minutes) is refused, and the client raises the server's sentence.
 */
export type RunNowAnswer =
  | { queued: true }
  | { queued: false; skipped: string; why: string };

/**
 * `GET /api/proactive/settings`. `allowed` is false when an admin turned check-ins off for this
 * person, so their own switches can say who turned them off.
 */
export type ProactiveSettingsBody = {
  settings: ProactiveSetting[];
  allowed: boolean;
};

/**
 * Something a Bot's check-in found that needs the person: what it is, why (`detail`), and where it
 * read that. Open items only; Start and Hide take it off the list.
 *
 * A new item always names its source. Items from before check-ins may not, so `sourceApp` and
 * `sourceRef` stay nullable. `pingId` is the ping that told the person about it, null while it waits
 * for their hourly slot; the list shows it either way.
 */
export type ProactiveSuggestion = {
  id: string;
  agentId: string;
  /** The check-in that found it. */
  settingId?: string | null;
  title: string;
  detail: string;
  sourceApp: string | null;
  sourceRef: string | null;
  sourceLink: string | null;
  pingId: string | null;
  createdAt: string;
};


export type TaskStatus =
  | "needs_input"
  | "working"
  | "resolved"
  | "failed"
  | "ready_for_review";

export type BotTask = {
  id: string;
  agentId: string;
  /** The task's own conversation, where the person reads it and replies. */
  channelId: string;
  /** That conversation's thread, which its approvals and questions name. Null once it is gone. */
  threadId: string | null;
  title: string;
  why: string | null;
  origin: "check_in";
  suggestionId: string | null;
  sourceApp: string | null;
  sourceLink: string | null;
  status: TaskStatus;
  /** Why its turn couldn't finish, in plain words, while `failed`. Null otherwise. */
  failure: string | null;
  failedAt: string | null;
  /** One line on what comes next, from the last thing said in its conversation. */
  next: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};


