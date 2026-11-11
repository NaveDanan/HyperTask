import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTr } from '@/i18n';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { hyperDatabaseDrafts, type HyperDatabaseDraftController, type HyperDatabaseDraftLease, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import { hyperExecuteDatabaseDraft, hyperReadDatabaseDraft } from './HyperDatabaseDraftBackend';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';

export const hyperDatabaseDraftStrings = {
  title: 'Unsaved cell changes',
  description: 'Drafts stay available in this account and workspace while the app is open. A refresh may hide their rows or properties.',
  copy: 'Copy draft', copied: 'Draft copied', copyError: 'Could not copy draft', retry: 'Retry save', discard: 'Discard draft',
  discardTitle: 'Discard this cell draft?', discardDescription: 'This clears the unsaved change in every open pane. The saved cell is kept.', keep: 'Keep draft',
  changed: 'The saved cell or property changed. Copy this draft before discarding it.',
  unavailable: 'This row or property is hidden, removed, read-only, or no longer available. Copy or discard the draft.',
  uncertain: 'The write may have completed. Copy this draft and check the saved cell before retrying.',
  forms: 'Copy unsent form inputs or reopen this cell to finish editing.',
  saving: 'Saving…', previous: 'Previous drafts', next: 'More drafts',
} as const;
export function useHyperDatabaseDraftText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperDatabaseDraftStrings) => { const key = `hyperDatabaseDraft.${name}`, translated = tr(key); return translated === key ? hyperDatabaseDraftStrings[name] : translated; };
}
export function useHyperDatabaseDraftRecords(owner: HyperDatabaseDraftOwner | null, databaseId: string) {
  useSyncExternalStore(hyperDatabaseDrafts.subscribe, hyperDatabaseDrafts.getSnapshot);
  return hyperDatabaseDrafts.pending(owner, databaseId);
}
export function HyperDatabaseDraftRecovery({ owner, databaseId, repository, viewId, editable, saved, records }: {
  owner: HyperDatabaseDraftOwner; databaseId: string; repository: HyperDatabaseRepository; viewId: string; editable: boolean; saved(): void; records: HyperDatabaseDraftController[];
}) {
  const text = useHyperDatabaseDraftText(), [discard, setDiscard] = useState<HyperDatabaseDraftController | null>(null), [copyResult, setCopyResult] = useState(''), [page, setPage] = useState(0);
  const live = useRef({ owner, databaseId, viewId, editable, saved }); live.current = { owner, databaseId, viewId, editable, saved };
  const lease = useMemo<HyperDatabaseDraftLease>(() => ({
    repository, viewId,
    current: () => live.current.owner === owner && live.current.databaseId === databaseId && live.current.viewId === viewId && live.current.editable && owner.isCurrent(),
    saved: () => live.current.saved(),
    read: target => hyperReadDatabaseDraft(repository, viewId, target),
    execute: (mutation, prepared, check, sent) => hyperExecuteDatabaseDraft(repository, mutation, prepared, check, sent),
  }), [owner, databaseId, repository, viewId]);
  if (!records.length || !owner.isCurrent()) return null;
  const start = Math.min(page, Math.max(0, Math.ceil(records.length / 10) - 1)) * 10;
  return <Alert variant="warning" className="shrink-0"><AlertTitle>{text('title')} · {records.length}</AlertTitle><AlertDescription className="min-w-0"><p>{text('description')}</p><div className="max-h-60 overflow-auto">{records.slice(start, start + 10).map(record => {
    const state = record.getSnapshot();
    return <div key={record.key} data-hyper-draft={record.target.rowId + ':' + record.target.fieldId} className="flex flex-wrap items-start gap-2 border-t py-2"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{record.fieldName} · {record.target.rowId}</p><pre className="max-h-20 overflow-auto whitespace-pre-wrap break-words font-sans text-xs">{Object.keys(state.forms).length ? Object.values(state.forms).join('\n') : record.copyText()}</pre>{state.issue ? <p role="alert" className="text-xs">{text(state.issue)}</p> : state.error ? <p role="alert" className="text-xs">{state.error}</p> : null}{!record.retryable && <p className="text-xs">{text('forms')}</p>}</div><Button size="xs" variant="outline" onClick={async () => { if (!owner.isCurrent()) return; try { await window.appflowy.clipboard.writeText(record.copyText()); if (owner.isCurrent()) setCopyResult(text('copied')); } catch { if (owner.isCurrent()) setCopyResult(text('copyError')); } }}>{text('copy')}</Button><Button size="xs" variant="outline" disabled={!editable || state.saving || !record.retryable || state.issue === 'changed' || state.issue === 'uncertain'} onClick={() => void record.retry(lease)}>{state.saving ? text('saving') : text('retry')}</Button><Button size="xs" variant="ghost" disabled={state.saving} onClick={() => setDiscard(record)}>{text('discard')}</Button></div>;
  })}</div>{records.length > 10 && <div className="flex gap-2"><Button size="xs" variant="ghost" disabled={!start} onClick={() => setPage(Math.max(0, page - 1))}>{text('previous')}</Button><Button size="xs" variant="ghost" disabled={start + 10 >= records.length} onClick={() => setPage(page + 1)}>{text('next')}</Button></div>}{copyResult && <p role="status" className="text-xs">{copyResult}</p>}</AlertDescription>
    <Dialog open={!!discard} onOpenChange={open => { if (!open) setDiscard(null); }}><DialogContent><DialogHeader><DialogTitle>{text('discardTitle')}</DialogTitle><DialogDescription>{text('discardDescription')}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" autoFocus onClick={() => setDiscard(null)}>{text('keep')}</Button><Button variant="destructive" disabled={!!discard?.getSnapshot().saving} onClick={() => { if (owner.isCurrent()) discard?.discard(); setDiscard(null); }}>{text('discard')}</Button></DialogFooter></DialogContent></Dialog>
  </Alert>;
}
