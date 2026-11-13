import type { ReceivePort } from '@/backend/ports';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { createHyperChatBackend, type HyperChatBackend, type HyperChatEvent } from './HyperChatBackend';

export class HyperChatOwnerError extends Error {
  constructor() { super('The chat workspace or account changed.'); this.name = 'HyperChatOwnerError'; }
}
type RefreshKind = 'messages' | 'settings' | 'models';
interface Subscription {
  chatId: string;
  active: boolean;
  listener: (event: HyperChatEvent) => void;
  close(): void;
  running: Set<RefreshKind>;
  dirty: Set<RefreshKind>;
}

/** Chat notifications have no actor/server identity. Use them only to refetch current
 * data; stream completion must arrive on the request's private answer port. */
export function createHyperScopedChatBackend(owner: HyperDocumentOwner, injected?: HyperChatBackend): HyperChatBackend {
  const current = () => { try { return owner.isCurrent(); } catch { return false; } };
  const base = injected ?? createHyperChatBackend(current);
  const subscriptions = new Set<Subscription>();
  const ports = new Map<bigint, ReceivePort>();
  const requests = new Map<bigint, string>();
  const requireCurrent = () => { if (!current()) throw new HyperChatOwnerError(); };
  const closeSubscription = (subscription: Subscription) => {
    if (!subscription.active) return;
    subscription.active = false; subscriptions.delete(subscription); subscription.close();
  };
  const stale = () => {
    // Old cleanup must never dispatch StopStream to a new owner's matching chat ID.
    // Finish the old store's local wait so its disposal can release every listener.
    for (const subscription of [...subscriptions]) {
      subscription.listener({ type: 'finish' }); closeSubscription(subscription);
    }
    for (const port of [...ports.values()]) port.close();
    requests.clear();
  };
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!current()) { stale(); throw new HyperChatOwnerError(); }
    let result: T;
    try { result = await operation(); }
    catch (error) { if (!current()) { stale(); throw new HyperChatOwnerError(); } throw error; }
    if (!current()) { stale(); throw new HyperChatOwnerError(); }
    return result;
  };
  const finish = (chatId: string) => {
    for (const subscription of [...subscriptions]) if (subscription.active && subscription.chatId === chatId) subscription.listener({ type: 'finish' });
  };
  const refresh = (subscription: Subscription, kind: RefreshKind) => {
    if (!subscription.active) return;
    if (!current()) { stale(); return; }
    subscription.dirty.add(kind);
    if (subscription.running.has(kind)) return;
    subscription.running.add(kind);
    void (async () => {
      try {
        while (subscription.active && subscription.dirty.delete(kind)) {
          let event: HyperChatEvent;
          if (kind === 'messages') event = { type: 'messages', messages: (await guarded(() => base.load(subscription.chatId))).messages };
          else if (kind === 'settings') event = { type: 'settings', settings: await guarded(() => base.settings(subscription.chatId)) };
          else event = { type: 'models', selection: await guarded(() => base.models(subscription.chatId)) };
          if (subscription.active && current()) subscription.listener(event);
        }
      } catch (error) {
        if (subscription.active && current()) subscription.listener({ type: 'error', error: error instanceof Error ? error.message : 'Could not refresh this chat.' });
      } finally { subscription.running.delete(kind); }
    })();
  };
  return {
    load: (chatId, before) => guarded(() => base.load(chatId, before)),
    settings: chatId => guarded(() => base.settings(chatId)),
    models: chatId => guarded(() => base.models(chatId)),
    sources: () => guarded(() => base.sources()),
    selectModel: (chatId, model) => guarded(() => base.selectModel(chatId, model)),
    setSources: (chatId, ids) => guarded(() => base.setSources(chatId, ids)),
    async send(chatId, message, answerPort, questionPort) {
      requireCurrent();
      if (!ports.has(answerPort) || !ports.has(questionPort)) throw new Error('The chat stream ports are no longer available.');
      requests.set(answerPort, chatId);
      try { return await guarded(() => base.send(chatId, message, answerPort, questionPort)); }
      catch (error) { requests.delete(answerPort); throw error; }
    },
    async stop(chatId) {
      if (!current()) { stale(); return; }
      try { await base.stop(chatId); }
      catch (error) { if (!current()) { stale(); return; } throw error; }
      if (!current()) stale();
    },
    listen(chatId, listener) {
      requireCurrent();
      const subscription: Subscription = { chatId, listener, active: true, close: () => {}, running: new Set(), dirty: new Set() };
      subscriptions.add(subscription);
      subscription.close = base.listen(chatId, event => {
        if (!subscription.active) return;
        if (!current()) { stale(); return; }
        if (event.type === 'message' || event.type === 'messages') refresh(subscription, 'messages');
        else if (event.type === 'settings') refresh(subscription, 'settings');
        else if (event.type === 'model' || event.type === 'models') refresh(subscription, 'models');
        // Global finish/error cannot be assigned to this request or owner.
      });
      if (!subscription.active) subscription.close();
      else if (!current()) stale();
      return () => closeSubscription(subscription);
    },
    openPort(listener) {
      requireCurrent();
      let id: bigint | undefined;
      const original = base.openPort(value => {
        if (!current()) { stale(); return; }
        if (id === undefined || !ports.has(id)) return;
        const chatId = requests.get(id);
        listener(value);
        if (chatId && typeof value === 'string' && value.startsWith('finish:')) {
          requests.delete(id); finish(chatId);
        }
      });
      id = original.port;
      const result = { port: id, close: () => { if (!ports.has(original.port)) return; ports.delete(original.port); requests.delete(original.port); original.close(); } };
      ports.set(id, result);
      if (!current()) { stale(); throw new HyperChatOwnerError(); }
      return result;
    },
  };
}
