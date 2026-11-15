// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotFetch, hyperOpenBotRequest, HYPER_OPENBOT_ORIGIN } from '../transport';
import type { HyperBotProfile } from '../bots/HyperBotsApi';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import type { HyperOnboardingUser } from './HyperOnboardingApi';
/** Lead-owned navigation must await creation/upload/send, reject on failure, and preserve File identity. */
export interface HyperInitialDraft { text: string; files: File[]; commandIds: string[]; submit: boolean }
export interface HyperHomeContext extends Omit<HyperOpenBotSectionContext, 'startConversation'> {
  /** Set by the parent only once the receiving composer consumes initialDraft. */
  initialDraftSupported?: boolean;
  startConversation(agentIds: string[], initialDraft?: HyperInitialDraft): void | Promise<void>;
}
export interface HyperHomeChannel { id: string; name: string; busy?: boolean; summary: string | null; opening?: string | null }
export interface HyperHomeChannelPage { channels: HyperHomeChannel[]; nextCursor: string | null }
export const HyperReadHomeChannels = (cursor?: string) => hyperOpenBotRequest<HyperHomeChannelPage>(`/api/channels${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export function HyperHomeGreeting(user: HyperOnboardingUser, noConversations: boolean) {
  const name = user.name?.trim();
  return noConversations && name && !user.needsName && name !== user.email ? `Hi ${name}, what would you like to work on?` : 'Start a conversation';
}
export function HyperDefaultHomeBot(bots: HyperBotProfile[]) {
  return bots.find(bot => bot.id === 'picked-harness') ?? bots.find(bot => bot.visibility === 'public') ?? bots[0];
}
export class HyperRoutingRefusedError extends Error {}
export function HyperRoutingText(text: string) {
  const trimmed = text.trim();
  const opening = trimmed.slice(0, 10000);
  const last = opening.charCodeAt(opening.length - 1);
  return trimmed.length > 10000 && last >= 0xd800 && last <= 0xdbff ? opening.slice(0, -1) : opening;
}
export async function HyperRouteHomeMessage(text: string, agentId?: string, skillSlugs: readonly string[] = [], signal?: AbortSignal) {
  const response = await hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + '/api/route', { method: 'POST', ...(signal ? { signal } : {}), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: HyperRoutingText(text), ...(agentId ? { agentId } : {}), ...(skillSlugs.length ? { skillSlugs } : {}) }) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { names?: unknown } | null;
    if (response.status === 409 && Array.isArray(body?.names) && body.names.every(name => typeof name === 'string')) throw new HyperRoutingRefusedError('More than one Bot matches. Choose a Bot before sending.');
    throw new Error("Couldn't pick a Bot.");
  }
  return (await response.json() as { agentId: string }).agentId;
}
export async function HyperStartHomeDraft(context: HyperHomeContext, bots: HyperBotProfile[], draft: HyperInitialDraft, chosen?: string, signal?: AbortSignal) {
  if (!context.initialDraftSupported) throw new Error('Initial draft transfer is unavailable in shared navigation.');
  const checkCurrent = () => { signal?.throwIfAborted(); if (context.isCurrentNavigation?.() === false) throw new Error('Home navigation cancelled.'); };
  checkCurrent();
  let agentId = chosen;
  try { agentId = await HyperRouteHomeMessage(draft.text, chosen, draft.commandIds, signal); }
  catch (error) {
    checkCurrent();
    if (!chosen && (draft.commandIds.length || error instanceof HyperRoutingRefusedError)) throw error;
    agentId = chosen ?? HyperDefaultHomeBot(bots)?.id;
  }
  checkCurrent();
  if (!agentId) throw new Error("There's no Bot to send this to. Reload the page.");
  await context.startConversation([agentId], draft);
}
