import { create } from '@bufbuild/protobuf';
import { GotrueTokenResponsePBSchema, type GotrueTokenResponsePB } from '@shared/protobuf/hyper-user/auth_pb';
import type { HyperEntraConfig, HyperEntraToken } from '@shared/HyperEntra';
import type { IpcResult, HttpResponse } from '@shared/api';
export interface HyperEntraState { phase: 'idle' | 'broker' | 'exchange' | 'handoff' | 'error'; name: string; reason: string }
interface HyperEntraDependencies {
  token(config: HyperEntraConfig): Promise<IpcResult<HyperEntraToken>>;
  cancel(): Promise<void>;
  request(options: { url: string; method: string; headers: Record<string, string>; body: string }): Promise<HttpResponse>;
  handoff(token: GotrueTokenResponsePB): Promise<void>;
  signedIn(): Promise<void>;
  changed(state: HyperEntraState): void;
}
export class HyperEntraFlow {
  state: HyperEntraState = { phase: 'idle', name: '', reason: '' };
  private epoch = 0;
  private attempted = false;
  constructor(private deps: HyperEntraDependencies) {}
  private set(patch: Partial<HyperEntraState>) { this.state = { ...this.state, ...patch }; this.deps.changed(this.state); }
  async start(config: HyperEntraConfig | null, baseUrl: string, automatic = false, signedOut = false) {
    if (automatic && (this.attempted || signedOut || !config || !baseUrl)) return;
    if (automatic) this.attempted = true;
    if (['broker', 'exchange', 'handoff'].includes(this.state.phase)) return;
    if (!config) { this.set({ phase: 'error', reason: 'Company sign-in is not configured. Enter the Tenant and Application IDs under Microsoft Entra ID in Connections. On the sign-in screen, use the settings button.' }); return; }
    const epoch = ++this.epoch, current = () => epoch === this.epoch;
    this.set({ phase: 'broker', name: '', reason: '' });
    try {
      const token = await this.deps.token(config); if (!current()) return;
      if (!token.ok) { this.set({ phase: 'error', reason: token.message }); return; }
      this.set({ phase: 'exchange', name: token.value.name });
      const response = await this.deps.request({ url: baseUrl.replace(/\/$/, '') + '/gotrue/token?grant_type=id_token', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'azure', id_token: token.value.idToken, ...(token.value.nonce ? { nonce: token.value.nonce } : {}) }) });
      if (!current()) return;
      if (response.status !== 200) { this.set({ phase: 'error', reason: 'The login server rejected company sign-in (' + response.status + '). Ask IT to check the Azure provider and Application ID, or use another sign-in method.' }); return; }
      let json;
      try { json = JSON.parse(response.body); } catch { throw new Error('invalid response'); }
      if (!json || typeof json.access_token !== 'string' || !json.access_token || typeof json.refresh_token !== 'string' || !json.refresh_token || typeof json.expires_in !== 'number' || !Number.isSafeInteger(json.expires_in) || json.expires_in <= 0) throw new Error('invalid response');
      const tokenResponse = create(GotrueTokenResponsePBSchema, { accessToken: json.access_token, refreshToken: json.refresh_token, tokenType: typeof json.token_type === 'string' ? json.token_type : 'bearer', expiresIn: BigInt(json.expires_in), expiresAt: BigInt(Number.isSafeInteger(json.expires_at) ? json.expires_at : Math.floor(Date.now()/1000) + json.expires_in) });
      this.set({ phase: 'handoff' });
      await this.deps.handoff(tokenResponse);
      if (current()) { await this.deps.signedIn(); this.set({ phase: 'idle', name: '', reason: '' }); }
    } catch { if (current()) this.set({ phase: 'error', reason: 'Company sign-in could not finish. Check your connection and server configuration, then try again or use another sign-in method.' }); }
  }
  cancel() { this.epoch++; this.set({ phase: 'idle', reason: 'Company sign-in was cancelled.', name: '' }); void this.deps.cancel().catch(() => {}); }
}
