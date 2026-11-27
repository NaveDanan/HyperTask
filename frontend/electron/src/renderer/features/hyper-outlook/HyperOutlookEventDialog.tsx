import { useId, useState, type ReactNode } from 'react';
import { ClipboardList, ExternalLink, Trash2, Video } from 'lucide-react';
import type { HyperOutlookEvent, HyperOutlookEditFields, HyperOutlookFields } from '@shared/api';
import { HyperOutlookColors, hyperOutlookCategoriesWith, hyperOutlookColorOf, type HyperOutlookColorId } from '@shared/HyperOutlookColor';
import { cn } from '@/lib/utils';
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
import { hyperOutlookColorToken, hyperOutlookFields } from './HyperOutlookData';
import type { HyperOutlookSendKind } from './HyperOutlookSendConfirm';
import { useHyperHubBriefRequest } from '@/features/hyper-task-hub/brief/useHyperHubBriefRequest';
import { hyperOpenTaskHub } from '@/features/hyper-task-hub/HyperTaskHubNavigation';
interface HyperOutlookDialogProps {
  initial: HyperCalendarDraft; item?: HyperOutlookEvent; timeZone: string;
  onClose: () => void; onSaved: () => void; onItemChange?: (item: HyperOutlookEvent) => void; confirmSend: (count: number, kind: HyperOutlookSendKind) => Promise<boolean>; saveTo?: (draft: HyperCalendarDraft) => ReactNode;
}
const swatches: { id: HyperOutlookColorId | null; label: string }[] = [{ id: null, label: 'None' }, ...HyperOutlookColors];
export function HyperOutlookEventDialog({ initial, item, timeZone, onClose, onSaved, onItemChange, confirmSend, saveTo }: HyperOutlookDialogProps) {
  const id = useId();
  const [draft, setDraft] = useState({ ...initial, isRange: true });
  const [location, setLocation] = useState(item?.location ?? ''), [body, setBody] = useState(item?.body ?? ''), [emails, setEmails] = useState('');
  // A colour write moves lastModified, so the dialog keeps the latest copy for the next save.
  const [live, setLive] = useState(item), [newColor, setNewColor] = useState<HyperOutlookColorId | null>(null);
  const [sendResponse, setSendResponse] = useState(true), [busy, setBusy] = useState(false), [deleteOpen, setDeleteOpen] = useState(false);
  const readOnly = Boolean(live && (!live.isOrganizer || live.recurrenceState === 1 || live.isPrivate));
  // Colour is the user's own Outlook category, so invitations can be coloured; only series masters are refused.
  const colorable = !live || (live.recurrenceState !== 1 && !live.isPrivate);
  const invite = Boolean(live && !live.isOrganizer && live.recurrenceState !== 1 && !live.isPrivate);
  const colour = live ? hyperOutlookColorOf(live.categories) : newColor;
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
    const changes: Partial<HyperOutlookEditFields> = live ? Object.fromEntries(Object.entries(fields).filter(([key, value]) => {
      if ((key === 'start' || key === 'end') && !fields.allDay && !live.allDay) return Date.parse(String(value)) !== Date.parse(live[key]);
      return value !== live[key as keyof HyperOutlookFields];
    })) : { ...fields, color: newColor };
    if (live && !Object.keys(changes).length) { onClose(); return; }
    const count = live?.attendeeCount ?? attendees.length;
    setBusy(true); const confirmed = !count || await confirmSend(count, live ? 'update' : 'invite'); setBusy(false);
    if (!confirmed) return;
    await run(() => live ? hyperOutlookClient.update({ id: live.id, expectedLastModified: live.lastModified, patch: changes, send: count > 0 }) : hyperOutlookClient.create({ ...fields, color: newColor, attendees, send: count > 0 }), live ? 'Outlook event updated' : 'Outlook event created');
  };
  // Colour is the user's own category: it saves at once, without the send confirmation that edits to attendees need.
  const chooseColor = async (next: HyperOutlookColorId | null) => {
    if (!live) { setNewColor(next); return; }
    if (busy || !colorable || hyperOutlookColorOf(live.categories) === next) return;
    const previous = live, optimistic = { ...previous, categories: hyperOutlookCategoriesWith(previous.categories, next) };
    setLive(optimistic); onItemChange?.(optimistic); setBusy(true);
    try {
      const saved = await hyperOutlookClient.update({ id: previous.id, expectedLastModified: previous.lastModified, patch: { color: next }, send: false });
      setLive(saved); onItemChange?.(saved);
    } catch (error) {
      setLive(previous); onItemChange?.(previous);
      const message = hyperCalendarError(error); showToast({ type: 'error', message });
      if (message === 'Changed in Outlook — reloaded') { onSaved(); onClose(); }
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!live || busy || readOnly) return;
    setDeleteOpen(false); setBusy(true); const confirmed = !live.attendeeCount || await confirmSend(live.attendeeCount, 'cancel'); setBusy(false);
    if (confirmed) await run(() => hyperOutlookClient.delete({ id: live.id, send: live.attendeeCount > 0 }), 'Outlook event deleted');
  };
  const respond = async (response: 'accept' | 'tentative' | 'decline') => {
    if (!live || busy || !invite) return;
    setBusy(true); const confirmed = !sendResponse || await confirmSend(1, 'response'); setBusy(false);
    if (confirmed) await run(() => hyperOutlookClient.respond({ id: live.id, response, send: sendResponse }), 'Outlook response saved');
  };
  const open = async () => { if (live) try { await hyperOutlookClient.open(live.id); } catch (error) { showToast({ type: 'error', message: hyperCalendarError(error) }); } };
  // The dialog is bounded by the viewport (not its container): the header and footer stay put and only the body scrolls.
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh_-_2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-xl sm:max-w-md" showCloseButton={!busy}>
      <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12"><DialogTitle>{live ? 'Outlook event' : 'New event'}</DialogTitle><DialogDescription className="sr-only">{invite ? 'Review and respond to this Outlook invitation.' : 'Set the title, dates and details for this Outlook event.'}</DialogDescription></DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {!live && saveTo?.(draft)}
          <fieldset disabled={busy || readOnly} className="flex min-w-0 flex-col gap-4">
            <Field><FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel><Input id={`${id}-title`} dir="auto" autoFocus value={draft.title} maxLength={255} onChange={event => patch({ title: event.target.value })} placeholder="Untitled" /></Field>
            <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-all-day`}>All day</FieldLabel><Switch id={`${id}-all-day`} checked={draft.allDay} onCheckedChange={allDay => patch({ allDay })} /></Field>
            <Field><FieldLabel htmlFor={`${id}-start-date`}>Start</FieldLabel><div className="flex gap-2"><Input id={`${id}-start-date`} type="date" value={draft.startDate} onChange={event => patch({ startDate: event.target.value })} className="min-w-0 flex-1" />{!draft.allDay && <Input aria-label="Start time" type="time" value={draft.startTime} onChange={event => patch({ startTime: event.target.value })} className="w-32" />}</div></Field>
            <Field data-invalid={!fields}><FieldLabel htmlFor={`${id}-end-date`}>End{draft.allDay ? ' (inclusive)' : ''}</FieldLabel><div className="flex gap-2"><Input id={`${id}-end-date`} type="date" aria-invalid={!fields} value={draft.endDate} onChange={event => patch({ endDate: event.target.value })} className="min-w-0 flex-1" />{!draft.allDay && <Input aria-label="End time" type="time" value={draft.endTime} onChange={event => patch({ endTime: event.target.value })} className="w-32" />}</div></Field>
            <Field><FieldLabel htmlFor={`${id}-location`}>Location</FieldLabel><Input id={`${id}-location`} dir="auto" value={location} maxLength={2048} onChange={event => setLocation(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor={`${id}-body`}>Description</FieldLabel><Textarea id={`${id}-body`} dir="auto" value={body} readOnly={Boolean(live && live.body.length >= 8192)} maxLength={8192} onChange={event => setBody(event.target.value)} className="max-h-40 min-h-20" />{live && live.body.length >= 8192 && <p className="text-xs text-muted-foreground">Open in Outlook to edit this long description.</p>}</Field>
            {!live && <Field><FieldLabel htmlFor={`${id}-attendees`}>Attendee emails</FieldLabel><Input id={`${id}-attendees`} value={emails} onChange={event => setEmails(event.target.value)} placeholder="Separate with commas" /></Field>}
          </fieldset>
          <Field><FieldLabel>Colour</FieldLabel><div role="group" aria-label="Colour" className="flex flex-wrap gap-2">
            {swatches.map(swatch => <button key={swatch.label} type="button" aria-label={swatch.label} aria-pressed={colour === swatch.id} title={swatch.label} disabled={busy || !colorable} onClick={() => void chooseColor(swatch.id)}
              style={swatch.id ? { backgroundColor: hyperOutlookColorToken(swatch.id) } : undefined}
              className={cn('size-6 rounded-full border border-black/10 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10', swatch.id ? '' : 'border-dashed bg-background', colour === swatch.id && 'ring-2 ring-ring ring-offset-2 ring-offset-background')} />)}
          </div></Field>
          {!fields && <FieldError>Choose valid dates. End must be after start.</FieldError>}
          {live?.organizer && <p className="text-xs text-muted-foreground">Organizer: {live.organizer}</p>}
          {Boolean(live?.attendeeCount) && <div className="text-xs text-muted-foreground"><p>{live!.attendeeCount} attendees</p><ul className="mt-1 max-h-24 overflow-y-auto">{live!.attendees.map((person, index) => <li key={index} className="truncate" title={person.email}>{person.name}{person.email ? ` · ${person.email}` : ''}</li>)}</ul></div>}
          {live?.isRecurring && <p className="text-xs text-muted-foreground">Changes apply to this occurrence. Open in Outlook to edit the series.</p>}
          {live?.isPrivate && <p className="text-xs text-muted-foreground">Private event. Open in Outlook to see or change its details.</p>}
          {live && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void open()}><ExternalLink className="size-4" />Open in Outlook</Button>{live.joinUrl && <Button type="button" variant="outline" size="sm" onClick={() => { void window.hypertask.shell.openExternal(live.joinUrl!).catch(error => showToast({ type: 'error', message: hyperCalendarError(error) })); }}><Video className="size-4" />Join</Button>}{live.hubMeetingId && <Button type="button" variant="outline" size="sm" onClick={() => { useHyperHubBriefRequest.getState().open(live.hubMeetingId!); hyperOpenTaskHub(); onClose(); }}><ClipboardList className="size-4" />Prep brief</Button>}</div>}
          {invite && <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-send`}>Send response</FieldLabel><Switch id={`${id}-send`} disabled={busy} checked={sendResponse} onCheckedChange={setSendResponse} /></Field>}
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-4 py-3">
          {live && !readOnly && <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" />{live.attendeeCount ? 'Cancel meeting' : 'Delete'}</Button>}
          {invite ? <><Button type="button" variant="outline" disabled={busy} onClick={() => void respond('decline')}>Decline</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void respond('tentative')}>Tentative</Button><Button type="button" disabled={busy} onClick={() => void respond('accept')}>Accept</Button></> : <><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>{!readOnly && <Button type="submit" disabled={busy || !fields}>{busy ? 'Saving…' : 'Save'}</Button>}</>}
        </DialogFooter>
      </form>
      <HyperCalendarDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} onDelete={() => void remove()} busy={busy} description="This will delete the event from Outlook." />
    </DialogContent>
  </Dialog>;
}
