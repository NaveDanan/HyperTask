import fs from 'node:fs/promises';

interface HyperDevJwtOptions { packaged: boolean; rendererUrl?: string; enabled?: string; sessionFile?: string }

/** One-shot development bootstrap. Packaged apps and non-loopback renderer origins cannot use it. */
export class HyperDevJwtBootstrap {
  readonly enabled: boolean;
  private taken = false;
  private initialized!: (origin: string | null) => void;
  private ready = new Promise<string | null>(resolve => { this.initialized = resolve; });

  constructor(private options: HyperDevJwtOptions) {
    let localRenderer = false;
    try {
      const url = new URL(options.rendererUrl || '');
      localRenderer = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch { /* Regular packaged and preview launches are not development authentication. */ }
    this.enabled = !options.packaged && localRenderer && options.enabled === '1' && !!options.sessionFile;
  }

  coreReady(origin: string | null) { if (this.enabled) this.initialized(origin); }

  async take(): Promise<string | null> {
    if (!this.enabled || this.taken) return null;
    this.taken = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const origin = await Promise.race([this.ready, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 45000); })]).finally(() => clearTimeout(timer));
    if (!origin) throw new Error('Development JWT login requires an initialized self-hosted core.');
    const file = this.options.sessionFile!;
    let data: Record<string, unknown>;
    try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    finally { await fs.unlink(file).catch(() => {}); }
    if (!data || data.development !== true || data.server_origin !== new URL(origin).origin
      || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token
      || !Number.isSafeInteger(data.expires_in) || Number(data.expires_in) <= 0 || !Number.isSafeInteger(data.expires_at) || Number(data.expires_at) <= Date.now() / 1000) {
      throw new Error('Development JWT bootstrap did not match the initialized server or session.');
    }
    const fragment = new URLSearchParams({ access_token: data.access_token, refresh_token: data.refresh_token, token_type: 'bearer', expires_in: String(data.expires_in), expires_at: String(data.expires_at) });
    return 'hypertask-flutter://login-callback#' + fragment;
  }
}
