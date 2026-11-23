import { randomUUID } from 'node:crypto';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  HyperAssistantChannel as A,
  type HyperAssistantBotCandidate,
  type HyperAssistantConfirmedPerson,
  type HyperAssistantDispatchResult,
  type HyperAssistantPerson,
  type HyperVoiceCommandPlan,
} from '@shared/HyperAssistant';
import { HYPER_BOTS_TOOLS, type HyperBotConfig, type HyperBotsToolName } from '@shared/HyperBots';
import { extractBotMentions, hyperBotDisplayHandle } from '@shared/HyperBotResolver';
import type { HyperBotsHub } from './HyperBotsHub';
import { HyperPeopleResolver, type HyperPeopleBridge } from './HyperPeopleResolver';
import type { HyperTrustedWindowRegistry } from './HyperTrustedWindows';
import {
  HyperVoiceCommandParser,
  buildBotCandidate,
  serializeVerifiedMention,
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

const ConfirmedPersonSchema = z.strictObject({
  slotId: z.string().max(64).optional(),
  rawName: z.string().max(256).optional(),
  name: z.string().trim().min(1).max(512),
  email: z.email().max(320),
});

const DispatchArgs = z.strictObject({
  botId: slug,
  targetRoomId: slug.nullable().optional(),
  text: z.string().trim().min(1, 'Write or speak a command first.').max(20000),
  confirmedPeople: z.array(ConfirmedPersonSchema).max(20).default([]),
  enableMissingTools: z.array(z.enum(toolNames)).max(toolNames.length).optional(),
  clientMessageId: uuid.optional(),
  model: z.string().trim().min(1).max(200).nullable().optional(),
});

const DecideApprovalArgs = z.strictObject({
  approvalId: uuid,
  approved: z.boolean(),
  delivery: z.enum(['send', 'draft']).optional(),
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Produces the final message posted to Hyper-Bot: ensures the confirmed target bot handle is present
 * and substitutes/attaches verified `@[Display Name](mailto:email)` tokens for every confirmed person.
 */
export function buildDispatchedAssistantText(
  text: string,
  bot: Pick<HyperBotConfig, 'id' | 'name'>,
  confirmedPeople: readonly HyperAssistantConfirmedPerson[],
): string {
  let out = text.trim();
  const uninserted: string[] = [];

  for (const person of confirmedPeople) {
    const emailLower = person.email.trim().toLowerCase();
    const token = serializeVerifiedMention(person.name.trim(), emailLower);
    if (out.toLowerCase().includes(`(mailto:${emailLower})`)) {
      continue;
    }

    const needles = [
      person.rawName ? `@${person.rawName.trim()}` : '',
      `@${person.name.trim()}`,
      person.rawName?.trim() ?? '',
      person.name.trim(),
    ]
      .filter((n) => n.length >= 2)
      .sort((a, b) => b.length - a.length);

    let replaced = false;
    for (const needle of [...new Set(needles)]) {
      // Avoid replacing inside an existing @[...](mailto:...) token
      const re = new RegExp(`(?<!@\\[)${escapeRegex(needle)}(?!\\]\\(mailto:)`, 'iu');
      if (re.test(out)) {
        out = out.replace(re, token);
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      uninserted.push(token);
    }
  }

  if (uninserted.length) {
    out = `${out} (${uninserted.join(', ')})`.trim();
  }

  const handle = hyperBotDisplayHandle(bot);
  if (!extractBotMentions(out, [bot]).length) {
    out = `${handle} ${out}`.trim();
  }

  return out;
}

const CHANNELS = [A.ParseCommand, A.SearchPeople, A.Dispatch, A.DecideApproval, A.ListBots];

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
    let settings = active.runtime.settings();
    let bot = settings.bots.find((b) => b.id === input.botId);
    if (!bot) {
      return { ok: false, error: 'That bot is no longer configured.' };
    }

    // Enable requested missing Outlook tools on the target bot before posting (writes still require owner approval).
    if (input.enableMissingTools?.length) {
      const mergedTools = toolNames.filter((name) => bot!.tools.includes(name) || input.enableMissingTools!.includes(name));
      if (mergedTools.length !== bot.tools.length) {
        try {
          settings = active.runtime.saveSettings({
            ...settings,
            bots: settings.bots.map((row) => (row.id === bot!.id ? { ...row, tools: mergedTools } : row)),
          });
          bot = settings.bots.find((b) => b.id === input.botId) ?? bot;
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    }

    const requestedRoom = input.targetRoomId
      ? settings.rooms.find((r) => r.id === input.targetRoomId && r.botIds.includes(bot!.id))
      : undefined;
    const directRoom = settings.rooms.find(
      (r) => r.kind === 'direct' && r.botIds.length === 1 && r.botIds[0] === bot!.id,
    );
    const fallbackRoom = settings.rooms.find((r) => r.botIds.includes(bot!.id));
    const room = requestedRoom ?? directRoom ?? fallbackRoom;
    if (!room) {
      return { ok: false, error: `Could not find a conversation room for ${bot.name}.` };
    }

    const dispatchedText = buildDispatchedAssistantText(input.text, bot, input.confirmedPeople);

    try {
      const posted = await active.runtime.post({
        roomId: room.id,
        clientMessageId: input.clientMessageId ?? randomUUID(),
        text: dispatchedText,
        model: input.model ?? null,
      });
      return {
        ok: true,
        roomId: room.id,
        messageId: posted.message.id,
        runId: posted.runs[0]?.id ?? null,
        botId: bot.id,
        botName: bot.name,
        dispatchedText,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
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
