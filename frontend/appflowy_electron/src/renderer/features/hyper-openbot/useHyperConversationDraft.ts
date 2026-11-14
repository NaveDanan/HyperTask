import { useMemo, useSyncExternalStore } from 'react';
import { HyperConversationDraftCache, hyperObserveDraftIdentity } from './HyperConversationDraft';

const cache = new HyperConversationDraftCache();
let observing = false;
export function useHyperConversationDraft(channelId: string) {
  const lease = useMemo(() => {
    if (!observing) {
      // This one listener intentionally outlives individual pages. Sign-out must clear
      // drafts even when Chat is not mounted; closing the renderer discards the cache.
      hyperObserveDraftIdentity(cache, listener => window.appflowy.hyperOpenBot.service.onState(listener));
      observing = true;
    }
    return cache.acquire(channelId);
  }, [channelId]);
  return { draft: useSyncExternalStore(lease.subscribe, lease.get, lease.get), updateDraft: lease.update, prepareSubmission: lease.prepareSubmission };
}
