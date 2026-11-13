import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, RefreshCw, X } from 'lucide-react';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { hyperDocumentOwnerKey, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperDatabaseRowDuplicates } from './HyperDatabaseRowDuplicateBackend';
import { hyperRowDuplicateKey } from './HyperDatabaseRowDuplicateModel';
export const hyperDatabaseRowDuplicateStrings = {
  duplicate: 'Duplicate row', retry: 'Retry row copy', copying: 'Copying row…', review: 'Review row copy',
  title: 'Row copy needs review', description: 'Retry checks the same copy operation and preserves any edits to an already copied row.',
  copy: 'Copy row recovery details', dismiss: 'Dismiss notice',
  retained: 'Recovery stays available in this account and workspace while the app is open.',
} as const;
function useText() { const { tr } = useTr(); return (name: keyof typeof hyperDatabaseRowDuplicateStrings) => { const key = `hyperDatabaseRowDuplicate.${name}`, value = tr(key); return value === key ? hyperDatabaseRowDuplicateStrings[name] : value; }; }
export interface HyperRowDuplicateProps { owner: HyperDocumentOwner; databaseId: string; viewId: string; editable: boolean; hasPending(): boolean; onCopied?(row: RowMetaPB, owner: HyperDocumentOwner): void | Promise<void> }
export function HyperDatabaseRowDuplicateAction(props: HyperRowDuplicateProps & { rowId: string }) {
  const { owner, databaseId, viewId, rowId, editable } = props, text = useText(), plans = useStore(hyperDatabaseRowDuplicates.store, state => state.plans), [error, setError] = useState('');
  const key = hyperRowDuplicateKey(owner, viewId, rowId), plan = plans.find(plan => plan.key === key), busy = plan?.status === 'copying' || plan?.status === 'preparing';
  const alive = useRef(true), epoch = useRef(0), latest = useRef(props); latest.current = props;
  useEffect(() => { alive.current = true; epoch.current++; setError(''); return () => { alive.current = false; epoch.current++; }; }, [key]);
  const run = async () => {
    const scope = hyperCaptureDuplicateOwner(owner), capturedKey = key, run = epoch.current; if (!scope?.isCurrent()) return; setError('');
    const options = { owner: scope, databaseId, viewId, rowId, editable: () => latest.current.editable, hasPending: () => latest.current.hasPending() };
    try {
      const row = await (plan ? hyperDatabaseRowDuplicates.retry(plan.key, options) : hyperDatabaseRowDuplicates.start(options));
      if (alive.current && run === epoch.current && scope.isCurrent() && capturedKey === hyperRowDuplicateKey(latest.current.owner, latest.current.viewId, latest.current.rowId)) await latest.current.onCopied?.(row, scope);
    } catch (error) { if (alive.current && run === epoch.current && scope.isCurrent() && capturedKey === hyperRowDuplicateKey(latest.current.owner, latest.current.viewId, latest.current.rowId)) setError((error as Error)?.message ?? String(error)); }
  };
  return <div className="flex flex-col gap-2"><Button variant="outline" size="sm" disabled={!editable || busy || props.hasPending() || !hyperDatabaseRowDuplicates.backend.duplicate} onClick={() => void run()}>{busy ? <Spinner /> : plan ? <RefreshCw /> : <Copy />}{text(busy ? 'copying' : plan ? 'retry' : 'duplicate')}</Button>{(plan?.error || error) && <Alert variant="destructive"><AlertDescription>{plan?.error || error}{plan && <Button variant="outline" size="sm" onClick={() => { if (owner.isCurrent()) window.appflowy.clipboard.writeText(hyperDatabaseRowDuplicates.details(plan.key, owner)); }}><Copy />{text('copy')}</Button>}</AlertDescription></Alert>}</div>;
}
export function HyperDatabaseRowDuplicateRecovery(props: HyperRowDuplicateProps) {
  const { owner, viewId, editable } = props, text = useText(), plans = useStore(hyperDatabaseRowDuplicates.store, state => state.plans), [review, setReview] = useState(false);
  const latest = useRef(props); latest.current = props; const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [viewId, owner]);
  if (!owner.isCurrent()) return null;
  const scoped = plans.filter(plan => plan.needsReview && plan.request.viewId === viewId && hyperDocumentOwnerKey(plan.owner) === hyperDocumentOwnerKey(owner));
  if (!scoped.length) return null;
  const visible = scoped.filter(plan => review || !plan.dismissed);
  return <>{scoped.some(plan => plan.dismissed) && <Button variant="ghost" size="sm" className="self-start" onClick={() => setReview(!review)}>{text('review')}</Button>}{visible.map(plan => {
    const busy = plan.status === 'preparing' || plan.status === 'copying';
    return <Alert variant="warning" key={plan.key} data-hyper-row-copy-recovery className="shrink-0"><AlertTitle>{text('title')}</AlertTitle><AlertDescription><p>{plan.error || text('copying')}</p><p>{text('description')}</p><p>{text('retained')}</p><div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => { if (owner.isCurrent()) window.appflowy.clipboard.writeText(hyperDatabaseRowDuplicates.details(plan.key, owner)); }}><Copy />{text('copy')}</Button>
      <Button variant="outline" size="sm" disabled={!editable || busy || props.hasPending() || !hyperDatabaseRowDuplicates.backend.duplicate} onClick={() => {
        const scope = hyperCaptureDuplicateOwner(owner); if (!scope) return;
        void hyperDatabaseRowDuplicates.retry(plan.key, { owner: scope, editable: () => latest.current.editable, hasPending: () => latest.current.hasPending() }).then(async row => { if (alive.current && scope.isCurrent() && latest.current.viewId === viewId && hyperDocumentOwnerKey(latest.current.owner) === hyperDocumentOwnerKey(owner)) await latest.current.onCopied?.(row, scope); }).catch(() => {});
      }}>{busy ? <Spinner /> : <RefreshCw />}{text('retry')}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { hyperDatabaseRowDuplicates.dismiss(plan.key, owner); setReview(false); }}><X />{text('dismiss')}</Button>
    </div></AlertDescription></Alert>;
  })}</>;
}
