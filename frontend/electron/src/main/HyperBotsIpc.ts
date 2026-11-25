import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { HYPER_BOT_AVATAR_SHAPES, HYPER_BOT_AVATAR_COLORS, HYPER_BOTS_TOOLS, HYPER_BOTS_READ_POLICIES, HyperBotsChannel as B, type HyperBotsConnections, type HyperBotsEvent, type HyperBotsSnapshot, type HyperBotsToolName } from '@shared/HyperBots';
import { HyperBotsRuntimeError, type HyperBotsRuntime } from './HyperBotsRuntime';
import type { HyperBotsActive, HyperBotsHub, HyperBotsUser } from './HyperBotsHub';
import { SettingsError, toIpcResult } from './settings-error';
import { hyperTrustedWindowAdapter, type HyperWindowSource } from './HyperTrustedWindows';
import { HyperNewsletterConnectionInputSchema, type HyperNewsletterConnection } from './HyperNewsletterConnection';

const uuid = z.uuid();
const slug = z.string().regex(/^[a-z0-9-]{1,32}$/, 'Use 1..32 lowercase letters, digits or dashes.');
const roomId = slug;
const limit = z.int().min(1).max(100_000).optional();
const toolNames = Object.keys(HYPER_BOTS_TOOLS) as [HyperBotsToolName, ...HyperBotsToolName[]];
const readTools = HYPER_BOTS_READ_POLICIES.flatMap(group => group.tools);
export const HyperBotsArgs = {
  // Who the caller is comes from the core in main (hub.current()), never from the renderer.
  open: z.strictObject({ roomId: roomId.optional(), limit }),
  snapshot: z.strictObject({ roomId, limit, fromMessageId: uuid.optional() }),
  post: z.strictObject({ roomId, clientMessageId: uuid, text: z.string().min(1).max(20000).refine(text => text.trim().length > 0, 'Write a message first.'), model: z.string().min(1).max(200).nullable().optional() }),
  decide: z.strictObject({ approvalId: uuid, approved: z.boolean(), delivery: z.enum(['send', 'draft']).optional() }),
  settings: z.strictObject({
    version: z.literal(1),
    bots: z.array(z.strictObject({ id: slug, name: z.string().trim().min(1).max(40), instructions: z.string().max(4000), model: z.string().max(200), tools: z.array(z.enum(toolNames)).max(toolNames.length), avatar: z.strictObject({ shape: z.enum(HYPER_BOT_AVATAR_SHAPES), color: z.enum(HYPER_BOT_AVATAR_COLORS) }).optional(), mode: z.enum(['personal', 'teammate']).optional() })).min(1).max(8),
    rooms: z.array(z.strictObject({ id: slug, name: z.string().trim().min(1).max(40), botIds: z.array(slug).max(8), kind: z.enum(['direct', 'group']).optional() })).min(1).max(24),
    // Only read tools take a policy; one left out is 'ask'.
    policy: z.strictObject(Object.fromEntries(readTools.map(name => [name, z.enum(['ask', 'allow']).optional()]))),
  }).superRefine((settings, ctx) => {
    const direct = new Set<string>();
    settings.rooms.forEach((room, i) => {
      if (room.kind !== 'direct') return;
      if (room.botIds.length !== 1) ctx.addIssue({ code: 'custom', path: ['rooms', i, 'botIds'], message: 'A direct room needs exactly one bot.' });
      const id = room.botIds[0];
      if (id && direct.has(id)) ctx.addIssue({ code: 'custom', path: ['rooms', i], message: 'A bot can have only one direct room.' });
      if (id) direct.add(id);
    });
  }),
};
const MESSAGES: Record<string, string> = {
  not_found: 'That room, bot or approval no longer exists.',
  not_pending: 'That approval was already decided.',
  conflict: 'That message ID was already used for different text.',
  invalid: 'The request is invalid.',
};
/** Runtime refusals become SettingsErrors the renderer can show as-is. */
export function hyperBotsFailure(error: unknown): SettingsError {
  if (error instanceof SettingsError) return error;
  if (error instanceof HyperBotsRuntimeError) {
    const detail = error.message && error.message !== error.code ? error.message : MESSAGES[error.code] ?? 'HyperBots refused the request.';
    return new SettingsError(error.code === 'invalid' ? 'format' : 'state', detail);
  }
  return new SettingsError('other', `HyperBots failed. ${error instanceof Error ? error.message : String(error)}`);
}

const CONNECTIONS_TTL_MS = 15_000;
const CHANNELS = [B.Open, B.Snapshot, B.Post, B.Decide, B.SaveSettings, B.Models, B.NewsletterConnection, B.SaveNewsletterConnection];

/** When HyperBots could not start (e.g. its state file is unreadable), every call answers with why; the app keeps running. */
export function registerHyperBotsUnavailable(problem: string): () => void {
  for (const channel of CHANNELS) ipcMain.handle(channel, () => toIpcResult(async () => { throw new SettingsError('state', `HyperBots could not start. ${problem}`); }));
  return () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); };
}

/**
 * Every call first asks the hub who is signed in (verified with the core in main) and acts only on that account's
 * runtime; events are forwarded only from the active runtime.
 */
export function registerHyperBotsIpc(window: HyperWindowSource, deps: { hub: Pick<HyperBotsHub, 'current' | 'onSwitch'>; connections: (user: HyperBotsUser) => Promise<HyperBotsConnections>; models: () => Promise<string[]>; newsletter: Pick<HyperNewsletterConnection, 'status' | 'save'>; onOutlookPresenceChange?: (listener: () => void) => () => void }): () => void {
  const registry = hyperTrustedWindowAdapter(window);
  const trusted = (event: IpcMainInvokeEvent) => registry.isTrustedSender(event);
  const handle = <T extends z.ZodType | null, R>(channel: string, schema: T, run: (args: T extends z.ZodType ? z.output<T> : undefined, active: HyperBotsActive) => Promise<R> | R) =>
    ipcMain.handle(channel, (event, args: unknown) => toIpcResult(async () => {
      if (!trusted(event)) throw new SettingsError('state', 'Untrusted HyperBots caller refused.');
      let value: unknown;
      if (schema) {
        const valid = schema.safeParse(args);
        if (!valid.success) throw new SettingsError('format', valid.error.issues[0]?.message ?? 'Invalid HyperBots request.');
        value = valid.data;
      }
      try {
        const active = await deps.hub.current();
        follow(active.runtime);
        return await run(value as never, active);
      } catch (error) { throw hyperBotsFailure(error); }
    }));
  // A windowed read can paint the conversation before Outlook or Jira answers. The event contains no account data.
  // Unwindowed callers still receive a completed connection check.
  const checking = { ready: false as const, problem: 'Checking connection…', checking: true };
  let probe: { key: string; at: number; value: Promise<HyperBotsConnections>; notify: boolean; result?: HyperBotsConnections } | null = null;
  const connections = (user: HyperBotsUser, fresh: boolean, notify: boolean) => {
    if (!fresh && probe?.key === user.key && (!probe.result || Date.now() - probe.at < CONNECTIONS_TTL_MS)) {
      probe.notify ||= notify;
      return probe;
    }
    const entry: NonNullable<typeof probe> = { key: user.key, at: Date.now(), value: deps.connections(user), notify };
    probe = entry;
    void entry.value.then(result => {
      entry.result = result;
    }, () => {
      const failed = { ready: false as const, problem: 'Connection check failed.' };
      entry.result = { model: failed, jira: failed, outlook: failed, newsletter: failed };
    }).then(() => { if (entry.notify && probe === entry && followed) forward({ type: 'connections' }); });
    return entry;
  };
  const snapshot = async ({ runtime, user }: HyperBotsActive, room: string, fresh = false, windowSize?: number, fromMessageId?: string): Promise<HyperBotsSnapshot> => {
    const state = runtime.snapshot(room, windowSize, fromMessageId);
    const entry = connections(user, fresh && windowSize === undefined, windowSize !== undefined);
    if (windowSize !== undefined && !entry.result) return { ...state, connections: { model: checking, jira: checking, outlook: checking, newsletter: checking } };
    return { ...state, connections: entry.result ?? await entry.value };
  };
  handle(B.Open, HyperBotsArgs.open, (args, active) => {
    if (args.roomId) return snapshot(active, args.roomId, true, args.limit);
    const settings = active.runtime.settings();
    const first = args.limit === undefined ? undefined : settings.rooms.find(room => room.kind === 'direct' && room.botIds[0] === settings.bots[0]?.id);
    return snapshot(active, (first ?? settings.rooms[0]!).id, true, args.limit);
  });
  handle(B.Snapshot, HyperBotsArgs.snapshot, (args, active) => snapshot(active, args.roomId, false, args.limit, args.fromMessageId));
  handle(B.Post, HyperBotsArgs.post, (args, { runtime }) => runtime.post(args));
  handle(B.Decide, HyperBotsArgs.decide, (args, { runtime }) => runtime.decide(args.approvalId, args.approved, args.delivery));
  handle(B.SaveSettings, HyperBotsArgs.settings, (args, { runtime }) => runtime.saveSettings(args));
  handle(B.Models, null, () => deps.models());
  handle(B.NewsletterConnection, null, (_, { user }) => deps.newsletter.status(user.key));
  handle(B.SaveNewsletterConnection, HyperNewsletterConnectionInputSchema, async (input, { user, runtime }) => {
    const state = await deps.newsletter.save(user.key, input);
    if (followed === runtime) {
      probe = null;
      forward({ type: 'connections' });
    }
    return state;
  });
  const forward = (event: HyperBotsEvent) => {
    registry.broadcast(B.Event, event);
  };
  let followed: HyperBotsRuntime | null = null;
  const follow = (runtime: HyperBotsRuntime | null) => {
    if (followed === runtime) return;
    probe = null;
    followed?.events.off('event', forward);
    followed = runtime;
    followed?.events.on('event', forward);
  };
  const unsubscribe = deps.hub.onSwitch(follow);
  const unsubscribePresence = deps.onOutlookPresenceChange?.(() => { probe = null; forward({ type: 'settings' }); });
  return () => {
    unsubscribe();
    unsubscribePresence?.();
    follow(null);
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
