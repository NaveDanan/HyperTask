// env/cloud_env.dart of this checkout: the app is either a local workspace or a
// self-hosted Hypertask Cloud server. Any other stored state is normalized to local.
import { validateServerUrl } from '@shared/self-hosted-policy';
import { KVKeys, KeyValueStorage } from './kv';

export enum AuthenticatorType {
  Local = 0,
  HypertaskCloud = 2,
  HypertaskCloudSelfHost = 3,
  HypertaskCloudDevelop = 4,
}

export const isLocalType = (type: AuthenticatorType) => type === AuthenticatorType.Local;
export const isCloudEnabledType = (type: AuthenticatorType) => type !== AuthenticatorType.Local;

export interface HypertaskCloudConfiguration {
  base_url: string;
  ws_base_url: string;
  gotrue_url: string;
  enable_sync_trace: boolean;
  base_web_domain: string;
}

export interface HypertaskCloudSharedEnv {
  authenticatorType: AuthenticatorType;
  hypertaskCloudConfig: HypertaskCloudConfiguration;
}

const defaultConfig = (): HypertaskCloudConfiguration => ({
  base_url: '',
  ws_base_url: '',
  gotrue_url: '',
  enable_sync_trace: false,
  base_web_domain: 'https://hypertask.com',
});

export async function useLocalServer(): Promise<void> {
  await KeyValueStorage.set(KVKeys.cloudType, String(AuthenticatorType.Local));
  await KeyValueStorage.set(KVKeys.hypertaskCloudBaseURL, '');
  await KeyValueStorage.set(KVKeys.hypertaskBaseShareDomain, '');
}

/** getAuthenticatorType(): self-host with a valid URL, otherwise rewritten to local. */
export async function getAuthenticatorType(): Promise<AuthenticatorType> {
  const value = KeyValueStorage.get(KVKeys.cloudType);
  const url = KeyValueStorage.get(KVKeys.hypertaskCloudBaseURL);
  if (value === '3' && url !== null) {
    try {
      validateServerUrl(url);
      return AuthenticatorType.HypertaskCloudSelfHost;
    } catch {
      // Old or vendor settings are never restored.
    }
  }
  await useLocalServer();
  return AuthenticatorType.Local;
}

export async function useBaseWebDomain(url: string | null): Promise<void> {
  await KeyValueStorage.set(KVKeys.hypertaskBaseShareDomain, url ?? '');
}

/** useHypertaskBetaCloudWithURL: validates, strips one trailing slash, always type 3. */
export async function useSelfHostedServer(url: string): Promise<void> {
  validateServerUrl(url);
  await KeyValueStorage.set(KVKeys.cloudType, String(AuthenticatorType.HypertaskCloudSelfHost));
  await KeyValueStorage.set(KVKeys.hypertaskCloudBaseURL, url.endsWith('/') ? url.slice(0, -1) : url);
}

export const getHypertaskCloudUrl = () => KeyValueStorage.get(KVKeys.hypertaskCloudBaseURL) ?? '';
export const getHypertaskShareDomain = () => KeyValueStorage.get(KVKeys.hypertaskBaseShareDomain) ?? '';
const getSyncLogEnabled = () => (KeyValueStorage.get(KVKeys.enableSyncTrace) ?? '').toLowerCase() === 'true';

/** Dart's Uri host normalization lowercases the host in ws_base_url only. */
export function configurationFromUri(
  type: AuthenticatorType,
  baseURL: string,
  shareDomain: string,
  enableSyncTrace = false,
): HypertaskCloudConfiguration {
  try {
    const uri = new URL(baseURL);
    const scheme = uri.protocol === 'https:' ? 'wss' : 'ws';
    const port = uri.port ? `:${uri.port}` : '';
    return {
      base_url: baseURL,
      ws_base_url: `${scheme}://${uri.hostname.toLowerCase()}${port}/ws/v1`,
      gotrue_url: `${baseURL}/gotrue`,
      enable_sync_trace: enableSyncTrace,
      base_web_domain: type === AuthenticatorType.HypertaskCloud ? 'https://hypertask.com' : shareDomain,
    };
  } catch {
    return defaultConfig();
  }
}

export async function loadCloudSharedEnv(): Promise<HypertaskCloudSharedEnv> {
  const authenticatorType = await getAuthenticatorType();
  const hypertaskCloudConfig = isLocalType(authenticatorType)
    ? defaultConfig()
    : configurationFromUri(authenticatorType, getHypertaskCloudUrl(), getHypertaskShareDomain(), getSyncLogEnabled());
  return { authenticatorType, hypertaskCloudConfig };
}

export const isConfigValid = (config: HypertaskCloudConfiguration) =>
  config.base_url !== '' && config.ws_base_url !== '' && config.gotrue_url !== '';

/** isAuthEnabled: a cloud type with a complete configuration. */
export const isAuthEnabled = (env: HypertaskCloudSharedEnv) =>
  isCloudEnabledType(env.authenticatorType) && isConfigValid(env.hypertaskCloudConfig);
