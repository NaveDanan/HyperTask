// Ranking weights with a live preview (M5 E5). The draft is ranked by main over one frozen input; nothing is
// saved until Save. The diff (Sol's hyperPreviewWeights) shows which tasks move and by how much.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Minus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { HyperHubSignal, HyperHubWeights, HyperHubWeightsDiff } from '@shared/HyperTaskHub';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useHyperTaskHub } from '../state/useHyperTaskHub';

const hyperHubSignals: { signal: HyperHubSignal; label: string; description: string }[] = [
  { signal: 'slack', label: 'Deadline slack', description: 'Free working time before the deadline, minus the effort.' },
  { signal: 'importance', label: 'Importance', description: 'Your priority, or Jira priority when you have not set one.' },
  { signal: 'unblocking', label: 'Unblocking others', description: 'Verified tasks waiting on this one.' },
  { signal: 'age', label: 'Age', description: 'How long the task has been open.' },
];
export const hyperHubWeightPresets: { id: string; label: string; weights: HyperHubWeights }[] = [
  { id: 'balanced', label: 'Balanced', weights: { slack: 45, importance: 25, unblocking: 20, age: 10 } },
  { id: 'deadlines', label: 'Deadline first', weights: { slack: 65, importance: 20, unblocking: 10, age: 5 } },
  { id: 'unblock', label: 'Unblock others', weights: { slack: 30, importance: 20, unblocking: 45, age: 5 } },
];
const hyperHubDefaultWeights = hyperHubWeightPresets[0].weights;
const sameWeights = (a: HyperHubWeights, b: HyperHubWeights) => hyperHubSignals.every(({ signal }) => a[signal] === b[signal]);

function HyperMove({ from, to }: { from: number; to: number }) {
  const delta = from - to;
  if (!delta) return <span className="inline-flex w-10 items-center justify-end text-muted-foreground" aria-label="No change"><Minus className="size-3" /></span>;
  const up = delta > 0;
  return <span className={cn('inline-flex w-10 items-center justify-end gap-0.5 tabular-nums', up ? 'text-success-foreground dark:text-success' : 'text-muted-foreground')} aria-label={up ? `Up ${delta}` : `Down ${-delta}`}>
    {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{Math.abs(delta)}
  </span>;
}

export function HyperHubWeightsEditor() {
  const snapshot = useHyperTaskHub(s => s.snapshot);
  const saved = snapshot?.settings.weights ?? hyperHubDefaultWeights;
  const [draft, setDraft] = useState<HyperHubWeights>(saved);
  const [diff, setDiff] = useState<HyperHubWeightsDiff | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const savedKey = hyperHubSignals.map(({ signal }) => saved[signal]).join('/');

  // A new saved value (after Save, or from another window) resets the draft.
  useEffect(() => { setDraft(saved); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = hyperHubSignals.reduce((sum, { signal }) => sum + draft[signal], 0);
  const valid = total > 0 && hyperHubSignals.every(({ signal }) => Number.isFinite(draft[signal]) && draft[signal] >= 0);
  const changed = !sameWeights(draft, saved);
  const preset = hyperHubWeightPresets.find(item => sameWeights(item.weights, draft))?.id ?? '';

  // Debounced preview (150 ms). An invalid draft keeps the last valid preview.
  useEffect(() => {
    if (!snapshot || !valid) return;
    if (!changed) { setDiff(null); return; }
    const request = ++seq.current;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void useHyperTaskHub.getState().previewWeights({ scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision, seq: request, draft }).then(result => {
        if (request !== seq.current) return;
        setPreviewing(false);
        if (result.ok) setDiff(result.diff);
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [draft, snapshot, valid, changed]);

  const titles = useMemo(() => new Map((snapshot?.tasks ?? []).map(task => [task.id, task.title])), [snapshot]);
  const save = async () => {
    if (!snapshot || !valid || !changed) return;
    setSaving(true);
    try {
      const result = await useHyperTaskHub.getState().saveWeights({ scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision, weights: draft });
      if ('ok' in result && !result.ok) toast.error(result.code === 'revision-conflict' || result.code === 'scope-changed' ? 'Task Hub changed while you were editing. Check the preview and save again.' : 'Could not save the weights.');
      else toast('Ranking weights saved');
    } finally { setSaving(false); }
  };

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup aria-label="Weight presets" variant="outline" size="sm" value={preset ? [preset] : []}
        onValueChange={value => { const next = hyperHubWeightPresets.find(item => item.id === value[0]); if (next) setDraft(next.weights); }}>
        {hyperHubWeightPresets.map(item => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
      </ToggleGroup>
      <Button variant="ghost" size="sm" className="ms-auto" disabled={sameWeights(draft, hyperHubDefaultWeights)} onClick={() => setDraft(hyperHubDefaultWeights)}><RotateCcw className="size-4" />Reset</Button>
    </div>
    <div className="flex flex-col divide-y rounded-lg border">
      {hyperHubSignals.map(({ signal, label, description }) => {
        const share = total > 0 ? Math.round(100 * draft[signal] / total) : 0;
        return <div key={signal} className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,14rem)_3.5rem] items-center gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <Slider aria-label={label} min={0} max={100} step={1} value={[draft[signal]]} onValueChange={value => setDraft(previous => ({ ...previous, [signal]: Array.isArray(value) ? value[0] : value }))} />
          <span className="text-end text-sm tabular-nums" aria-label={`${share} percent of the score`}>{share}%</span>
        </div>;
      })}
    </div>
    {!valid && <p className="text-xs text-destructive">At least one weight must be above zero.</p>}

    <section aria-live="polite" className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Preview</span>
        {!changed ? <span>Move a slider to see how your list would change.</span>
          : previewing && !diff ? <span>Ranking…</span>
          : diff ? <span>{diff.movedCount === 0 ? 'No task changes position.' : `${diff.movedCount} ${diff.movedCount === 1 ? 'task moves' : 'tasks move'}.`}</span> : null}
      </div>
      {changed && (diff ? <ol className={cn('flex flex-col divide-y rounded-lg border text-sm transition-opacity', previewing && 'opacity-60')}>
        {diff.topTen.map(row => <li key={row.taskId} className="flex items-center gap-3 px-3 py-1.5">
          <span className="w-5 text-end text-xs tabular-nums text-muted-foreground">{row.newPosition}</span>
          <HyperMove from={row.oldPosition} to={row.newPosition} />
          <bdi dir="auto" className="min-w-0 flex-1 truncate">{titles.get(row.taskId) ?? 'Task'}</bdi>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{(row.oldScoreCents / 100).toFixed(1)} → {(row.newScoreCents / 100).toFixed(1)}</span>
        </li>)}
      </ol> : <Skeleton className="h-40 w-full" />)}
    </section>

    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" disabled={!changed || saving} onClick={() => setDraft(saved)}>Cancel</Button>
      <Button size="sm" disabled={!changed || !valid || saving || !snapshot} onClick={() => void save()}>{saving ? 'Saving…' : 'Save weights'}</Button>
    </div>
  </div>;
}
