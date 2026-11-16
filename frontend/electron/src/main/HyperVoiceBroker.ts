import { randomUUID } from 'node:crypto';
/** One-use provider capabilities. Secrets never cross IPC or reach the renderer. */
export class HyperVoiceBroker {
  private pending = new Map<string, { secret: string; destination: string; expires: number; owner: number }>();
  sanitize(input: unknown, owner: number, signal?: AbortSignal) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid voice configuration');
    signal?.throwIfAborted();
    const value = input as Record<string, unknown>;
    if (value.transport === 'webrtc' && typeof value.sdp === 'string') return { transport: 'webrtc', sdp: value.sdp };
    if (value.transport !== 'websocket' || typeof value.url !== 'string' || typeof value.clientSecret !== 'string' || !value.clientSecret || !value.session || typeof value.session !== 'object' || Array.isArray(value.session)) throw new Error('Invalid voice configuration');
    let destination: URL;
    try { destination = new URL(value.url); } catch { throw new Error('Invalid voice configuration'); }
    // Upstream includes the configured model in the query. Keep it without admitting
    // another host, credentials, fragment or arbitrary provider query parameters.
    if (destination.origin !== 'wss://api.x.ai' || destination.pathname !== '/v1/realtime' || destination.username || destination.password || destination.hash || [...destination.searchParams.keys()].some(key => key !== 'model') || destination.searchParams.getAll('model').length > 1 || (destination.searchParams.has('model') && !destination.searchParams.get('model')?.trim())) throw new Error('Invalid voice configuration');
    for (const [key, item] of this.pending) if (item.expires < Date.now()) this.pending.delete(key);
    if (this.pending.size >= 16) throw new Error('Too many pending voice calls');
    const id = randomUUID();
    this.pending.set(id, { secret: value.clientSecret, destination: destination.href, owner, expires: Date.now() + 60_000 });
    const revoke = () => { this.pending.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', revoke); };
    const timer = setTimeout(revoke, 60_000); timer.unref();
    signal?.addEventListener('abort', revoke, { once: true });
    return { transport: 'websocket', url: `wss://hyper-openbot.invalid/api/voice/socket/${id}`, session: value.session };
  }
  take(path: string, owner: number) {
    const id = path.replace('/api/voice/socket/', ''); const item = this.pending.get(id);
    if (!item || item.owner !== owner || item.expires < Date.now()) throw new Error('Voice capability expired');
    this.pending.delete(id); return { secret: item.secret, destination: item.destination };
  }
}
