import { create } from 'zustand';
import { HyperEntraConfigSchema, HyperEntraConfigKey, HyperEntraSignOutKey } from '@shared/HyperEntra';
import { KeyValueStorage } from '@/startup/kv';
import { passGotrueTokenResponse, useDeepLinkStore } from '@/startup/deep-link';
import { HyperEntraFlow, type HyperEntraState } from './HyperEntraFlow';
export const useHyperEntraStore = create<HyperEntraState>(() => ({ phase: 'idle', name: '', reason: '' }));
export function hyperEntraConfig() { const parsed = HyperEntraConfigSchema.safeParse(KeyValueStorage.getJson(HyperEntraConfigKey)); return parsed.success ? parsed.data : null; }
export const hyperEntraSignedOut = () => KeyValueStorage.get(HyperEntraSignOutKey) === 'true';
export const hyperEntraRecordSignOut = () => KeyValueStorage.set(HyperEntraSignOutKey, 'true');
export const hyperEntraFlow = new HyperEntraFlow({
  token: config => window.hypertask.auth.entraIdToken(config), cancel: () => window.hypertask.auth.entraCancel(),
  request: options => window.hypertask.net.request(options),
  handoff: async token => { await passGotrueTokenResponse(token); if (useDeepLinkStore.getState().state === 'error') throw new Error('session handoff failed'); },
  signedIn: () => KeyValueStorage.remove(HyperEntraSignOutKey), changed: state => useHyperEntraStore.setState(state),
});
