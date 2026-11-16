// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest } from '../transport';
import { HyperLifecyclePath, type HyperBotLifecycle } from './HyperBotsApi';

export interface HyperLifecycleState {
  botId?: string;
  pending: boolean;
  data?: HyperBotLifecycle;
  error?: string;
}

/** One editor's lifecycle requests. Every completion must still own the bot and request version. */
export class HyperBotLifecycleStore {
  private state: HyperLifecycleState = { pending: false };
  private version = 0;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: HyperLifecycleState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  cancel = () => { ++this.version; };
  load = (botId: string) => this.request(botId, 'lifecycle', 'GET');
  change = (botId: string, action: 'pause' | 'resume' | 'notifications', body?: unknown) => {
    if (this.state.botId !== botId || this.state.pending || !this.state.data) return Promise.resolve();
    return this.request(botId, action, action === 'notifications' ? 'PUT' : 'POST', body);
  };
  private async request(botId: string, action: string, method: string, body?: unknown) {
    const version = ++this.version;
    this.publish({ botId, pending: true });
    try {
      const result = await hyperOpenBotRequest<{ lifecycle: HyperBotLifecycle }>(`${HyperLifecyclePath(botId)}/${action}`, method, body);
      if (version === this.version) this.publish({ botId, pending: false, data: result.lifecycle });
    } catch (error) {
      if (version === this.version) this.publish({ botId, pending: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
