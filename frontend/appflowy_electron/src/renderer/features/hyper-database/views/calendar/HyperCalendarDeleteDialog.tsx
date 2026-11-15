import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function HyperCalendarDeleteDialog({ open, onOpenChange, onDelete, busy }: { open: boolean; onOpenChange: (open: boolean) => void; onDelete: () => void; busy: boolean }) {
  return <AlertDialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <AlertDialogContent className="rounded-xl shadow-xl">
      <AlertDialogHeader><AlertDialogTitle>Delete event?</AlertDialogTitle><AlertDialogDescription>This will delete the event and its database row.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={busy} onClick={onDelete}>{busy ? 'Deleting…' : 'Delete'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
