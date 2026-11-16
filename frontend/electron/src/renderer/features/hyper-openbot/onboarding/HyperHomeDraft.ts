import type { HyperInitialDraft } from './HyperHomeApi';
import { hyperObserveDraftIdentity } from '../HyperConversationDraft';
/** Transient owner/version lease. A settled send may consume only its own snapshot. */
export class HyperHomeDraftStore {
  private held?: HyperInitialDraft & { userId: string };
  private revision = 0;
  read(userId: string) { if (this.held && this.held.userId !== userId) this.clear(); return this.held; }
  write(userId: string, draft: HyperInitialDraft) { this.held = { ...draft, userId }; return ++this.revision; }
  consume(userId: string, revision: number) { if (this.held?.userId !== userId || this.revision !== revision) return false; this.clear(); return true; }
  clear() { this.held = undefined; this.revision++; }
}
export const hyperHomeDraftStore = new HyperHomeDraftStore();
let observingIdentity = false;
/** Keep the identity listener until renderer exit so sign-out outside Chat clears Home drafts too. */
export function hyperObserveHomeDraftIdentity(subscribe: Parameters<typeof hyperObserveDraftIdentity>[1]) {
  if (observingIdentity) return;
  hyperObserveDraftIdentity({ invalidate: () => hyperHomeDraftStore.clear() }, subscribe);
  observingIdentity = true;
}
