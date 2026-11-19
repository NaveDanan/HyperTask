export { HyperSseParser as HyperNodSseParser } from './HyperSseParser';
import { z } from 'zod';
import type { HyperNodEvent } from '@shared/HyperNod';
import { HyperNodActivitySchema } from './HyperNodWire';
const MAX_EVENT = 1024 * 1024;
const uuid = z.uuid();
const NodEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('refresh') }),
  z.object({ type: z.literal('activity'), items: z.array(HyperNodActivitySchema).max(500) }),
  z.object({ type: z.literal('delta'), threadId: uuid, turnId: uuid, text: z.string().max(MAX_EVENT), streamId: z.string().max(200).nullish(), done: z.boolean().optional() }),
]);
/** Unknown or malformed events become a refresh, so the durable state decides what is shown. */
export function hyperNodEvent(data: string): HyperNodEvent {
  let value: unknown;
  try { value = JSON.parse(data); } catch { return { type: 'refresh' }; }
  const event = NodEvent.safeParse(value);
  if (!event.success) return { type: 'refresh' };
  if (event.data.type !== 'delta') return event.data;
  return { type: 'delta', threadId: event.data.threadId, turnId: event.data.turnId, text: event.data.text, streamId: event.data.streamId ?? null, done: event.data.done === true };
}
