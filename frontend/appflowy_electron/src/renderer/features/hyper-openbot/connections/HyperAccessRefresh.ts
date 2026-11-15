// Adapted from OpenBot lib/plugins/mutations.ts. Copyright (c) 2026 CopilotKit. MIT; see ../LICENSE.
export interface HyperAccessChange { requestOnly: true; app: string; agentId: string }
const listeners = new Set<(change?: HyperAccessChange) => void>();
export function hyperSubscribeAppAccess(listener: (change?: HyperAccessChange) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** A refused write may have enabled an app or saved some grants. Refresh on every settlement. */
export function hyperInvalidateAppAccess(change?: HyperAccessChange) { for (const listener of [...listeners]) listener(change); }

const waitingConnections = new Set<() => boolean>();
/** A safe main return may wake a still-mounted transaction, but proves no vendor outcome. */
export function hyperWatchPendingConnection(check: () => boolean) { waitingConnections.add(check); return () => { waitingConnections.delete(check); }; }
export function hyperRefreshPendingConnection() {
  let handled = false;
  for (const check of [...waitingConnections]) handled = check() || handled;
  return handled;
}
