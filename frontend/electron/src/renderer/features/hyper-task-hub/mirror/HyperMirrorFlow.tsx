// Add to Hyper-Kanban (M5 E7). An explicit, previewed copy of one task's title and link into the shared board.
// The current core cannot delete conditionally, so there is no Undo: the toast offers Open instead.
import { useEffect, useRef, useState } from 'react';
import { SquareKanban } from 'lucide-react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { HyperHubMirrorPreview, HyperHubRejectCode, HyperHubTaskView } from '@shared/HyperTaskHub';
import { Alert, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useHyperTaskHub } from '../state/useHyperTaskHub';

const hyperMirrorErrors: Record<HyperHubRejectCode, string> = {
  'scope-changed': 'Your account or workspace changed. Nothing was added.',
  'revision-conflict': 'Task Hub changed while you were working. Try again.',
  unavailable: 'Hyper-Kanban is unavailable right now. Nothing was added.',
  'access-denied': 'You can no longer add to this board, or the task is no longer available to you.',
  invalid: 'This task cannot be added to Hyper-Kanban.',
};

interface HyperMirrorRequestStore {
  task: HyperHubTaskView | null;
  key: number;
  open: (task: HyperHubTaskView) => void;
  close: () => void;
}
export const useHyperMirrorRequest = create<HyperMirrorRequestStore>(set => ({
  task: null, key: 0,
  open: task => set(state => ({ task, key: state.key + 1 })),
  close: () => set({ task: null }),
}));

function HyperMirrorRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-w-0 items-baseline gap-3 px-3 py-2">
    <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
    <dd className="min-w-0 flex-1 text-sm">{children}</dd>
  </div>;
}

export function HyperMirrorController({ onOpenHandle }: { onOpenHandle: (handle: string) => void }) {
  const task = useHyperMirrorRequest(s => s.task);
  const key = useHyperMirrorRequest(s => s.key);
  const close = useHyperMirrorRequest(s => s.close);
  const [preview, setPreview] = useState<HyperHubMirrorPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!task) return;
    const snapshot = useHyperTaskHub.getState().snapshot;
    setPreview(null); setError(null); setApplying(false);
    if (!snapshot) { setError(hyperMirrorErrors.unavailable); return; }
    let current = true;
    void useHyperTaskHub.getState().previewMirror({ scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision, taskId: task.id }).then(result => {
      if (!current) return;
      if (result.ok) setPreview(result.preview); else setError(hyperMirrorErrors[result.code]);
    });
    return () => { current = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;
  const apply = async () => {
    if (!preview) return;
    setApplying(true);
    const result = await useHyperTaskHub.getState().applyMirror({ token: preview.token });
    setApplying(false);
    if (!result.ok) { setError(hyperMirrorErrors[result.code]); setPreview(null); return; }
    close();
    toast('Added to Hyper-Kanban', { action: { label: 'Open', onClick: () => onOpenHandle(result.handle) } });
  };

  return <Dialog open onOpenChange={open => { if (!open && !applying) close(); }}>
    <DialogContent data-hyper-mirror className="grid-cols-[minmax(0,1fr)] sm:max-w-md" initialFocus={cancelRef}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><SquareKanban className="size-4 text-muted-foreground" />Add to Hyper-Kanban?</DialogTitle>
        <DialogDescription>Task Hub copies only the title and a link to the source. Everyone who can see the board will see the card.</DialogDescription>
      </DialogHeader>
      {error ? <Alert variant="warning"><AlertTitle>{error}</AlertTitle></Alert>
        : !preview ? <div aria-busy="true" className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        : <dl className="flex min-w-0 flex-col divide-y rounded-lg border">
          <HyperMirrorRow label="Board"><bdi>{preview.destination}</bdi></HyperMirrorRow>
          <HyperMirrorRow label="Visible to"><bdi>{preview.audience}</bdi></HyperMirrorRow>
          <HyperMirrorRow label="Title"><bdi dir="auto">{preview.title}</bdi></HyperMirrorRow>
          <HyperMirrorRow label="Link"><span className="block font-mono text-xs break-all text-muted-foreground" dir="ltr">{preview.link}</span></HyperMirrorRow>
        </dl>}
      <DialogFooter>
        <Button ref={cancelRef} variant="outline" disabled={applying} onClick={close}>Cancel</Button>
        <Button disabled={!preview || applying} onClick={() => void apply()}>{applying && <Spinner className="size-3.5" />}Add to Hyper-Kanban</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
