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
/** Incremental text/event-stream reader. Nod sends only data fields; comments and other fields are skipped. */
export class HyperNodSseParser {
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private data: string[] = [];
  private size = 0;
  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const events: string[] = [];
    for (;;) {
      const end = this.buffer.search(/\r\n|\r|\n/);
      // A final \r may be the first half of a \r\n split across chunks.
      if (end < 0 || (this.buffer[end] === '\r' && end === this.buffer.length - 1)) break;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + (this.buffer.startsWith('\r\n', end) ? 2 : 1));
      if (!line) { if (this.data.length) events.push(this.data.join('\n')); this.data = []; this.size = 0; continue; }
      const colon = line.indexOf(':');
      if (colon === 0 || (colon < 0 ? line : line.slice(0, colon)) !== 'data') continue;
      const value = colon < 0 ? '' : line.slice(colon + (line[colon + 1] === ' ' ? 2 : 1));
      this.size += value.length + 1;
      if (this.size > MAX_EVENT) throw new Error('Nod sent an event larger than 1 MiB.');
      this.data.push(value);
    }
    if (this.buffer.length > MAX_EVENT) throw new Error('Nod sent an event larger than 1 MiB.');
    return events;
  }
}
/** Unknown or malformed events become a refresh, so the durable state decides what is shown. */
export function hyperNodEvent(data: string): HyperNodEvent {
  let value: unknown;
  try { value = JSON.parse(data); } catch { return { type: 'refresh' }; }
  const event = NodEvent.safeParse(value);
  if (!event.success) return { type: 'refresh' };
  if (event.data.type !== 'delta') return event.data;
  return { type: 'delta', threadId: event.data.threadId, turnId: event.data.turnId, text: event.data.text, streamId: event.data.streamId ?? null, done: event.data.done === true };
}
