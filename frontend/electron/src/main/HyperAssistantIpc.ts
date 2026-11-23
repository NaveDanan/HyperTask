import { randomUUID } from 'node:crypto';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  HyperAssistantChannel as A,
  HYPER_ASSISTANT_MAX_PEOPLE,
  type HyperAssistantBotCandidate,
  type HyperAssistantConfirmedPerson,
  type HyperAssistantDispatchResult,
  type HyperAssistantPerson,
  type HyperVoiceCommandPlan,
} from '@shared/HyperAssistant';
import { hyperBotCreateGroup, hyperBotFindGroup, HYPER_BOTS_TOOLS, type HyperBotConfig, type HyperBotsToolName } from '@shared/HyperBots';
import { extractExplicitBotMentions, hyperBotDisplayHandle } from '@shared/HyperBotResolver';
import { hyperApplyConfirmedPeople } from '@shared/HyperAssistantPeople';
import type { HyperBotsHub } from './HyperBotsHub';
import type { HyperBotsRuntime } from './HyperBotsRuntime';
import { HyperPeopleResolver, type HyperPeopleBridge } from './HyperPeopleResolver';
import type { HyperTrustedWindowRegistry } from './HyperTrustedWindows';
import {
  HyperVoiceCommandParser,
  buildBotCandidate,
} from './HyperVoiceCommandParser';
import { SettingsError } from './settings-error';

export interface HyperAssistantIpcDeps {
  trustedWindows: HyperTrustedWindowRegistry;
  botsHub: Pick<HyperBotsHub, 'current'> | null | undefined;
  outlookBridge: HyperPeopleBridge;
  /** Optional fast LLM refinement callback for complex voice commands. */
  refineWithLlm?: (prompt: string, signal: AbortSignal) => Promise<string | null>;
}

const toolNames = Object.keys(HYPER_BOTS_TOOLS) as [HyperBotsToolName, ...HyperBotsToolName[]];
const slug = z.string().regex(/^[a-z0-9-]{1,32}$/, 'Invalid identifier.');
const uuid = z.uuid();

const ParseArgs = z.strictObject({
  text: z.string().max(20000),
  activeRoomId: z.string().max(64).nullable().optional(),
});

const SearchPeopleArgs = z.strictObject({
  query: z.string().max(128),
  limit: z.number().int().min(1).max(20).optional(),
});

const groupBotIdsSchema = z.array(slug).min(2).max(8)
  .refine(ids => new Set(ids).size === ids.length, 'Choose different bots for the group.');
const OpenGroupArgs = z.strictObject({ botIds: groupBotIdsSchema });

const ConfirmedPersonSchema = z.strictObject({
  slotId: z.string().max(64).optional(),
  rawName: z.string().max(256).optional(),
  sourceSpan: z.strictObject({
    start: z.number().int().min(0).max(20000),
    end: z.number().int().min(1).max(20000),
    text: z.string().min(1).max(20000),
  }).optional(),
  name: z.string().trim().min(1).max(512),
  email: z.email().max(320),
});

const DispatchArgs = z.strictObject({
  botId: slug.optional(),
  botIds: groupBotIdsSchema.optional(),
  targetRoomId: slug.nullable().optional(),
  text: z.string().trim().min(1, 'Write or speak a command first.').max(20000),
  confirmedPeople: z.array(ConfirmedPersonSchema).max(HYPER_ASSISTANT_MAX_PEOPLE).default([]),
  enableMissingTools: z.array(z.enum(toolNames)).max(toolNames.length).optional(),
  clientMessageId: uuid.optional(),
  model: z.string().trim().min(1).max(200).nullable().optional(),
}).refine(input => Boolean(input.botId) !== Boolean(input.botIds), 'Confirm a bot or a group of bots.')
  .refine(input => !input.botIds || !input.enableMissingTools?.length, 'Configure tools for each group member separately.');

const DecideApprovalArgs = z.strictObject({
  approvalId: uuid,
  approved: z.boolean(),
  delivery: z.enum(['send', 'draft']).optional(),
});

/**
 * Produces the final message posted to Hyper-Bot: ensures the confirmed target bot handle is present
 * and substitutes/attaches verified `@[Display Name](mailto:email)` tokens for every confirmed person.
 */
export function buildDispatchedAssistantText(
  text: string,
  bot: Pick<HyperBotConfig, 'id' | 'name'>,
  confirmedPeople: readonly HyperAssistantConfirmedPerson[],
): string {
  let out = hyperApplyConfirmedPeople(text.trim(), confirmedPeople);

  const handle = hyperBotDisplayHandle(bot);
  if (!extractExplicitBotMentions(out, [bot]).length) {
    out = `${handle} ${out}`.trim();
  }

  return out;
}

const CHANNELS = [A.ParseCommand, A.SearchPeople, A.Dispatch, A.Execution, A.DecideApproval, A.ListBots, A.OpenGroup];

function getOrCreateAssistantGroup(runtime: HyperBotsRuntime, botIds: readonly string[]) {
  const settings = runtime.settings();
  const bots = settings.bots.filter(bot => botIds.includes(bot.id));
  if (bots.length !== botIds.length) {
    throw new SettingsError('state', 'A bot in this group is no longer configured.');
  }
  const existing = hyperBotFindGroup(settings.rooms, botIds);
  if (existing) return existing;

  const name = bots.map(bot => bot.name).join(' & ').slice(0, 40).trim();
  const group = hyperBotCreateGroup(settings, name, botIds, 'group-' + randomUUID().slice(0, 16));
  runtime.saveSettings(group.settings);
  return group.room;
}

/**
 * Registers IPC handlers for `window.hypertask.assistant` across all trusted HyperTask windows
 * (both main window and floating voice overlay).
 */
export function registerHyperAssistantIpc(deps: HyperAssistantIpcDeps): () => void {
  const peopleResolver = new HyperPeopleResolver(deps.outlookBridge);
  const parser = new HyperVoiceCommandParser({
    peopleResolver,
    refineWithLlm: deps.refineWithLlm,
  });

  const assertTrusted = (event: IpcMainInvokeEvent) => {
    if (!deps.trustedWindows.isTrustedSender(event)) {
      throw new SettingsError('state', 'Untrusted HyperAssistant caller refused.');
    }
  };

  const tryCurrent = async () => {
    if (!deps.botsHub) return null;
    try {
      return await deps.botsHub.current();
    } catch {
      return null;
    }
  };

  ipcMain.handle(A.ListBots, async (event): Promise<HyperAssistantBotCandidate[]> => {
    assertTrusted(event);
    const active = await tryCurrent();
    if (!active) return [];
    const settings = active.runtime.settings();
    return settings.bots.map((bot) => buildBotCandidate(bot, settings.rooms));
  });

  ipcMain.handle(A.SearchPeople, async (event, rawArgs: unknown): Promise<HyperAssistantPerson[]> => {
    assertTrusted(event);
    const parsed = SearchPeopleArgs.safeParse(rawArgs);
    if (!parsed.success) return [];
    const query = parsed.data.query.trim();
    if (query.length < 2) return [];
    try {
      return await peopleResolver.searchPeople(query, parsed.data.limit ?? 10);
    } catch {
      return [];
    }
  });

  ipcMain.handle(A.ParseCommand, async (event, rawArgs: unknown): Promise<HyperVoiceCommandPlan> => {
    assertTrusted(event);
    const parsed = ParseArgs.safeParse(rawArgs);
    if (!parsed.success) {
      throw new SettingsError('format', parsed.error.issues[0]?.message ?? 'Invalid parse command request.');
    }
    const active = await tryCurrent();
    const settings = active ? active.runtime.settings() : null;
    return parser.parse({
      text: parsed.data.text,
      settings,
      activeRoomId: parsed.data.activeRoomId ?? null,
      signedIn: active !== null,
    });
  });

  ipcMain.handle(A.OpenGroup, async (event, rawArgs: unknown): Promise<{ roomId: string }> => {
    assertTrusted(event);
    const { botIds } = OpenGroupArgs.parse(rawArgs);
    if (!deps.botsHub) throw new SettingsError('state', 'Hyper-Bot is currently unavailable.');
    const { runtime } = await deps.botsHub.current();
    return { roomId: getOrCreateAssistantGroup(runtime, botIds).id };
  });

  ipcMain.handle(A.Dispatch, async (event, rawArgs: unknown): Promise<HyperAssistantDispatchResult> => {
    assertTrusted(event);
    const parsed = DispatchArgs.safeParse(rawArgs);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid dispatch request.' };
    }
    if (!deps.botsHub) {
      return { ok: false, error: 'Hyper-Bot is currently unavailable.' };
    }
    let active;
    try {
      active = await deps.botsHub.current();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const input = parsed.data;
    const settings = active.runtime.settings();
    const botIds = input.botIds ?? [input.botId!];
    const bots = botIds.flatMap(id => settings.bots.find(bot => bot.id === id) ?? []);
    if (bots.length !== botIds.length) {
      return { ok: false, error: 'That bot is no longer configured.' };
    }
    const bot = bots[0]!;
    if (input.confirmedPeople.some(({ sourceSpan }) => sourceSpan &&
      (sourceSpan.start >= sourceSpan.end || input.text.slice(sourceSpan.start, sourceSpan.end) !== sourceSpan.text))) {
      return { ok: false, error: 'The command changed. Review its recipients and confirm again.' };
    }

    const requestedRoom = input.targetRoomId
      ? settings.rooms.find((r) => r.id === input.targetRoomId && r.botIds.includes(bot.id))
      : undefined;
    const directRoom = settings.rooms.find(
      (r) => r.kind === 'direct' && r.botIds.length === 1 && r.botIds[0] === bot.id,
    );
    const fallbackRoom = settings.rooms.find((r) => r.botIds.includes(bot.id));
    let enabledTools: HyperBotsToolName[] = [];
    try {
      const room = input.botIds
        ? getOrCreateAssistantGroup(active.runtime, botIds)
        : requestedRoom ?? directRoom ?? fallbackRoom;
      if (!room) {
        return { ok: false, error: `Could not find a conversation room for ${bot.name}.` };
      }
      const dispatchedText = input.botIds
        ? [...bots.map(hyperBotDisplayHandle), hyperApplyConfirmedPeople(input.text, input.confirmedPeople)].join(' ')
        : buildDispatchedAssistantText(input.text, bot, input.confirmedPeople);
      const posted = await active.runtime.post({
        roomId: room.id,
        clientMessageId: input.clientMessageId ?? randomUUID(),
        text: dispatchedText,
        model: input.model ?? null,
      }, {
        botIds,
        enableTools: input.enableMissingTools ?? [],
        onToolsEnabled: (tools) => { enabledTools = tools; },
      });
      const run = posted.runs.find((row) => row.botId === bot.id);
      if (!run || posted.runs.length !== botIds.length) throw new Error('The confirmed bot runs are no longer available.');
      return {
        ok: true,
        roomId: room.id,
        messageId: posted.message.id,
        runId: run.id,
        botId: bot.id,
        botName: bot.name,
        dispatchedText,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: enabledTools.length ? message + ' Enabled tools: ' + enabledTools.join(', ') + '.' : message };
    }
  });

  const executionArgs = z.strictObject({ roomId: slug, messageId: uuid, runId: uuid });
  ipcMain.handle(A.Execution, async (event, rawArgs: unknown) => {
    assertTrusted(event);
    const parsed = executionArgs.safeParse(rawArgs);
    if (!parsed.success) return null;
    const active = await deps.botsHub?.current();
    const { roomId, messageId, runId } = parsed.data;
    return active?.runtime.assistantExecution(roomId, messageId, runId) ?? null;
  });

  ipcMain.handle(A.DecideApproval, async (event, rawArgs: unknown): Promise<{ ok: boolean; error?: string }> => {
    assertTrusted(event);
    const parsed = DecideApprovalArgs.safeParse(rawArgs);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid approval decision.' };
    }
    if (!deps.botsHub) {
      return { ok: false, error: 'Hyper-Bot is currently unavailable.' };
    }
    try {
      const active = await deps.botsHub.current();
      active.runtime.decide(parsed.data.approvalId, parsed.data.approved, parsed.data.delivery);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
