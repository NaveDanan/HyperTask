import { createStore } from 'zustand';
import { validateEndpoint } from '@shared/openai-endpoint';
import { endpointErrorMessage, SettingsError } from './openai-endpoint-settings';

export interface HyperEndpointDiscoveryInput { baseUrl: string; protectedKey: string; apiKey?: string }
export interface HyperEndpointDiscoveryState {
  status: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  models: string[];
  error: string | null;
}
export type HyperEndpointDiscover = (input: HyperEndpointDiscoveryInput) => Promise<{ models: string[] }>;
const discover: HyperEndpointDiscover = async input => {
  const result = await window.appflowy.aiEndpoint.discover(input);
  if (!result.ok) throw new SettingsError(result.message, result.kind === 'format' || result.kind === 'state' ? result.kind : 'other');
  return result.value;
};

/** Credentials stay in the private request closure, never in observable state or storage. */
export function createHyperEndpointDiscovery(service: HyperEndpointDiscover = discover, delayMs = 650) {
  const store = createStore<HyperEndpointDiscoveryState>(() => ({ status: 'idle', models: [], error: null }));
  let active = false, generation = 0;
  let input: HyperEndpointDiscoveryInput | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async (request: HyperEndpointDiscoveryInput, version: number) => {
    if (!active || version !== generation) return;
    try {
      // Discovery tests the URL independently of the as-yet-unselected chat model.
      validateEndpoint(request.baseUrl, 'discovery');
      store.setState({ status: 'loading', models: [], error: null });
      const result = await service(request);
      if (!active || version !== generation) return;
      store.setState({ status: 'ready', models: [...new Set(result.models)].sort((a, b) => a.localeCompare(b)), error: null });
    } catch (error) {
      if (!active || version !== generation) return;
      const message = error instanceof Error && 'kind' in error ? error.message : endpointErrorMessage(error);
      store.setState({ status: 'error', models: [], error: message });
    }
  };
  return Object.assign(store, {
    start() {
      active = true;
      return () => {
        active = false; generation++; clearTimeout(timer); input = undefined;
      };
    },
    update(next: HyperEndpointDiscoveryInput) {
      if (!active) return;
      const normalized = { ...next, baseUrl: next.baseUrl.trim() };
      if (input?.baseUrl === normalized.baseUrl && input?.protectedKey === normalized.protectedKey && input?.apiKey === normalized.apiKey) return;
      input = normalized;
      const version = ++generation;
      clearTimeout(timer);
      store.setState({ status: input.baseUrl ? 'waiting' : 'idle', models: [], error: null });
      if (input.baseUrl) { const request = input; timer = setTimeout(() => { void run(request, version); }, delayMs); }
    },
    refresh() {
      if (!active || !input?.baseUrl) return;
      clearTimeout(timer);
      void run(input, ++generation);
    },
  });
}
