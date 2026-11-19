import { z } from 'zod';

export const HYPER_BOTS_HOST_BODY = 15 * 1024 * 1024;

export function hyperBotsHostEncode(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) => field instanceof Uint8Array
    ? { hyperBotBytes: Buffer.from(field).toString('base64') }
    : field);
}

export function hyperBotsHostDecode(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('hyperBotBytes' in value) || typeof value.hyperBotBytes !== 'string') return value;
    return Uint8Array.from(Buffer.from(value.hyperBotBytes, 'base64'));
  }) as unknown;
}

export const HyperBotsHostEvent = z.union([
  z.object({ type: z.literal('settings') }),
  z.object({ type: z.literal('message'), roomId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal('run'), roomId: z.string(), runId: z.string(), status: z.enum(['queued', 'running', 'waiting_approval', 'done', 'failed']) }),
  z.object({ type: z.literal('preview'), roomId: z.string(), runId: z.string(), botId: z.string(), text: z.string().max(20_000) }),
  z.object({ type: z.literal('approval'), roomId: z.string(), approvalId: z.string(), status: z.enum(['pending', 'approved', 'denied', 'executing', 'done', 'failed', 'unknown', 'skipped']) }),
]);
