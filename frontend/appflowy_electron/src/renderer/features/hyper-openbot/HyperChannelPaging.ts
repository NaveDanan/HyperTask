import { hyperOpenBotRequest } from './transport';
import type { HyperConversation } from './screens';
export type HyperChannel = HyperConversation & { threadId: string; agentIds: string[]; active: boolean };
export async function hyperLoadAllChannels(read: typeof hyperOpenBotRequest = hyperOpenBotRequest) {
  const channels: HyperChannel[] = [];
  const seen = new Set<string>(); let cursor: string | null = null;
  do {
    const page: { channels: HyperChannel[]; nextCursor: string | null } = await read(`/api/channels${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    channels.push(...page.channels);
    if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('Conversation paging returned a repeated cursor');
    cursor = page.nextCursor ?? null; if (cursor) seen.add(cursor);
  } while (cursor);
  return { channels: [...new Map(channels.map(channel => [channel.id, channel])).values()] };
}
