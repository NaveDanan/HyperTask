import type { z } from 'zod';
import { hyperHubExtract } from '@shared/HyperHubExtraction';
import type { HyperHubSetupScope } from '@shared/HyperTaskHub';
import type { HyperOutlookValues } from '../HyperOutlookSchema';
import type { HyperHubInventory, HyperHubRecord } from './HyperTaskHubStore';
import { TZDate } from '@date-fns/tz';
import type { HyperHubAgendaItem, HyperHubReadScope } from '@shared/HyperTaskHub';
import type { HyperOutlookBridge } from '../HyperOutlookBridge';
import { hyperHubEmailIdentity, hyperHubBusyInterval, hyperHubHash, hyperHubInstant } from './HyperTaskHubStore';
import { HyperHubAccessLost, HyperHubStoreAccessLost, type HyperHubBatch } from './HyperTaskHubSync';

/** Seven civil days, including today. Local midnights also bound all-day reservations on DST transitions. */
export function hyperHubCalendarInterval(now: number, zone: string) {
  const day = new TZDate(now, zone);
  day.setHours(0, 0, 0, 0);
  const start = hyperHubInstant(+day);
  day.setDate(day.getDate() + 7);
  return { start, end: hyperHubInstant(+day) };
}

export class HyperHubOutlookSource {
  readonly kind = 'outlook-calendar';
  readonly connectionId = 'outlook';
  readonly label = 'Outlook calendar';
  readonly availabilitySource = true;
  readonly queryId: string;

  constructor(private readonly bridge: Pick<HyperOutlookBridge, 'request'> | undefined, private readonly storeId: string | undefined,
    private readonly zone: string, private readonly now = Date.now, private readonly calendar?: import('../HyperOutlookCalendarCache').HyperOutlookCalendarCache) {
    this.queryId = hyperHubHash('calendar', storeId);
  }
  private async occurrence(record: HyperHubRecord, open: boolean, assertCurrent: () => void) {
    const occurrence = record.occurrence;
    if (!this.bridge || !occurrence || record.key.kind !== this.kind || record.key.storeId !== this.storeId ||
      record.key.originalStart.kind !== 'instant') throw new HyperHubAccessLost();
    try {
      await this.bridge.request('hub.occurrence', { storeId: record.key.storeId, entryId: record.key.occurrenceId,
        originalStart: record.key.originalStart.iso, modified: occurrence.sourceTime.iso, start: occurrence.interval.start.iso, open }, assertCurrent);
    } catch (error) {
      if (error instanceof Error && error.message === 'Outlook calendar store changed.') throw new HyperHubStoreAccessLost();
      if (error instanceof Error && /^Occurrence (access lost|changed)/.test(error.message)) throw new HyperHubAccessLost();
      throw error;
    }
  }
  check(record: HyperHubRecord, signal: AbortSignal) { return this.occurrence(record, false, () => signal.throwIfAborted()); }
  open(record: HyperHubRecord, _signal: AbortSignal, assertCurrent: () => void) { return this.occurrence(record, true, assertCurrent); }

  async verifyCommit(signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.bridge || !this.storeId) throw new HyperHubAccessLost();
    try {
      if (await this.bridge.request('hub.store', { storeId: this.storeId }) !== this.storeId) throw new HyperHubStoreAccessLost();
    } catch (error) {
      if (error instanceof Error && error.message === 'Outlook calendar store changed.') throw new HyperHubStoreAccessLost();
      if (error instanceof Error && error.message === 'Occurrence access lost.') throw new HyperHubAccessLost();
      throw error;
    }
  }

  async read(scope: HyperHubReadScope, signal: AbortSignal): Promise<HyperHubBatch> {
    if (!this.bridge || !this.storeId) throw new HyperHubAccessLost();
    const interval = hyperHubCalendarInterval(this.now(), this.zone);
    const { storeId } = this;
    try {
      signal.throwIfAborted();
      const range = { start: interval.start.iso, end: interval.end.iso };
      const result = this.calendar ? await this.calendar.read(storeId, range) : await this.bridge.request('hub.calendar', { storeId, ...range });
      if (result.storeId !== storeId) throw new HyperHubStoreAccessLost();
      signal.throwIfAborted();
      if (Date.parse(result.start) !== Date.parse(interval.start.iso) || Date.parse(result.end) !== Date.parse(interval.end.iso)) {
        throw new Error('Outlook returned a different coverage interval.');
      }
      const seriesIds = [...new Set(result.events.flatMap(e => !e.private && e.isMeeting && e.details?.seriesId ? [e.details.seriesId] : []))];
      const historical: typeof result.events = [];
      if (seriesIds.length) {
        const end = interval.start.iso, start = hyperHubInstant(Date.parse(end) - 30 * 86400000).iso;
        try {
          const page = await this.bridge.request('hub.calendar', { storeId, start, end, seriesIds }, () => signal.throwIfAborted());
          if (page.storeId !== storeId) throw new HyperHubStoreAccessLost();
          if (page.start === start && page.end === end && page.exhausted && page.completeness === 'complete') {
            for (const series of seriesIds) historical.push(...page.events.filter(e => !e.private && e.isMeeting &&
              e.details?.seriesId === series && Date.parse(e.end) <= Date.parse(end))
              .sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 2));
          }
        } catch (error) {
          if (signal.aborted || error instanceof HyperHubAccessLost ||
            error instanceof Error && /store changed|access lost/.test(error.message)) throw error;
        }
      }
      const evidence: HyperHubRecord[] = [];
      const agenda = new Map<string, HyperHubAgendaItem>();
      for (const event of [...historical, ...result.events]) {
        if (!event.private && event.marker?.responseStatus === 4) continue;
        const span = { start: hyperHubInstant(Date.parse(event.start)), end: hyperHubInstant(Date.parse(event.end)) };
        if (span.end.iso <= span.start.iso) throw new Error('Invalid Outlook interval.');
        const sourceKind = this.kind;
        const item: HyperHubAgendaItem = event.private ? hyperHubBusyInterval(span, sourceKind) : {
          id: hyperHubHash(storeId, event.entryId, Date.parse(event.originalStart)), interval: span, sourceKind, private: false,
          allDay: event.allDay, availability: event.availability, title: event.title, isMeeting: event.isMeeting, organizerIsOwner: event.organizerIsOwner,
        };
        if (!event.private && event.isMeeting && event.details) {
          const d = event.details;
          const key = { kind: this.kind, storeId, occurrenceId: event.entryId,
            originalStart: { kind: 'instant' as const, iso: event.originalStart } } as const;
          const sourceTime = { kind: 'instant' as const, iso: d.modified };
          const revision = hyperHubHash(event);
          evidence.push({ key, openTarget: key, scope, id: item.id, revision, observedAt: hyperHubInstant(this.now()),
            initialState: 'ready', completion: 'unknown', role: 'origin', label: event.title, projectId: '',
            occurrence: { key: { ...key, connectionId: this.connectionId }, id: item.id, revision, interval: span,
              accessible: true, cancelled: false, sensitivity: d.sensitivity, sourceTime, stale: false,
              verifiedSeriesId: d.seriesId && hyperHubHash(storeId, d.seriesId), subject: event.title,
              organizerIsOwner: event.organizerIsOwner, response: event.organizerIsOwner ? 'unknown' : 'accepted',
              isMeeting: true, excerpt: d.excerpt, organizer: d.organizer ? { name: d.organizer, verifiedIdentityId: hyperHubEmailIdentity(d.organizerEmail ?? '') } : undefined,
              joinUrl: d.joinUrl ?? undefined, attendees: d.attendees.map(p => ({ name: p.name,
                verifiedIdentityId: hyperHubEmailIdentity(p.email) })) } });
        }
        if (!historical.includes(event)) agenda.set(item.id, item);
      }
      return { records: [], evidence, agenda: [...agenda.values()], interval, completeness: result.exhausted ? result.completeness : 'partial', cursor: null };
    } catch (error) {
      if (error instanceof Error && error.message === 'Outlook calendar store changed.') throw new HyperHubStoreAccessLost();
      if (error instanceof Error && error.message === 'Occurrence access lost.') throw new HyperHubAccessLost();
      throw error;
    }
  }
}

type HeaderPage = z.output<(typeof HyperOutlookValues)['hub.mailHeaders']>;
type Header = HeaderPage['headers'][number];
type Folder = 'inbox' | 'sent';

/** Requires a successful classic-profile verification before the shipping default can change. */
export const HyperHubPersonalFlagsVerified = false;

export function hyperHubMailConsent(scope: HyperHubSetupScope) {
  const mail = scope.mail;
  return !!(mail?.enabled && mail.confirmedAt && Number.isFinite(Date.parse(mail.confirmedAt.iso)) && mail.folders.length);
}

export class HyperHubMailSource {
  readonly kind = 'outlook-mail';
  readonly label = 'Outlook mail';
  readonly connectionId = 'outlook-mail';
  readonly queryId: string;

  constructor(private readonly bridge: Pick<HyperOutlookBridge, 'request'> | undefined, private readonly storeId: string | undefined,
    private readonly setup: HyperHubSetupScope, private readonly flagsVerified = HyperHubPersonalFlagsVerified, private readonly now = Date.now) {
    this.queryId = hyperHubHash('mail', storeId, setup.mail?.folders.slice().sort(), setup.mail?.retentionDays ?? 30,
      !!setup.mail?.importFlags && flagsVerified, setup.aliases, setup.zone);
  }

  private binding(signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.bridge || !this.storeId || !hyperHubMailConsent(this.setup)) throw new HyperHubAccessLost();
    return { bridge: this.bridge, storeId: this.storeId };
  }

  private async bound<T>(operation: () => Promise<T>) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof Error && /Outlook (calendar store changed|mail store changed|mailbox access lost)/.test(error.message)) throw new HyperHubStoreAccessLost();
      if (error instanceof Error && error.message === 'Outlook mail access lost.') throw new HyperHubAccessLost();
      throw error;
    }
  }
  async verifyCommit(signal: AbortSignal) {
    const { bridge, storeId } = this.binding(signal);
    if (await this.bound(() => bridge.request('hub.store', { storeId }, () => signal.throwIfAborted())) !== storeId) throw new HyperHubStoreAccessLost();
  }
  private target(record: HyperHubRecord, signal: AbortSignal) {
    const { storeId } = this.binding(signal);
    const { key, mailFolder: folder } = record;
    if (key.kind !== 'outlook-mail' || key.storeId !== storeId || !folder || !this.setup.mail!.folders.includes(folder)) throw new HyperHubAccessLost();
    return { storeId, entryId: key.entryId, folder };
  }
  async check(record: HyperHubRecord, signal: AbortSignal) {
    const args = this.target(record, signal);
    const detail = await this.bound(() => this.bridge!.request('hub.mailDetail', { ...args, headerOnly: true }, () => signal.throwIfAborted()));
    if (detail?.visibility !== 'public' || detail.storeId !== args.storeId || detail.entryId !== args.entryId) throw new HyperHubAccessLost();
    if (detail.modified !== record.revision) throw new Error('The message changed. Refresh before reviewing it.');
  }
  async open(record: HyperHubRecord, signal: AbortSignal, assertCurrent: () => void) {
    const args = this.target(record, signal);
    await this.bound(() => this.bridge!.request('mail.open', args, assertCurrent));
  }
  async read(scope: HyperHubReadScope, signal: AbortSignal, previous?: HyperHubInventory): Promise<HyperHubBatch> {
    const { bridge, storeId } = this.binding(signal);
    const mail = this.setup.mail!;
    const now = this.now(), retention = (mail.retentionDays ?? 30) * 86400000;
    const since = hyperHubInstant(now - retention).iso, observedAt = hyperHubInstant(now);
    const checked = new Set<string>();
    const headers = new Map<string, { folder: Folder; header: Header }>();
    let pagesRead = 0;
    let complete = true, sentCovered = mail.folders.includes('sent');
    for (const folder of mail.folders) {
      for (const activeFlags of mail.importFlags && this.flagsVerified ? [false, true] : [false]) {
        let after: HeaderPage['next'] = null;
        do {
          signal.throwIfAborted();
          let page: HeaderPage;
          try {
            page = await this.bound(() => bridge.request('hub.mailHeaders', { storeId, since, folder, after, activeFlags, limit: 100 }, () => signal.throwIfAborted()));
            pagesRead++;
          } catch (error) {
            if (error instanceof HyperHubAccessLost || !pagesRead || signal.aborted) throw error;
            complete = false; sentCovered = false;
            break;
          }
          if (page.storeId !== storeId) throw new HyperHubStoreAccessLost();
          for (const id of page.excludedIds) { checked.add(id); headers.delete(id); }
          for (const header of page.headers) {
            if (header.visibility !== 'public') {
              checked.add(header.entryId); headers.delete(header.entryId);
              if (folder === 'sent') sentCovered = false;
              continue;
            }
            headers.set(header.entryId, { header, folder });
          }
          if (!page.complete) complete = false;
          if (folder === 'sent' && !activeFlags && (!page.replyCoverage || !page.complete)) sentCovered = false;
          if (page.exhausted) break;
          if (!page.next || (after && (page.next.modified < after.modified ||
            (page.next.modified === after.modified && page.next.entryId <= after.entryId)))) throw new Error('Invalid Outlook continuation.');
          after = page.next;
        } while (after);
      }
    }
    // A complete header inventory still checks privacy and folder membership every time.
    // Reuse extracted text only when every revision, reply header and flag is unchanged.
    const checkpoint = hyperHubHash(sentCovered, [...headers.keys()].sort().map(id => {
      const item = headers.get(id)!;
      return [item.folder, item.header, Date.parse(item.header.authoredAt ?? '') >= now - retention];
    }));
    if (complete && previous?.evidence && previous.cursor === checkpoint && previous.status.coverage.every(c => c.completeness === 'complete')) {
      const records = previous.records.filter(r => r.rawStatus === 'Flagged' || (r.expiresAt ?? 0) > now)
        .map(r => ({ ...r, scope, observedAt, expiresAt: r.rawStatus === 'Flagged' ? now + retention : r.expiresAt }));
      return { records, evidence: previous.evidence.filter(r => (r.expiresAt ?? 0) > now).map(r => ({ ...r, scope, observedAt })), cursor: checkpoint, completeness: 'complete' };
    }
    const sent = [...headers.values()].filter(h => h.folder === 'sent').map(h => h.header);
    const replies = new Set(sent.map(h => h.inReplyTo));
    const conversations = new Set(sent.map(h => h.conversationId));
    sentCovered &&= sent.every(h => !!h.conversationId);
    const evidence: HyperHubRecord[] = [];
    const records: HyperHubRecord[] = [];
    for (const { folder, header } of headers.values()) {
      signal.throwIfAborted();
      const flagged = this.flagsVerified && mail.importFlags && header.flag === 'active';
      const authored = Date.parse(header.authoredAt ?? '');
      const recent = authored >= now - retention;
      if (!flagged && !recent) { checked.add(header.entryId); continue; }
      const { entryId } = header;
      let detail: z.output<(typeof HyperOutlookValues)['hub.mailDetail']>;
      try { detail = await this.bound(() => bridge.request('hub.mailDetail', { storeId, entryId, folder, headerOnly: !recent }, () => signal.throwIfAborted())); }
      catch (error) {
        if (error instanceof HyperHubAccessLost || signal.aborted) throw error;
        complete = false;
        continue;
      }
      checked.add(entryId);
      if (detail?.visibility !== 'public') continue;
      if (detail.storeId !== storeId || detail.entryId !== entryId) throw new HyperHubAccessLost();
      if (detail.modified !== header.modified) { complete = false; continue; }
      const openTarget = { kind: this.kind, entryId, storeId } as const;
      const base = { scope, observedAt, revision: header.modified, projectId: '', openTarget, mailFolder: folder, attachmentNames: detail.attachmentNames, label: detail.subject || 'Outlook mail',
        completion: 'unknown' as const, role: 'origin' as const, createdAt: Number.isFinite(authored) ? hyperHubInstant(authored) : undefined };
      const people = [{ id: 'owner', name: this.setup.aliases[0] ?? 'Owner', role: 'owner' as const },
        ...(detail.sender && folder === 'inbox' ? [{ id: detail.sender, name: detail.sender, role: 'requester' as const }] : [])];
      if (recent) evidence.push({ ...base, id: hyperHubHash(scope.connectionId, storeId, entryId), key: openTarget,
        initialState: 'review', briefExcerpt: detail.body.slice(0, 1024), verifiedThreadId: header.conversationId ?? undefined,
        verifiedIdentityIds: [detail.sender].map(hyperHubEmailIdentity).filter((id): id is string => !!id),
        expiresAt: Math.min(authored, now) + retention });
      if (flagged) records.push({ ...base, people, id: hyperHubHash(storeId, entryId, 'personal-flag'), key: openTarget,
        expiresAt: now + retention, title: base.label, initialState: 'ready', rawStatus: 'Flagged',
        due: header.flagDue ? { kind: 'instant', iso: header.flagDue } : undefined });
      if (!recent || (folder === 'sent' && !detail.ownerSender && !this.setup.aliases.some(a => a.toLowerCase() === detail.sender.toLowerCase()))) continue;
      const candidates = hyperHubExtract({ folder, body: detail.body, truncated: detail.bodyTruncated, to: detail.to, aliases: this.setup.aliases, zone: header.authoredZone ?? this.setup.zone,
        distributionList: detail.distributionList, authoredAt: header.authoredAt!,
        unanswered: complete && sentCovered && !!header.conversationId && !!header.messageId &&
          !replies.has(header.messageId) && !conversations.has(header.conversationId) });
      for (const candidate of candidates) {
        const id = hyperHubHash(storeId, entryId, candidate.fingerprint);
        records.push({ ...base, people, id, key: { ...openTarget, actionSpan: id }, expiresAt: Math.min(authored, now) + retention,
          initialState: 'review', title: candidate.excerpt, due: candidate.resolvedDate, rawStatus: folder === 'sent' ? 'Sent' : 'Received',
          reviewSpan: { ...candidate, fingerprint: id, evidenceId: id } });
      }
    }
    // Any inconsistent detail read invalidates negative reply evidence across this inventory.
    return { evidence, records: complete ? records : records.filter(r => r.reviewSpan?.rule !== 'Unanswered direct question'),
      cursor: complete ? checkpoint : null, checkedMailIds: [...checked], completeness: complete ? 'complete' : 'partial' };
  }
}
