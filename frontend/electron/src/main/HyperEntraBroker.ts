import { createHash, randomBytes } from 'node:crypto';
import type { AccountInfo, AuthenticationResult, InteractiveRequest, SilentFlowRequest } from '@azure/msal-node';
import { HyperEntraConfigSchema, hyperEntraRedirectUri, type HyperEntraConfig, type HyperEntraToken } from '@shared/HyperEntra';
import { SettingsError } from './settings-error';
export interface HyperEntraClient {
  acquireTokenSilent(request: SilentFlowRequest): Promise<Pick<AuthenticationResult, 'idToken' | 'account' | 'tenantId' | 'idTokenClaims'>>;
  acquireTokenInteractive(request: InteractiveRequest): Promise<Pick<AuthenticationResult, 'idToken' | 'account' | 'tenantId' | 'idTokenClaims'>>;
}
export async function hyperCreateEntraClient(config: HyperEntraConfig): Promise<HyperEntraClient> {
  if (process.platform !== 'win32') throw new SettingsError('unsupported', 'Windows account broker is unavailable on this platform.');
  try {
    const [{ PublicClientApplication }, { NativeBrokerPlugin }] = await Promise.all([import('@azure/msal-node'), import('@azure/msal-node-extensions')]);
    const plugin = new NativeBrokerPlugin();
    if (!plugin.isBrokerAvailable) throw new Error('unavailable');
    return new PublicClientApplication({
      auth: { clientId: config.clientId, authority: 'https://login.microsoftonline.com/' + config.tenantId },
      broker: { nativeBrokerPlugin: plugin },
      system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
    });
  } catch { throw new SettingsError('unsupported', 'Windows account broker is unavailable. Use another sign-in method or ask IT to check the desktop broker installation.'); }
}
const hyperNeedsInteraction = (error: unknown) => error && typeof error === 'object' && 'errorCode' in error && ['interaction_required', 'consent_required', 'login_required', 'no_account_found'].includes(String(error.errorCode));
export class HyperEntraBroker {
  private epoch = 0;
  private busy = false;
  constructor(private createClient = hyperCreateEntraClient) {}
  cancel() { this.epoch++; }
  async idToken(input: unknown, windowHandle?: Buffer): Promise<HyperEntraToken> {
    const valid = HyperEntraConfigSchema.safeParse(input);
    if (!valid.success) throw new SettingsError('format', 'Company sign-in is not configured. Enter valid Tenant and Application IDs in Microsoft Entra ID settings.');
    if (this.busy) throw new SettingsError('state', 'A Windows sign-in is still finishing. Close the account picker and try again.');
    this.busy = true; const epoch = ++this.epoch;
    const current = () => { if (epoch !== this.epoch) throw new SettingsError('state', 'Company sign-in was cancelled.'); };
    try {
      const client = await this.createClient(valid.data); current();
      const scopes = ['openid', 'profile', 'email'];
      const nonce = randomBytes(32).toString('hex'), nonceHash = createHash('sha256').update(nonce).digest('hex');
      const extraQueryParameters = { nonce: nonceHash };
      // An account without nativeAccountId deliberately selects WAM SignInSilentlyAsync:
      // the broker uses the default Windows account, including on the first app launch.
      const account: AccountInfo = { homeAccountId: '', environment: 'login.microsoftonline.com', tenantId: valid.data.tenantId, username: '', localAccountId: '' };
      let result;
      try { result = await client.acquireTokenSilent({ scopes, account, extraQueryParameters, redirectUri: hyperEntraRedirectUri(valid.data.clientId) }); }
      catch (error) {
        current();
        if (!hyperNeedsInteraction(error)) throw error;
        result = await client.acquireTokenInteractive({ scopes, windowHandle, extraQueryParameters, redirectUri: hyperEntraRedirectUri(valid.data.clientId), openBrowser: async () => { throw new Error('Native broker required'); } });
      }
      current();
      if (!result.idToken || result.tenantId.toLowerCase() !== valid.data.tenantId.toLowerCase()) throw new SettingsError('state', 'Windows returned no ID token for the configured company tenant. Ask IT to check the application registration.');
      const claims = result.idTokenClaims as Record<string, unknown>;
      if (claims.aud !== valid.data.clientId && !(Array.isArray(claims.aud) && claims.aud.includes(valid.data.clientId))) throw new SettingsError('state', 'Windows returned an ID token for a different application. Check the Application ID.');
      // GoTrue verifies SHA256(raw nonce). The broker receives the hash; only its
      // matching preimage accompanies the exchange. Cached nonce-free tokens omit it.
      if (claims.nonce && claims.nonce !== nonceHash) throw new SettingsError('state', 'The Windows token nonce could not be verified. Try signing in again or ask IT to check broker ID-token support.');
      return { idToken: result.idToken, ...(claims.nonce ? { nonce } : {}), name: result.account?.name || result.account?.username || 'your company account' };
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      const code = error && typeof error === 'object' && 'errorCode' in error ? String(error.errorCode) : '';
      throw new SettingsError('state', code === 'user_canceled' ? 'Company sign-in was cancelled.' : hyperNeedsInteraction(error) ? 'Windows needs account approval. Try signing in again or use another sign-in method.' : 'Windows company sign-in failed. Check your company connection and Application ID, or use another sign-in method.');
    } finally { this.busy = false; }
  }
}
