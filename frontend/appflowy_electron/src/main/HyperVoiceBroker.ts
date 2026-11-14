import { randomUUID } from 'node:crypto';
/** One-use provider capabilities. Secrets never cross IPC or reach the renderer. */
export class HyperVoiceBroker {
  private pending = new Map<string, { secret: string; expires: number; owner: number }>();
  sanitize(input: unknown, owner: number) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid voice configuration');
    const value = input as Record<string, unknown>;
    if (value.transport !== 'websocket') return value;
    if (value.url !== 'wss://api.x.ai/v1/realtime' || typeof value.clientSecret !== 'string' || !value.session || typeof value.session !== 'object') throw new Error('Invalid voice configuration');
    for (const [key, item] of this.pending) if (item.expires < Date.now()) this.pending.delete(key);
    if (this.pending.size >= 16) throw new Error('Too many pending voice calls');
    const id = randomUUID();
    this.pending.set(id, { secret: value.clientSecret, owner, expires: Date.now() + 60_000 });
    return { transport: 'websocket', url: `wss://hyper-openbot.invalid/api/voice/socket/${id}`, session: value.session };
  }
  take(path: string, owner: number) {
    const id = path.replace('/api/voice/socket/', ''); const item = this.pending.get(id);
    if (!item || item.owner !== owner || item.expires < Date.now()) throw new Error('Voice capability expired');
    this.pending.delete(id); return item.secret;
  }
}
