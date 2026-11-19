import { z } from 'zod';
import { HYPER_BOT_AVATAR_SHAPES, HYPER_BOT_AVATAR_COLORS, HYPER_BOTS_TOOLS, HyperBotsChannel as B, type HyperBotsConnections, type HyperBotsSnapshot, type HyperBotsToolName } from '@shared/HyperBots';
import { HyperBotWorkspaceCommand, HyperBotWorkspaceName } from './HyperBotWorkspace';
import { HyperBotVaultInput } from './HyperBotVault';
import { HyperBotRoutines } from './HyperBotRoutines';
import { HyperBotAudio } from './HyperBotSpeech';
import { HyperBotUploadSchema } from './HyperBotFiles';
import { HyperBotsRuntimeError } from './HyperBotsRuntime';
import type { HyperBotsActive, HyperBotsUser } from './HyperBotsHub';
import { SettingsError } from './settings-error';

const uuid = z.uuid();
const slug = z.string().regex(/^[a-z0-9-]{1,32}$/, 'Use 1..32 lowercase letters, digits or dashes.');
const roomId = slug;
const toolNames = Object.keys(HYPER_BOTS_TOOLS) as [HyperBotsToolName, ...HyperBotsToolName[]];
const readTools = toolNames.filter(name => HYPER_BOTS_TOOLS[name].access === 'read' && HYPER_BOTS_TOOLS[name].group !== 'workspace');
export const HyperBotsArgs = {
  // Who the caller is comes from the core in main (hub.current()), never from the renderer.
  open: z.strictObject({ roomId: roomId.optional() }),
  snapshot: z.strictObject({ roomId }),
  post: z.strictObject({ roomId, clientMessageId: uuid, text: z.string().max(20000), attachments: HyperBotUploadSchema.optional(), model: z.string().min(1).max(200).nullable().optional() }).refine(value => value.text.trim() || value.attachments?.length, 'Write a message or attach a file first.'),
  decide: z.strictObject({ approvalId: uuid, approved: z.boolean(), delivery: z.enum(['send', 'draft']).optional() }),
  settings: z.strictObject({
    version: z.literal(1),
    bots: z.array(z.strictObject({ id: slug, name: z.string().trim().min(1).max(40), instructions: z.string().max(4000), model: z.string().max(200), tools: z.array(z.enum(toolNames)).max(toolNames.length), avatar: z.strictObject({ shape: z.enum(HYPER_BOT_AVATAR_SHAPES), color: z.enum(HYPER_BOT_AVATAR_COLORS) }).optional(), mode: z.enum(['personal', 'teammate']).optional(), learn: z.boolean().optional(), routines: HyperBotRoutines.optional() })).min(1).max(8),
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
export const HYPER_BOTS_RPC_CHANNELS = [B.Open, B.Snapshot, B.Post, B.Decide, B.SaveSettings, B.Models, B.Attachment, B.Transcribe, B.Forget, B.VaultList, B.VaultAdd, B.VaultRemove, B.VaultCopy, B.WorkspaceList, B.WorkspaceRead, B.WorkspaceCommand];

export type HyperBotsRpcDeps = { connections: (user: HyperBotsUser) => Promise<HyperBotsConnections>; models: () => Promise<string[]> };
export function createHyperBotsRpc(deps: HyperBotsRpcDeps) {
  const handlers = new Map<string, (args: unknown) => { input: unknown; run(active: HyperBotsActive): Promise<unknown> }>();
  const handle = <T extends z.ZodType | null, R>(channel: string, schema: T, run: (args: T extends z.ZodType ? z.output<T> : undefined, active: HyperBotsActive) => Promise<R> | R) => {
    handlers.set(channel, args => {
      let value: unknown;
      if (schema) {
        const valid = schema.safeParse(args);
        if (!valid.success) throw new SettingsError('format', valid.error.issues[0]?.message ?? 'Invalid HyperBots request.');
        value = valid.data;
      }
      return { input: value, run: async active => {
        try { return await run(value as never, active); } catch (error) { throw hyperBotsFailure(error); }
      } };
    });
  };
  // Events refresh the room often; the connection probes (Outlook, DPAPI, Jira files) are shared for a while
  // so a slow Outlook does not hold every refresh. Opening the room always probes again. Probes never cross accounts.
  let probe: { key: string; at: number; value: Promise<HyperBotsConnections> } | null = null;
  const connections = (user: HyperBotsUser, fresh: boolean) => {
    if (fresh || !probe || probe.key !== user.key || Date.now() - probe.at > CONNECTIONS_TTL_MS) probe = { key: user.key, at: Date.now(), value: deps.connections(user) };
    return probe.value;
  };
  const snapshot = async ({ runtime, user }: HyperBotsActive, room: string, fresh = false): Promise<HyperBotsSnapshot> => {
    const [state, current] = await Promise.all([runtime.snapshot(room), connections(user, fresh)]);
    return { ...state, connections: current };
  };
  handle(B.Open, HyperBotsArgs.open, async (args, active) => snapshot(active, args.roomId ?? (await active.runtime.settings()).rooms[0]!.id, true));
  handle(B.Snapshot, HyperBotsArgs.snapshot, (args, active) => snapshot(active, args.roomId));
  handle(B.Post, HyperBotsArgs.post, (args, { runtime }) => runtime.post(args));
  handle(B.Decide, HyperBotsArgs.decide, (args, { runtime }) => runtime.decide(args.approvalId, args.approved, args.delivery));
  handle(B.SaveSettings, HyperBotsArgs.settings, (args, { runtime }) => runtime.saveSettings(args));
  handle(B.Attachment, z.strictObject({ messageId: uuid, attachmentId: z.string().regex(/^[a-f0-9]{64}$/) }), (args, { runtime }) => runtime.readAttachment(args.messageId, args.attachmentId));
  handle(B.Transcribe, HyperBotAudio, (audio, { runtime }) => runtime.transcribe(audio));
  handle(B.Forget, z.strictObject({ roomId, id: uuid }), (args, { runtime }) => runtime.forget(args.roomId, args.id));
  handle(B.VaultList, null, (_, { runtime }) => runtime.vault().list());
  handle(B.VaultAdd, HyperBotVaultInput, (args, { runtime }) => runtime.vault().add(args));
  handle(B.VaultRemove, z.strictObject({ id: uuid }), (args, { runtime }) => runtime.vault().remove(args.id));
  handle(B.VaultCopy, z.strictObject({ id: uuid }), (args, { runtime }) => runtime.vault().password(args.id));
  handle(B.WorkspaceList, null, (_, { runtime }) => runtime.workspace().list());
  handle(B.WorkspaceCommand, HyperBotWorkspaceCommand, (args, { runtime }) => runtime.workspace().command(args));
  handle(B.WorkspaceRead, z.strictObject({ name: HyperBotWorkspaceName }), (args, { runtime }) => runtime.workspace().read(args.name));
  handle(B.Models, null, () => deps.models());
  return { handlers, clearConnections: () => { probe = null; } };
}
