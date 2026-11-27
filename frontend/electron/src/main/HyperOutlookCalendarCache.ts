import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { HyperOutlookEvent, HyperOutlookRange } from '@shared/api';
import type { HyperOutlookBridge } from './HyperOutlookBridge';
import type { HyperOutlookValues } from './HyperOutlookSchema';
import { hyperHubHash } from './hyper-task-hub/HyperTaskHubStore';

type Page = z.output<typeof HyperOutlookValues['hub.calendar']>;
type Read = { start: number; end: number; pending: Promise<Page>; expires: number; complete?: boolean };
type Target = { storeId: string; entryId: string; originalStart: string; start: string };
export class HyperOutlookCalendarCache {
  private generation = 0;
  private store = '';
  private reads: Read[] = [];
  private handles = new Map<string, { key: Target; document: object; subscription: string; meeting?: string; end: string; eventId: string; recurring: boolean }>();
  private subscriptions = new Map<string, { range: HyperOutlookRange; document: object; active(): boolean; current(): boolean;
    delivered: boolean; serial: number; notify(items: HyperOutlookEvent[], error?: string): void }>();
  private timer?: NodeJS.Timeout;
  constructor(private readonly bridge: Pick<HyperOutlookBridge, 'request'>, private readonly now = Date.now) {}
  meetings: (store: string) => ReadonlyMap<string, string> = () => new Map();
  invalidate() {
    this.generation++;
    this.reads = [];
    this.handles.clear();
  }
  reset() {
    this.invalidate();
    for (const s of this.subscriptions.values()) if (s.current() && s.delivered) s.notify([]);
  }
  async read(storeId: string, range: HyperOutlookRange): Promise<Page> {
    if (storeId !== this.store) { this.reset(); this.store = storeId; }
    const generation = this.generation;
    const start = Date.parse(range.start), end = Date.parse(range.end);
    this.reads = this.reads.filter(r => r.expires > this.now() && r.complete !== false);
    const scan = (a: number, b: number) => {
      const span = { start: new Date(a).toISOString(), end: new Date(b).toISOString() };
      const pending = this.bridge.request('hub.calendar', { storeId, ...span, markers: true }).then(page => {
        if (page.storeId !== storeId || Date.parse(page.start) !== a || Date.parse(page.end) !== b || generation !== this.generation) throw new Error('Outlook calendar changed.');
        r.complete = page.exhausted && page.completeness === 'complete';
        return page;
      }).catch(error => { this.reads = this.reads.filter(entry => entry !== r); throw error; });
      const r: Read = { start: a, end: b, pending, expires: this.now() + 60_000 };
      this.reads.push(r);
      return r;
    };
    let cursor = start;
    const pages = [];
    for (const r of [...this.reads].sort((a, b) => a.start - b.start)) {
      if (r.end <= cursor || r.start >= end) continue;
      if (cursor < r.start) pages.push(scan(cursor, r.start).pending);
      pages.push(r.pending); cursor = Math.min(end, r.end);
      if (cursor === end) break;
    }
    if (cursor < end) pages.push(scan(cursor, end).pending);
    const results = await Promise.all(pages);
    const events = new Map<string, Page['events'][number]>();
    for (const p of results) for (const e of p.events) if (Date.parse(e.end) > start && Date.parse(e.start) < end) {
      events.set(e.private ? JSON.stringify([e.start, e.end]) : JSON.stringify([e.entryId, e.originalStart]), e);
    }
    const complete = results.every(p => p.exhausted && p.completeness === 'complete');
    return { ...range, storeId, events: [...events.values()], exhausted: complete, completeness: complete ? 'complete' : 'partial' };
  }
  private async items(id: string) {
    const s = this.subscriptions.get(id);
    if (!s || !s.current()) throw new Error('Outlook subscription closed.');
    const serial = ++s.serial;
    const storeId = await this.bridge.request('hub.store', undefined);
    const page = await this.read(storeId, s.range), generation = this.generation;
    if (await this.bridge.request('hub.store', { storeId }) !== storeId || generation !== this.generation ||
      this.subscriptions.get(id) !== s || serial !== s.serial || !s.current()) throw new Error('Outlook subscription changed.');
    this.forget(id);
    const meetings = this.meetings(storeId);
    s.delivered = true;
    return page.events.map((e): HyperOutlookEvent => {
      const marker = e.private ? undefined : e.marker;
      const meeting = e.private || !e.isMeeting || !e.details ? undefined : hyperHubHash(storeId, e.entryId, Date.parse(e.originalStart));
      const handle = randomUUID();
      const eventId = e.private ? hyperHubHash(e.start, e.end) : e.entryId + (marker?.recurrenceState ? '|' + e.originalStart : '');
      if (!e.private) this.handles.set(handle, { key: { storeId, entryId: e.entryId, originalStart: e.originalStart, start: e.start }, document: s.document, subscription: id, meeting, end: e.end, eventId, recurring: !!marker?.recurrenceState });
      return { id: eventId,
        occurrenceHandle: e.private ? undefined : handle, hubMeetingId: meeting && !e.private && e.details?.modified === meetings.get(meeting) ? meeting : undefined,
        subject: e.private ? 'Busy' : e.title, start: marker?.start ?? e.start, end: marker?.end ?? e.end, allDay: !e.private && e.allDay,
        location: '', body: '', organizer: '', attendees: [], attendeeCount: marker?.attendeeCount ?? 0, joinUrl: null, busyStatus: 2, isOrganizer: !!marker?.isOrganizer,
        responseStatus: marker?.responseStatus ?? 0, recurrenceState: marker?.recurrenceState ?? 0, isCancelled: false, isPrivate: e.private,
        isRecurring: !!marker?.recurrenceState, lastModified: marker?.modified ?? e.start, categories: marker?.categories ?? [] };
    });
  }
  async resolve(handle: string, document: object) {
    const h = this.handles.get(handle);
    if (!h || h.document !== document) throw new Error('Outlook occurrence expired.');
    const item = await this.bridge.request('calendar.resolve', h.key);
    if (this.handles.get(handle) !== h) throw new Error('Outlook occurrence changed.');
    const meeting = h.meeting;
    return { ...item, hubMeetingId: meeting && this.meetings(h.key.storeId).get(meeting) === item.lastModified ? meeting : undefined };
  }
  private forget(id: string) { for (const [key, h] of this.handles) if (h.subscription === id) this.handles.delete(key); }
  stop(id: string, document: object) {
    if (this.subscriptions.get(id)?.document !== document) return;
    this.subscriptions.delete(id);
    this.forget(id);
    if (!this.subscriptions.size) { clearInterval(this.timer); this.timer = undefined; }
  }
  subscribe(id: string, range: HyperOutlookRange, document: object, active: () => boolean, current: () => boolean,
    notify: (items: HyperOutlookEvent[], error?: string) => void, force: boolean) {
    if (this.subscriptions.has(id)) throw new Error('Duplicate Outlook subscription.');
    if (force) this.reads = this.reads.filter(r => r.end <= Date.parse(range.start) || r.start >= Date.parse(range.end));
    this.subscriptions.set(id, { document, active, current, range, notify, serial: 0, delivered: false });
    this.timer ??= setInterval(() => this.refresh(), 60_000);
    this.timer.unref();
    return this.items(id);
  }
  edited(id: string | undefined, saved?: Pick<HyperOutlookEvent, 'start' | 'end' | 'isRecurring' | 'allDay'>, unknown = false) {
    const prior = id ? [...this.handles.values()].find(h => h.eventId === id) : undefined;
    // A series edit, an all-day civil date without its calendar zone, or a lost receipt has no bounded affected interval.
    if (unknown || id && !prior || prior?.recurring || saved?.isRecurring || saved?.allDay || !prior && !saved) {
      this.invalidate(); this.refresh(); return;
    }
    const spans = [...(prior ? [{ start: prior.key.start, end: prior.end }] : []), ...(saved ? [saved] : [])];
    const intersects = (start: number, end: number) => spans.some(s => Date.parse(s.end) > start && Date.parse(s.start) < end);
    this.reads = this.reads.filter(r => !intersects(r.start, r.end));
    for (const [key, h] of this.handles) if (h.eventId === id) this.handles.delete(key);
    this.refresh(intersects);
  }
  refresh(intersects?: (start: number, end: number) => boolean) {
    for (const [id, s] of this.subscriptions) {
      if (!s.current()) { this.stop(id, s.document); continue; }
      if (intersects && !intersects(Date.parse(s.range.start), Date.parse(s.range.end))) continue;
      const next = s.serial + 1;
      if (s.active()) void this.items(id).then(items => {
        if (s.current() && this.subscriptions.get(id) === s) s.notify(items);
      }, () => { if (s.current() && this.subscriptions.get(id) === s && s.serial === next) s.notify([], 'Outlook calendar unavailable.'); });
    }
  }
}
