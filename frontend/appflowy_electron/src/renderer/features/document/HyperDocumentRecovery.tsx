import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useTr } from '@/i18n';
import type { HyperDocumentSession } from './HyperDocumentSession';

export const hyperDocumentRecoveryStrings = {
  reload: 'Reload saved page', title: 'Discard unsaved changes?',
  description: 'Copy the unsaved content first if you need it. Reloading replaces this draft in every open pane with the last saved page. Failed edits will not be retried.',
  cancel: 'Keep draft', confirm: 'Discard and reload',
} as const;

export function HyperDocumentRecovery({ session, disabled, onRecovered, onError }: { session: HyperDocumentSession; disabled: boolean; onRecovered(): void; onError(message: string): void }) {
  const { tr } = useTr(), [open, setOpen] = useState(false);
  const text = (name: keyof typeof hyperDocumentRecoveryStrings) => { const key = `hyperDocumentRecovery.${name}`, value = tr(key); return value === key ? hyperDocumentRecoveryStrings[name] : value; };
  return <AlertDialog open={open} onOpenChange={value => { if (!disabled) setOpen(value); }}>
    <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>{text('reload')}</AlertDialogTrigger>
    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{text('title')}</AlertDialogTitle><AlertDialogDescription>{text('description')}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={disabled}>{text('cancel')}</AlertDialogCancel><AlertDialogAction disabled={disabled} className="bg-destructive text-white hover:bg-destructive/90" onClick={() => {
        setOpen(false); void session.reloadSaved().then(onRecovered).catch(error => onError(error instanceof Error ? error.message : String(error)));
      }}>{text('confirm')}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
