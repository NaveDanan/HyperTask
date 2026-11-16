// Adapted from OpenBot components/memory/sources.tsx. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { Button } from '@/components/ui/button';
import { HyperMemoryStatus, useHyperMemoryAction, useHyperMemoryData } from './HyperMemorySection';
import { memorySourceAction, type MemoryRecord, type MemorySource } from './HyperMemoryApi';
import type { HyperMemorySelection } from './HyperMemoryNavigation';
export interface HyperMemorySourcesViewProps {
  sources?: MemorySource[];
  selection: HyperMemorySelection;
  loading: boolean;
  error: string;
  busy: boolean;
  actionError?: string;
  memories?: MemoryRecord[];
  onSelect(selection: HyperMemorySelection): void;
  onAction(source: MemorySource, action: 'enable' | 'disable' | 'sync' | 'remove'): void;
  onRefresh(): void;
}
/** A source must be present in the current authoritative response before any action is offered. */
export function HyperMemorySourcesView({sources, selection, loading, error, busy, actionError, memories, onSelect, onAction, onRefresh}: HyperMemorySourcesViewProps) {
  const selected = selection.page === 'source' ? sources?.find(source => source.id === selection.sourceId) : undefined;
  const shown = selection.page === 'source' ? selected ? [selected] : [] : sources ?? [];
  return <section aria-label="Memory sources" className="grid gap-4 p-6">
    <h2 className="text-lg font-semibold">{selection.page === 'source' ? 'Memory source' : 'Memory sources'}</h2>
    <Button variant="outline" onClick={() => onSelect({page: selection.page === 'source' ? 'sources' : 'facts'})}>{selection.page === 'source' ? 'Back to sources' : 'Back to memory'}</Button>
    <HyperMemoryStatus loading={loading} error={error} reload={onRefresh} />
    {actionError && <p role="alert">{actionError}</p>}
    {!loading && !error && <>{shown.length === 0 && <p>{selection.page === 'source' ? 'This source is unavailable or you no longer have access.' : 'No memory sources yet. Add an app source from a Bot’s Memory tab.'}</p>}
      {shown.map(source => <article key={source.id} className="grid gap-2 rounded-lg border p-4">
        {selection.page === 'source' ? <h3>{source.title}</h3> : <Button variant="link" onClick={() => onSelect({page:'source',sourceId:source.id})}>{source.title}</Button>}
        <p>{source.toolRef} · Bot: {source.agentId}</p><p>{source.enabled ? source.syncStatus : 'Turned off'} · Last synced: {source.lastSyncAt ?? 'Never'}</p>
        {source.syncError && <p role="alert">Source sync failed. Try syncing again.</p>}
        <div className="flex gap-2"><Button disabled={busy} onClick={() => onAction(source, source.enabled ? 'disable' : 'enable')}>{source.enabled ? 'Turn off' : 'Turn on'}</Button>
          <Button disabled={busy || !source.enabled || source.syncStatus === 'running'} onClick={() => onAction(source,'sync')}>Sync now</Button>
          <Button variant="destructive" disabled={busy} onClick={() => onAction(source,'remove')}>Remove source</Button></div>
        {selection.page === 'source' && <><h3>Memories from this source</h3>{memories?.filter(memory => memory.sourceId === source.id).map(memory => <p key={memory.id} className="whitespace-pre-wrap">{memory.content}</p>)}</>}
      </article>)}
    </>}
  </section>;
}
export function HyperMemorySources({selection, onSelect}: {selection: HyperMemorySelection; onSelect(selection: HyperMemorySelection): void}) {
  const sources = useHyperMemoryData<MemorySource[]>('/api/memory/sources','sources',15000);
  const memories = useHyperMemoryData<MemoryRecord[]>(selection.page === 'source' && sources.data?.some(source=>source.id===selection.sourceId) ? '/api/memory' : null,'memories');
  const action = useHyperMemoryAction(() => { sources.reload(); memories.reload(); });
  return <><HyperMemorySourcesView {...sources} sources={sources.data} selection={selection} memories={memories.data} busy={action.busy} actionError={action.error} onSelect={onSelect} onRefresh={sources.reload} onAction={(source,name) => {
    if (sources.loading || sources.error || !sources.data?.some(current=>current.id===source.id)) return;
    void action.run(()=>memorySourceAction(source.id,name));
  }} />{selection.page === 'source' && <HyperMemoryStatus {...memories} />}</>;
}
