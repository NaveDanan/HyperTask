import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useStore } from 'zustand';
import { CalendarClock, Copy } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { useAppearanceStore } from '@/theme/appearance-store';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import type { HyperMentionSelection } from '../document/HyperDocumentMentions';
import { hyperCaptureDocumentDate, hyperDateReminderOptions, hyperDocumentDateLabel, hyperDocumentDateMention, type HyperDateDraft } from './HyperDocumentDateModel';
import { createHyperDocumentDateStore } from './HyperDocumentDateStore';

export const hyperDocumentDateStrings = {
  insert: 'Date or reminder', edit: 'Edit date or reminder', description: 'Choose a date and an optional reminder. Reminders appear in Notifications while HyperTask is running.',
  date: 'Date', includeTime: 'Include time', time: 'Time', reminder: 'Remind me', customTime: 'Reminder date and time', save: 'Save date', saving: 'Saving…', saved: 'Date saved', copyRecovery: 'Copy recovery details',
  none: 'None', atTimeOfEvent: 'At time of event', fiveMinsBefore: '5 minutes before', tenMinsBefore: '10 minutes before', fifteenMinsBefore: '15 minutes before', thirtyMinsBefore: '30 minutes before', oneHourBefore: '1 hour before', twoHoursBefore: '2 hours before',
  onDayOfEvent: 'On the day at 9:00 AM', oneDayBefore: '1 day before at 9:00 AM', twoDaysBefore: '2 days before at 9:00 AM', oneWeekBefore: '1 week before at 9:00 AM', custom: 'Custom',
} as const;
const insertEvent = 'hypertask:document-date-insert';
export function hyperOpenDocumentDatePicker(editorHost: HTMLElement) { editorHost.dispatchEvent(new Event(insertEvent)); }
export interface HyperDocumentDateProps {
  session: HyperDocumentSession; editable: boolean; isEditable(): boolean; editorHost: RefObject<HTMLElement | null>;
  canWrite?(): boolean;
  onPrepareInsert(): HyperMentionSelection | null; onApplied?(focus: { id: string; offset: number }): void;
  rowScope?: { viewId: string; rowId: string };
}
export function HyperDocumentDate(props: HyperDocumentDateProps) {
  const { tr } = useTr(), owner = useHyperDocumentOwner(), latest = useRef(props); latest.current = props;
  const ownerKey = hyperDocumentOwnerKey(owner), scope = `${ownerKey}:${props.session.id}`;
  const store = useMemo(() => owner ? createHyperDocumentDateStore({ session: props.session, owner, editable: () => latest.current.isEditable(), canWrite: () => latest.current.canWrite?.() ?? latest.current.editable, rowScope: props.rowScope }) : null, [scope, props.session]);
  const historyBlocked = useSyncExternalStore(notify => store ? store.history.store.subscribe(notify) : () => {}, () => store?.history.blocked() ?? false);
  const [open, setOpen] = useState(false), [openError, setOpenError] = useState<string | null>(null);
  const settings = useAppearanceStore(state => state.dateTime);
  const t = (key: keyof typeof hyperDocumentDateStrings) => { const path = `hyperDocumentDate.${key}`, value = tr(path); return value === path ? hyperDocumentDateStrings[key] : value; };
  useLayoutEffect(() => { setOpen(false); }, [store]);
  useEffect(() => store?.start(), [store]);
  const beginInsert = () => {
    if (!store || !latest.current.isEditable()) return;
    try { const insertion = latest.current.onPrepareInsert(); setOpenError(null); setOpen(true); void store.open(null, insertion); }
    catch (error) { setOpenError(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => {
    const host = props.editorHost.current; if (!host || !store) return;
    const click = (event: MouseEvent) => {
      const atom = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-hyper-date-mention]') : null;
      if (!atom || !host.contains(atom)) return;
      event.preventDefault(); event.stopPropagation(); if (!latest.current.isEditable()) return;
      try {
        const block = atom.closest<HTMLElement>('[data-hyper-text]'), doc = latest.current.session.store.getState().document;
        if (!block?.dataset.hyperText || !doc) throw new Error('The date mention is unavailable.');
        if (!block.isContentEditable) return;
        const ordinal = Array.from(block.querySelectorAll('[data-hyper-date-mention]')).indexOf(atom);
        const target = hyperCaptureDocumentDate(doc, block.dataset.hyperText, ordinal);
        setOpenError(null); setOpen(true); void store.open(target);
      } catch (error) { setOpenError(error instanceof Error ? error.message : String(error)); }
    };
    const keyboard = (event: KeyboardEvent) => { if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement && event.target.matches('[data-hyper-date-mention]')) { event.preventDefault(); event.stopPropagation(); event.target.click(); } };
    const paint = () => {
      for (const atom of host.querySelectorAll<HTMLElement>('[data-hyper-date-mention]')) {
        try { const mention = hyperDocumentDateMention({ insert: '$', attributes: JSON.parse(atom.dataset.hyperAttributes ?? '{}') }); if (!mention) continue;
          const label = hyperDocumentDateLabel(mention, settings.dateFormat, settings.timeFormat);
          if (atom.textContent !== label) atom.textContent = label; atom.setAttribute('aria-label', label); atom.setAttribute('aria-disabled', String(!latest.current.isEditable()));
        } catch { /* Keep malformed imported attributes untouched. */ }
      }
    };
    paint(); const observer = new MutationObserver(paint); observer.observe(host, { childList: true, subtree: true });
    host.addEventListener('click', click); host.addEventListener('keydown', keyboard); host.addEventListener(insertEvent, beginInsert);
    return () => { observer.disconnect(); host.removeEventListener('click', click); host.removeEventListener('keydown', keyboard); host.removeEventListener(insertEvent, beginInsert); };
  }, [store, props.editorHost, settings, props.editable]);
  return <>
    <Button variant="ghost" size="sm" disabled={!props.editable || !store || historyBlocked} onMouseDown={event => event.preventDefault()} onClick={beginInsert}><CalendarClock />{t('insert')}</Button>
    {openError && <Alert variant="destructive"><AlertDescription>{openError}</AlertDescription></Alert>}
    <Dialog open={open} onOpenChange={value => { if (store?.getState().status === 'saving') return; if (!value) store?.close(); setOpen(value); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{store && <HyperDocumentDateForm store={store} editable={props.editable} onApplied={focus => latest.current.onApplied?.(focus)} />}</DialogContent>
    </Dialog>
  </>;
}
function HyperDocumentDateForm({ store, editable, onApplied }: { store: ReturnType<typeof createHyperDocumentDateStore>; editable: boolean; onApplied(focus: { id: string; offset: number }): void }) {
  const { tr } = useTr(), state = useStore(store), [draft, setDraft] = useState(state.draft);
  const t = (key: keyof typeof hyperDocumentDateStrings) => { const path = `hyperDocumentDate.${key}`, value = tr(path); return value === path ? hyperDocumentDateStrings[key] : value; };
  useEffect(() => { setDraft(state.draft); }, [state.draft]);
  const busy = state.status === 'loading' || state.status === 'saving', disabled = busy || !editable || ['saved', 'partial', 'error'].includes(state.status);
  const set = (patch: Partial<HyperDateDraft>) => setDraft(current => ({ ...current, ...patch }));
  const options = hyperDateReminderOptions.filter(option => draft.includeTime || ['none', 'onDayOfEvent', 'oneDayBefore', 'twoDaysBefore', 'oneWeekBefore', 'custom'].includes(option));
  const items = options.map(value => ({ value: value as string, label: t(value) }));
  if (!items.some(item => item.value === draft.reminderOption)) items.push({ value: draft.reminderOption, label: draft.reminderOption });
  return <>
    <DialogHeader><DialogTitle>{state.editingExisting ? t('edit') : t('insert')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
    {(state.error || state.status === 'loading') && (state.status === 'loading' ? <Spinner /> : <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>)}
    <label className="flex flex-col gap-2 text-sm font-medium">{t('date')}<Input aria-label={t('date')} type="date" min="1000-01-01" max="9999-12-31" value={draft.date} disabled={disabled} onChange={event => set({ date: event.target.value })} /></label>
    <label className="flex items-center gap-2 text-sm"><Checkbox aria-label={t('includeTime')} checked={draft.includeTime} disabled={disabled} onCheckedChange={checked => { const includeTime = checked === true; set({ includeTime, ...(!includeTime && !['none', 'onDayOfEvent', 'oneDayBefore', 'twoDaysBefore', 'oneWeekBefore', 'custom'].includes(draft.reminderOption) ? { reminderOption: 'onDayOfEvent' } : {}) }); }} />{t('includeTime')}</label>
    {draft.includeTime && <label className="flex flex-col gap-2 text-sm font-medium">{t('time')}<Input aria-label={t('time')} type="time" step={1} value={draft.time} disabled={disabled} onChange={event => set({ time: event.target.value })} /></label>}
    <Select value={draft.reminderOption} items={items} disabled={disabled} onValueChange={value => { if (value) set({ reminderOption: value }); }}><SelectTrigger aria-label={t('reminder')}><SelectValue /></SelectTrigger><SelectContent>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
    {draft.reminderOption === 'custom' && <label className="flex flex-col gap-2 text-sm font-medium">{t('customTime')}<Input aria-label={t('customTime')} type="datetime-local" step={1} value={draft.customTime} disabled={disabled} onChange={event => set({ customTime: event.target.value })} /></label>}
    {state.status === 'saved' && <Badge variant="success-light" size="sm">{t('saved')}</Badge>}
    <DialogFooter className="m-0 border-0 bg-transparent p-0">
      {state.recovery && <Button variant="outline" onClick={() => window.appflowy.clipboard.writeText(state.recovery)}><Copy />{t('copyRecovery')}</Button>}
      <Button disabled={disabled || !draft.date || state.status !== 'editing'} onClick={() => void store.save(draft).then(focus => { if (focus) onApplied(focus); }).catch(() => {})}>{busy ? <Spinner /> : <CalendarClock />}{state.status === 'saving' ? t('saving') : t('save')}</Button>
    </DialogFooter>
  </>;
}
