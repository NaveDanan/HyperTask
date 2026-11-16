import { useId, useState, type ReactNode } from 'react';
import { ExternalLink, Trash2, Video } from 'lucide-react';
import type { HyperOutlookEvent, HyperOutlookFields } from '@shared/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { showToast } from '@/ui';
import { hyperCalendarError, type HyperCalendarDraft } from '@/features/hyper-database/views/calendar/HyperCalendarData';
import { HyperCalendarDeleteDialog } from '@/features/hyper-database/views/calendar/HyperCalendarDeleteDialog';
import { hyperOutlookClient } from './hyper-outlook-client';
import { hyperOutlookFields } from './HyperOutlookData';
import type { HyperOutlookSendKind } from './HyperOutlookSendConfirm';
interface HyperOutlookDialogProps {
  initial: HyperCalendarDraft; item?: HyperOutlookEvent; timeZone: string;
  onClose: () => void; onSaved: () => void; confirmSend: (count: number, kind: HyperOutlookSendKind) => Promise<boolean>; saveTo?: (draft: HyperCalendarDraft) => ReactNode;
}
export function HyperOutlookEventDialog({ initial, item, timeZone, onClose, onSaved, confirmSend, saveTo }: HyperOutlookDialogProps) {
  const id = useId();
  const [draft, setDraft] = useState({ ...initial, isRange: true });
  const [location, setLocation] = useState(item?.location ?? ''), [body, setBody] = useState(item?.body ?? ''), [emails, setEmails] = useState('');
  const [sendResponse, setSendResponse] = useState(true), [busy, setBusy] = useState(false), [deleteOpen, setDeleteOpen] = useState(false);
  const readOnly = Boolean(item && (!item.isOrganizer || item.recurrenceState === 1 || item.isPrivate));
  const invite = Boolean(item && !item.isOrganizer && item.recurrenceState !== 1 && !item.isPrivate);
  const fields = hyperOutlookFields(draft, location, body, timeZone);
  const patch = (value: Partial<HyperCalendarDraft>) => setDraft(previous => ({ ...previous, ...value }));
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    try { await action(); showToast({ type: 'success', message }); onSaved(); onClose(); }
    catch (error) { const message = hyperCalendarError(error); showToast({ type: 'error', message }); if (message === 'Changed in Outlook — reloaded') { onSaved(); onClose(); } }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (busy || readOnly || !fields) return;
    const attendees = [...new Set(emails.split(/[;,\s]+/).filter(Boolean))];
    if (attendees.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || attendees.length > 200) { showToast({ type: 'error', message: 'Enter valid attendee email addresses (up to 200).' }); return; }
    const changes: Partial<HyperOutlookFields> = item ? Object.fromEntries(Object.entries(fields).filter(([key, value]) => {
      if ((key === 'start' || key === 'end') && !fields.allDay && !item.allDay) return Date.parse(String(value)) !== Date.parse(item[key]);
      return value !== item[key as keyof HyperOutlookFields];
    })) : fields;
    if (item && !Object.keys(changes).length) { onClose(); return; }
    const count = item?.attendeeCount ?? attendees.length;
    setBusy(true); const confirmed = !count || await confirmSend(count, item ? 'update' : 'invite'); setBusy(false);
    if (!confirmed) return;
    await run(() => item ? hyperOutlookClient.update({ id: item.id, expectedLastModified: item.lastModified, patch: changes, send: count > 0 }) : hyperOutlookClient.create({ ...fields, attendees, send: count > 0 }), item ? 'Outlook event updated' : 'Outlook event created');
  };
  const remove = async () => {
    if (!item || busy || readOnly) return;
    setDeleteOpen(false); setBusy(true); const confirmed = !item.attendeeCount || await confirmSend(item.attendeeCount, 'cancel'); setBusy(false);
    if (confirmed) await run(() => hyperOutlookClient.delete({ id: item.id, send: item.attendeeCount > 0 }), 'Outlook event deleted');
  };
  const respond = async (response: 'accept' | 'tentative' | 'decline') => {
    if (!item || busy || !invite) return;
    setBusy(true); const confirmed = !sendResponse || await confirmSend(1, 'response'); setBusy(false);
    if (confirmed) await run(() => hyperOutlookClient.respond({ id: item.id, response, send: sendResponse }), 'Outlook response saved');
  };
  const open = async () => { if (item) try { await hyperOutlookClient.open(item.id); } catch (error) { showToast({ type: 'error', message: hyperCalendarError(error) }); } };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto rounded-xl shadow-xl sm:max-w-md" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{item ? 'Outlook event' : 'New event'}</DialogTitle><DialogDescription className="sr-only">{invite ? 'Review and respond to this Outlook invitation.' : 'Set the title, dates and details for this Outlook event.'}</DialogDescription></DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        {!item && saveTo?.(draft)}
        <fieldset disabled={busy || readOnly} className="flex min-w-0 flex-col gap-4">
          <Field><FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel><Input id={`${id}-title`} dir="auto" autoFocus value={draft.title} maxLength={255} onChange={event => patch({ title: event.target.value })} placeholder="Untitled" /></Field>
          <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-all-day`}>All day</FieldLabel><Switch id={`${id}-all-day`} checked={draft.allDay} onCheckedChange={allDay => patch({ allDay })} /></Field>
          <Field><FieldLabel htmlFor={`${id}-start-date`}>Start</FieldLabel><div className="flex gap-2"><Input id={`${id}-start-date`} type="date" value={draft.startDate} onChange={event => patch({ startDate: event.target.value })} className="min-w-0 flex-1" />{!draft.allDay && <Input aria-label="Start time" type="time" value={draft.startTime} onChange={event => patch({ startTime: event.target.value })} className="w-32" />}</div></Field>
          <Field data-invalid={!fields}><FieldLabel htmlFor={`${id}-end-date`}>End{draft.allDay ? ' (inclusive)' : ''}</FieldLabel><div className="flex gap-2"><Input id={`${id}-end-date`} type="date" aria-invalid={!fields} value={draft.endDate} onChange={event => patch({ endDate: event.target.value })} className="min-w-0 flex-1" />{!draft.allDay && <Input aria-label="End time" type="time" value={draft.endTime} onChange={event => patch({ endTime: event.target.value })} className="w-32" />}</div></Field>
          <Field><FieldLabel htmlFor={`${id}-location`}>Location</FieldLabel><Input id={`${id}-location`} dir="auto" value={location} maxLength={2048} onChange={event => setLocation(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor={`${id}-body`}>Description</FieldLabel><Textarea id={`${id}-body`} dir="auto" value={body} readOnly={Boolean(item && item.body.length >= 8192)} maxLength={8192} onChange={event => setBody(event.target.value)} className="max-h-40 min-h-20" />{item && item.body.length >= 8192 && <p className="text-xs text-muted-foreground">Open in Outlook to edit this long description.</p>}</Field>
          {!item && <Field><FieldLabel htmlFor={`${id}-attendees`}>Attendee emails</FieldLabel><Input id={`${id}-attendees`} value={emails} onChange={event => setEmails(event.target.value)} placeholder="Separate with commas" /></Field>}
        </fieldset>
        {!fields && <FieldError>Choose valid dates. End must be after start.</FieldError>}
        {item?.organizer && <p className="text-xs text-muted-foreground">Organizer: {item.organizer}</p>}
        {Boolean(item?.attendeeCount) && <div className="text-xs text-muted-foreground"><p>{item!.attendeeCount} attendees</p><ul className="mt-1 max-h-24 overflow-y-auto">{item!.attendees.map((person, index) => <li key={index} className="truncate" title={person.email}>{person.name}{person.email ? ` · ${person.email}` : ''}</li>)}</ul></div>}
        {item?.isRecurring && <p className="text-xs text-muted-foreground">Changes apply to this occurrence. Open in Outlook to edit the series.</p>}
        {item?.isPrivate && <p className="text-xs text-muted-foreground">Private event. Open in Outlook to see or change its details.</p>}
        {item && <div className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void open()}><ExternalLink className="size-4" />Open in Outlook</Button>{item.joinUrl && <Button type="button" variant="outline" size="sm" onClick={() => { void window.hypertask.shell.openExternal(item.joinUrl!).catch(error => showToast({ type: 'error', message: hyperCalendarError(error) })); }}><Video className="size-4" />Join</Button>}</div>}
        {invite && <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-send`}>Send response</FieldLabel><Switch id={`${id}-send`} disabled={busy} checked={sendResponse} onCheckedChange={setSendResponse} /></Field>}
        <DialogFooter>
          {item && !readOnly && <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" />{item.attendeeCount ? 'Cancel meeting' : 'Delete'}</Button>}
          {invite ? <><Button type="button" variant="outline" disabled={busy} onClick={() => void respond('decline')}>Decline</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void respond('tentative')}>Tentative</Button><Button type="button" disabled={busy} onClick={() => void respond('accept')}>Accept</Button></> : <><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>{!readOnly && <Button type="submit" disabled={busy || !fields}>{busy ? 'Saving…' : 'Save'}</Button>}</>}
        </DialogFooter>
      </form>
      <HyperCalendarDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} onDelete={() => void remove()} busy={busy} description="This will delete the event from Outlook." />
    </DialogContent>
  </Dialog>;
}
