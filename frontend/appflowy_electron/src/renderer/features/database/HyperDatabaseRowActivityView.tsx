import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperDocumentOwnerKey, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { HyperDatabaseRowActivity, type HyperDatabaseRowActivityBackend, type HyperDatabaseRowActivityState } from './HyperDatabaseRowActivity';

export const hyperDatabaseRowActivityStrings = {
  title: 'Live row updates are unavailable',
  description: 'Saved values and unfinished edits are kept. Retry to reconnect the visible rows.',
  capacity: 'Close all panes of this dataset and reopen it to reconnect live row updates. Unfinished edits are kept.',
  retry: 'Retry live updates',
} as const;
const idle: HyperDatabaseRowActivityState = { status: 'idle', error: null, desiredCount: 0, confirmedCount: 0, revision: 0n, confirmedRevision: null };
const noSubscription = () => () => {};
const idleSnapshot = () => idle;
const subscribeOwner = (listener: () => void) => {
  const workspace = useWorkspaceStore.subscribe(listener), app = useAppStore.subscribe(listener);
  return () => { workspace(); app(); };
};
// Use the same monotonic source as the captured owner. Value-only React selectors
// can miss an account or storage transition that returns before the next render.
const ownerVersion = () => hyperDocumentDuplicateBackend.ownerVersion!();
interface ActivityContext {
  activity: HyperDatabaseRowActivity | null;
  error: boolean;
  capacity: boolean;
  retrying: boolean;
  retry(): void;
  inputError(source: symbol, error: string | null): void;
}
const Context = createContext<ActivityContext | null>(null);

/** One provider belongs to one pane, not one property or one writable editor. */
export function HyperDatabaseRowActivityProvider({ owner, databaseId, viewId, contextId, backend, activated, refreshContext, children }: {
  owner: HyperDocumentOwner;
  databaseId: string;
  viewId: string;
  contextId: string;
  backend: HyperDatabaseRowActivityBackend;
  activated(): void;
  refreshContext(): Promise<string>;
  children: ReactNode;
}) {
  const launchId = useAppStore(state => state.launchId);
  const ownerGeneration = useSyncExternalStore(subscribeOwner, ownerVersion);
  const key = JSON.stringify([hyperDocumentOwnerKey(owner), launchId, ownerGeneration, databaseId, viewId, contextId]);
  const scopeKey = JSON.stringify([hyperDocumentOwnerKey(owner), launchId, ownerGeneration, databaseId, viewId]);
  const recovery = useRef({ scopeKey, attempted: false });
  if (recovery.current.scopeKey !== scopeKey) recovery.current = { scopeKey, attempted: false };
  const latest = useRef({ key, activated, refreshContext }); latest.current = { key, activated, refreshContext };
  const [entry, setEntry] = useState<{ key: string; activity: HyperDatabaseRowActivity; owner: HyperDocumentOwner } | null>(null);
  const [inputErrors, setInputErrors] = useState(new Map<symbol, string>());
  const [retryError, setRetryError] = useState(false), [retrying, setRetrying] = useState(false);
  const retryVersion = useRef(0);
  useEffect(() => {
    retryVersion.current++;
    setRetrying(false); setRetryError(false); setInputErrors(new Map());
    const captured = hyperCaptureDuplicateOwner(owner);
    if (!captured?.isCurrent() || !databaseId || !contextId) { setEntry(null); return; }
    const activity = new HyperDatabaseRowActivity({ owner: captured, viewId, contextId, backend, activated: () => {
      if (latest.current.key === key && captured.isCurrent()) latest.current.activated();
    } });
    setEntry({ key, activity, owner: captured });
    // Construction inside the effect also gives StrictMode's replacement setup a
    // fresh activity ID after its test cleanup has released the previous one.
    return () => { retryVersion.current++; void activity.dispose(); };
  }, [key, backend]);
  const active = entry?.key === key && entry.owner.isCurrent() ? entry : null;
  const activity = active?.activity ?? null;
  const state = useSyncExternalStore(activity?.subscribe ?? noSubscription, activity?.getSnapshot ?? idleSnapshot);
  // Child window effects run first and contribute their union. Empty panes still
  // enroll, so another pane's terminal close cannot retire their live view.
  useEffect(() => { activity?.start(); }, [activity]);
  useEffect(() => {
    if (!active || state.status !== 'error' || state.confirmedRevision !== null || recovery.current.attempted) return;
    recovery.current.attempted = true;
    const captured = active, capturedKey = key;
    // Last-pane disposal may retire a token between GetDatabase and first
    // enrollment. One scoped read can supply a new token. An unchanged token or
    // another failure stays at explicit Retry; edits are never replayed.
    if (captured.owner.isCurrent() && latest.current.key === capturedKey) void latest.current.refreshContext().catch(() => {});
  }, [activity, state.status, state.confirmedRevision, key]);
  const inputError = useCallback((source: symbol, error: string | null) => setInputErrors(previous => {
    if (previous.get(source) === error || error === null && !previous.has(source)) return previous;
    const next = new Map(previous); if (error === null) next.delete(source); else next.set(source, error); return next;
  }), [key]);
  const retry = () => {
    const captured = hyperCaptureDuplicateOwner(owner);
    if (retrying || !captured?.isCurrent()) return;
    const version = ++retryVersion.current, capturedKey = key, current = active;
    recovery.current.attempted = true;
    setRetrying(true); setRetryError(false);
    void latest.current.refreshContext().then(freshContext => {
      if (version !== retryVersion.current || latest.current.key !== capturedKey || !captured.isCurrent() || current && !current.owner.isCurrent()) return;
      if (freshContext === contextId) current?.activity.retry();
      // A changed context creates a new coordinator and re-registers its windows.
    }).catch(() => { if (version === retryVersion.current && latest.current.key === capturedKey && captured.isCurrent() && (!current || current.owner.isCurrent())) setRetryError(true); })
      .finally(() => { if (version === retryVersion.current && latest.current.key === capturedKey && captured.isCurrent() && (!current || current.owner.isCurrent())) setRetrying(false); });
  };
  const error = owner.isCurrent() && (retryError || inputErrors.size > 0 || state.status === 'error' || !!databaseId && !contextId);
  const capacity = state.error?.includes('Close all panes of this dataset and reopen it.') ?? false;
  return <Context.Provider value={{ activity, error, capacity, retrying, retry, inputError }}>{children}</Context.Provider>;
}

/** Mount beside a rendered row window. Multiple days or details can refer to the
 * same row; the pane coordinator sends their union instead of per-cell requests. */
export function HyperDatabaseRowActivityRows({ rowIds }: { rowIds: readonly string[] }) {
  const context = useContext(Context), source = useRef(Symbol('visible-row-window'));
  const activity = context?.activity ?? null, inputError = context?.inputError;
  const key = JSON.stringify([...new Set(rowIds)].sort());
  useEffect(() => {
    if (!activity) return;
    try { activity.rows(source.current, JSON.parse(key) as string[]); inputError?.(source.current, null); }
    catch (error) { inputError?.(source.current, (error as Error).message); }
    return () => { activity.rows(source.current, []); inputError?.(source.current, null); };
  }, [activity, key, inputError]);
  return null;
}

export function HyperDatabaseRowActivityNotice() {
  const context = useContext(Context), { tr } = useTr();
  if (!context?.error) return null;
  const text = (name: keyof typeof hyperDatabaseRowActivityStrings) => { const key = `hyperDatabaseRowActivity.${name}`, value = tr(key); return value === key ? hyperDatabaseRowActivityStrings[name] : value; };
  return <Alert variant="warning" data-hyper-row-activity-error><AlertTitle>{text('title')}</AlertTitle><AlertDescription><p>{text(context.capacity ? 'capacity' : 'description')}</p><Button type="button" variant="outline" size="sm" disabled={context.retrying} onClick={context.retry}>{text('retry')}</Button></AlertDescription></Alert>;
}
