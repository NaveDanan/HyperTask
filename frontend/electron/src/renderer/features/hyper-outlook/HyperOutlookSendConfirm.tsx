import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
export type HyperOutlookSendKind = 'invite' | 'update' | 'cancel' | 'response';
const people = (count: number) => `${count} ${count === 1 ? 'attendee' : 'attendees'}`;
export function hyperOutlookSendCopy(kind: HyperOutlookSendKind, count: number) {
  if (kind === 'invite') return { title: `Send invitation to ${people(count)}?`, description: 'Outlook will email the meeting invitation.', action: 'Send' };
  if (kind === 'cancel') return { title: `Cancel meeting for ${people(count)}?`, description: 'Outlook will email a cancellation and remove the meeting from your calendar.', action: 'Send cancellation' };
  if (kind === 'response') return { title: 'Send response to the organizer?', description: 'Outlook will email your response.', action: 'Send' };
  return { title: `Send update to ${people(count)}?`, description: 'Outlook will email the change. Cancel keeps the meeting unchanged.', action: 'Send update' };
}
export function HyperOutlookSendConfirm({ count, kind, onConfirm, onCancel }: { count: number; kind: HyperOutlookSendKind; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null), copy = hyperOutlookSendCopy(kind, count);
  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}><DialogContent className="rounded-xl shadow-xl sm:max-w-md" initialFocus={cancel} showCloseButton={false}>
    <DialogHeader><DialogTitle>{copy.title}</DialogTitle><DialogDescription>{copy.description}</DialogDescription></DialogHeader>
    <DialogFooter><Button ref={cancel} variant="outline" onClick={onCancel}>Cancel</Button><Button variant={kind === 'cancel' ? 'destructive' : 'default'} onClick={onConfirm}>{copy.action}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
export function useHyperOutlookSendConfirm() {
  const [request, setRequest] = useState<{ count: number; kind: HyperOutlookSendKind } | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  const settle = (value: boolean) => { const resolve = pending.current; pending.current = null; setRequest(null); resolve?.(value); };
  const confirm = (count: number, kind: HyperOutlookSendKind = 'update') => new Promise<boolean>(resolve => { pending.current?.(false); pending.current = resolve; setRequest({ count, kind }); });
  return { confirm, dialog: request === null ? null : <HyperOutlookSendConfirm count={request.count} kind={request.kind} onConfirm={() => settle(true)} onCancel={() => settle(false)} /> };
}
