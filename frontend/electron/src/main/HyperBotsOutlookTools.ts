import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { HyperBotsCardRow, HyperBotsDelivery, HyperBotsToolName } from '@shared/HyperBots';
import { HyperBotsToolError, type HyperBotsBinding, type HyperBotsTool } from './HyperBotsRuntime';
import { HyperOutlookLost, type HyperOutlookBridge } from './HyperOutlookBridge';
import type { HyperOutlookArgs, HyperOutlookOp, HyperOutlookValues } from './HyperOutlookSchema';

// HyperBots' Outlook tools: the owner's classic Outlook through HyperOutlookBridge (calendar, mail, invitations).
// Reads may be pre-allowed in Bot settings; every write waits for the owner. A write's card shows the sending
// account, the recipients (those outside the owner's domain flagged) and the exact text, and its fingerprint pins the
// account and the item it acts on, so a change before the call sends it back to the owner.

export type HyperBotsOutlook = Pick<HyperOutlookBridge, 'request'>;
/** These tools always bind: `destination` is shown to the owner, `fingerprint` must still match right before the call. */
export type HyperBotsBoundTool = HyperBotsTool & Required<Pick<HyperBotsTool, 'bind'>>;
const DAY = 86_400_000;
const CALENDAR: HyperBotsBinding = { destination: 'Outlook calendar on this PC', fingerprint: 'outlook:local-classic' };
const MAIL: HyperBotsBinding = { destination: 'Outlook mail on this PC', fingerprint: 'outlook:local-mail' };
// The content hash binds a reply or forward to what was approved; without it the message cannot be checked.
const UNREADABLE = 'Outlook could not read all of this message (its text or attachment details), so a bot cannot reply to or forward it; do it in Outlook.';
const clip = (text: string, max: number) => text.length > max ? text.slice(0, max) + '…' : text;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function hyperBotsParseArgs<T extends z.ZodType>(schema: T, args: unknown): z.output<T> {
  const valid = schema.safeParse(args);
  if (valid.success) return valid.data;
  const issue = valid.error.issues[0];
  throw new HyperBotsToolError('args', `${issue?.path.length ? issue.path.join('.') + ': ' : ''}${issue?.message ?? 'Invalid arguments.'}`);
}
/** A refusal from Outlook is final; a lost or timed-out request may have been done, so its outcome is unknown. */
async function outlook<K extends HyperOutlookOp>(bridge: HyperBotsOutlook, op: K, args: z.input<(typeof HyperOutlookArgs)[K]>): Promise<z.output<(typeof HyperOutlookValues)[K]>> {
  try { return await bridge.request(op, args); }
  catch (error) { throw new HyperBotsToolError(error instanceof HyperOutlookLost ? 'transport' : 'refused', message(error)); }
}

// Model-supplied datetimes may omit the offset (local time); Outlook receives UTC instants.
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use an ISO datetime such as 2026-11-17T09:00:00.')
  .refine(value => !Number.isNaN(Date.parse(value)), 'Use an ISO datetime such as 2026-11-17T09:00:00.')
  .transform(value => new Date(Date.parse(value)).toISOString());
const day = z.iso.date('Use a date such as 2026-11-17.');
const eventId = z.string().regex(/^[A-Fa-f0-9]+(?:\|\d{4}-\d{2}-\d{2}T[\d:.]+Z)?$/, 'Use an id returned by outlook_list_events or outlook_list_messages.').max(2048);
const messageId = z.string().regex(/^[A-Fa-f0-9]{2,2048}$/, 'Use an id returned by outlook_list_messages.');
const email = z.email('Use email addresses only, such as name@example.com.').max(320);
const recipients = z.array(email).max(20);
const line = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\r\n]/.test(value), 'Use one line.');

// Shown on approval cards in the owner's local time.
const local = (iso: string, allDay = false) => allDay
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  : new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function span(start: string, end: string, allDay: boolean): string {
  if (allDay) {
    const last = new Date(Date.parse(end + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);
    return last === start ? `${local(start, true)} (all day)` : `${local(start, true)} – ${local(last, true)} (all day)`;
  }
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  return `${local(start)} – ${sameDay ? new Date(end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : local(end)}`;
}
const RESPONSES = ['none', 'organizer', 'tentative', 'accepted', 'declined', 'not responded'];
const response = (code: number) => RESPONSES[code] ?? 'unknown';
const ATTENDEE = ['', 'required', 'optional', 'resource'];
const IMPORTANCE = ['low', 'normal', 'high'];
const person = (p: { name: string; email: string }) => p.name && p.email && p.name !== p.email ? `${p.name} <${p.email}>` : p.email || p.name;

const domain = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();
/** Addresses outside the sending account's domain (subdomains count as inside). */
export function hyperBotsOutside(addresses: string[], own: string): string[] {
  const home = domain(own);
  return addresses.filter(address => { if (!address.includes('@')) return false; const d = domain(address); return d !== home && !d.endsWith('.' + home); });
}
const row = (label: string, value: string, extra: Omit<HyperBotsCardRow, 'label' | 'value'> = {}): HyperBotsCardRow => ({ label, value, ...extra });
/** A card line mixing English with a title or name in any language stays left to right (LRM), and the inserted text is
 * isolated (FSI/PDI) so a Hebrew title keeps its own direction without flipping the line or moving its punctuation. */
const isolate = (text: string) => `\u2068${text}\u2069`;
const meetingRow = (subject: string, when: string) => row('Meeting', `\u200E"${isolate(subject)}", ${when}`);
function recipientRows(to: string[], cc: string[], own: string, label = 'To', ccLabel = 'Cc'): HyperBotsCardRow[] {
  const rows = [row(label, to.join(', '))];
  if (cc.length) rows.push(row(ccLabel, cc.join(', ')));
  const away = hyperBotsOutside([...to, ...cc], own);
  if (away.length) rows.push(row(`Outside ${domain(own)}`, away.join(', '), { tone: 'warning' }));
  return rows;
}
const fingerprint = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

type Account = { address: string; name: string };
async function account(bridge: HyperBotsOutlook): Promise<Account> {
  const found = await outlook(bridge, 'mail.account', undefined);
  if (!found.address.includes('@')) throw new HyperBotsToolError('refused', 'Outlook\'s default account has no email address, so nothing can be sent from it.');
  return found;
}
const fromRow = (a: Account) => row('From', a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address);

/** Re-read right before the call: it runs only if the account and item still match what the owner approved. */
type Prepared<X> = HyperBotsBinding & { card: HyperBotsCardRow[]; account: Account; extra: X };
function writeTool<A, X>(spec: {
  name: HyperBotsToolName; description: string; parameters: Record<string, unknown>; schema: z.ZodType<A>; delivery?: true;
  /** The items the call acts on: each must be one the bot was shown by an approved read (HyperBotsRuntime checks). */
  targets?(a: A): string[];
  summarize(a: A): string; prepare(a: A): Promise<Prepared<X>>; perform(a: A, p: Prepared<X>, delivery: HyperBotsDelivery): Promise<unknown>;
}): HyperBotsBoundTool {
  return {
    name: spec.name, access: 'write', description: spec.description, parameters: spec.parameters,
    parse: args => hyperBotsParseArgs(spec.schema, args),
    summarize: args => spec.summarize(args as A),
    ...(spec.targets ? { targets: (args: unknown) => spec.targets!(args as A) } : {}),
    async bind(args, signal) {
      signal.throwIfAborted();
      const p = await spec.prepare(args as A);
      return { destination: p.destination, fingerprint: p.fingerprint, card: p.card };
    },
    async run(args, signal, approved, options) {
      signal.throwIfAborted();
      // Only reads happen here, so whatever fails, nothing was written.
      let p: Prepared<X>;
      try { p = await spec.prepare(args as A); }
      catch (error) { throw new HyperBotsToolError('refused', `Could not check the call before sending it; nothing was sent. ${message(error)}`); }
      if (approved && p.fingerprint !== approved) throw new HyperBotsToolError('refused', 'What this call acts on changed after it was approved; nothing was sent.');
      const delivery = options?.delivery ?? null;
      if (spec.delivery && !delivery) throw new HyperBotsToolError('refused', 'Choose Send or Save to Drafts first; nothing was sent.');
      if (signal.aborted) throw new HyperBotsToolError('refused', 'Stopped before Outlook was asked; nothing was sent.');
      return spec.perform(args as A, p, delivery ?? 'send');
    },
  };
}
function readTool<A>(spec: { name: HyperBotsToolName; description: string; parameters: Record<string, unknown>; schema: z.ZodType<A>; binding: HyperBotsBinding; summarize(a: A): string; read(a: A): Promise<unknown> }): HyperBotsBoundTool {
  return {
    name: spec.name, access: 'read', description: spec.description, parameters: spec.parameters,
    parse: args => hyperBotsParseArgs(spec.schema, args),
    summarize: args => spec.summarize(args as A),
    // The owner's own Outlook on this PC: nothing about it can change between approval and the call.
    bind: async () => ({ ...spec.binding }),
    async run(args, signal) { signal.throwIfAborted(); return spec.read(args as A); },
  };
}

type OutlookEvent = z.output<(typeof HyperOutlookValues)['event.get']>;
/** Attendees other than the owner: Outlook lists the organizer as a recipient of their own meeting. */
const attendeesOf = (e: OutlookEvent, own: string) => e.attendeeCount - e.attendees.filter(p => p.email.toLowerCase() === own.toLowerCase()).length;
/**
 * Everyone who receives an event's update, other than the owner. An approval card must show them all, so a private
 * meeting (its attendees are hidden) or a list Outlook shortened is refused.
 */
function recipientsOf(e: OutlookEvent, own: string): string[] {
  const others = attendeesOf(e, own);
  if (others && e.isPrivate) throw new HyperBotsToolError('refused', 'This private meeting\'s attendees cannot be shown for approval; change it in Outlook.');
  if (e.attendeeCount > e.attendees.length) throw new HyperBotsToolError('refused', 'This meeting has too many attendees to show for approval; change it in Outlook.');
  return e.attendees.filter(p => p.email.toLowerCase() !== own.toLowerCase()).map(p => p.email || p.name);
}
/** "1 attendee", "3 attendees", or with `all` "all 3 attendees". */
const plural = (n: number, noun: string, all = false) => n === 1 ? `1 ${noun}` : `${all ? 'all ' : ''}${n} ${noun}s`;
/** A description that carries an online meeting's join details (Teams, Skype for Business). */
const ONLINE = /https:\/\/(?:teams\.microsoft\.com|teams\.live\.com|meet\.lync\.com|meet\.[^\s/]+\/)/i;
function eventOut(e: OutlookEvent, full: boolean) {
  return {
    id: e.id, subject: e.subject, start: e.start, end: e.end, allDay: e.allDay, location: e.location || null, organizer: e.organizer || null,
    isOrganizer: e.isOrganizer, myResponse: response(e.responseStatus), isRecurring: e.isRecurring, joinUrl: e.joinUrl, ...(e.isPrivate ? { private: true } : {}),
    ...(full
      ? { description: e.body, attendeeCount: e.attendeeCount, attendees: e.attendees.map(p => ({ name: p.name, email: p.email, type: ATTENDEE[p.type] || 'required', response: response(p.response) })) }
      : { attendees: e.attendees.slice(0, 20).map(person), ...(e.body.trim() ? { preview: clip(e.body.trim(), 300) } : {}) }),
  };
}

const ListArgs = z.strictObject({ start: instant, end: instant, max: z.number().int().min(1).max(50).default(20) })
  .refine(a => Date.parse(a.end) > Date.parse(a.start), '"end" must be after "start".')
  .refine(a => Date.parse(a.end) - Date.parse(a.start) <= 31 * DAY, 'The range must be at most 31 days.');
export function hyperBotsOutlookTool(bridge: HyperBotsOutlook): HyperBotsBoundTool {
  return readTool({
    name: 'outlook_list_events', binding: CALENDAR, schema: ListArgs,
    description: 'List events in the owner\'s classic Outlook calendar between two ISO datetimes (span up to 31 days), sorted by start. Each event has an id for the other Outlook tools.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['start', 'end'],
      properties: {
        start: { type: 'string', description: 'ISO 8601 start datetime, e.g. 2026-11-17T00:00:00 (local time unless an offset is given)' },
        end: { type: 'string', description: 'ISO 8601 end datetime, after start and at most 31 days later' },
        max: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum events (default 20)' },
      },
    },
    summarize: a => `Read Outlook calendar ${a.start.slice(0, 16)} to ${a.end.slice(0, 16)} UTC (up to ${a.max})`,
    async read(a) {
      const events = await outlook(bridge, 'list', { start: a.start, end: a.end });
      return [...events].sort((x, y) => Date.parse(x.start) - Date.parse(y.start)).slice(0, a.max).map(e => eventOut(e, false));
    },
  });
}

const GetArgs = z.strictObject({ id: eventId });
const MailListArgs = z.strictObject({
  folder: z.enum(['inbox', 'sent', 'drafts']).default('inbox'), unreadOnly: z.boolean().default(false), since: instant.optional(),
  from: z.string().trim().max(100).default(''), subject: z.string().trim().max(100).default(''), max: z.number().int().min(1).max(50).default(10),
});
const ReadArgs = z.strictObject({ id: messageId, maxChars: z.number().int().min(500).max(20000).default(8000) });
const SendArgs = z.strictObject({ to: recipients.min(1), cc: recipients.default([]), subject: line(255), body: z.string().trim().min(1).max(20000) })
  .refine(a => a.to.length + a.cc.length <= 20, 'At most 20 recipients.');
const ReplyArgs = z.strictObject({ id: messageId, body: z.string().trim().min(1).max(20000), replyAll: z.boolean().default(false) });
const ForwardArgs = z.strictObject({ id: messageId, to: recipients.min(1), cc: recipients.default([]), body: z.string().max(20000).default('') })
  .refine(a => a.to.length + a.cc.length <= 20, 'At most 20 recipients.');
const RespondArgs = z.strictObject({ id: eventId, response: z.enum(['accept', 'tentative', 'decline']), comment: z.string().max(8192).default(''), proposedStart: instant.optional(), proposedEnd: instant.optional() })
  .refine(a => !a.proposedStart === !a.proposedEnd, 'Give both proposedStart and proposedEnd, or neither.')
  .refine(a => !a.proposedStart || a.response !== 'accept', 'A new time can be proposed only with "tentative" or "decline", as in Outlook.')
  .refine(a => !a.proposedStart || Date.parse(a.proposedEnd!) > Date.parse(a.proposedStart), '"proposedEnd" must be after "proposedStart".');
const when = z.union([day, instant]);
const CreateArgs = z.strictObject({
  subject: line(255), start: when, end: when, allDay: z.boolean().default(false), location: z.string().max(2048).default(''), description: z.string().max(8192).default(''),
  attendees: z.array(email).max(50).default([]), onlineMeeting: z.enum(['teams', 'skype']).optional(),
}).refine(a => a.allDay ? a.start.length === 10 && a.end.length === 10 : a.start.length > 10 && a.end.length > 10, 'All-day events take dates (2026-11-17); other events take datetimes.')
  .refine(a => Date.parse(a.end) > Date.parse(a.start), '"end" must be after "start" (for all-day events, the day after the last day).');
const UpdateArgs = z.strictObject({ id: eventId, subject: line(255).optional(), start: when.optional(), end: when.optional(), location: z.string().max(2048).optional(), description: z.string().max(8192).optional() })
  .refine(a => a.subject !== undefined || a.start !== undefined || a.end !== undefined || a.location !== undefined || a.description !== undefined, 'Change at least one field.')
  .refine(a => !a.start || !a.end || Date.parse(a.end) > Date.parse(a.start), '"end" must be after "start".');
const ForwardEventArgs = z.strictObject({ id: eventId, to: recipients.min(1), comment: z.string().max(8192).default('') });

type MailSummary = z.output<(typeof HyperOutlookValues)['mail.list']>[number];
const mailOut = (m: MailSummary) => ({
  id: m.id, kind: m.kind, subject: m.subject, from: person(m.from), received: m.received, unread: m.unread, importance: IMPORTANCE[m.importance] ?? 'normal',
  hasAttachments: m.hasAttachments, ...(m.protected ? { protected: 'Private, confidential or encrypted: its text is not shared with bots.' } : { preview: m.preview }),
});
const target = (m: MailSummary) => `\u200E"${isolate(m.subject || '(no subject)')}" from ${isolate(person(m.from))}, ${local(m.received)}`;
const identity = (a: Account) => a.address.toLowerCase();
type Mail = z.output<(typeof HyperOutlookValues)['mail.read']>;

/** Every Outlook tool HyperBots offers. Bots get only the ones ticked for them in Bot settings. */
export function hyperBotsOutlookTools(bridge: HyperBotsOutlook): HyperBotsBoundTool[] {
  const header = (id: string) => outlook(bridge, 'mail.read', { id, maxChars: 0 });
  const event = (id: string) => outlook(bridge, 'event.get', { id });
  /** An answerable invitation, from a calendar event id or an invitation message id. */
  async function invitation(id: string): Promise<{ subject: string; when: string; organizer: string; key: unknown[]; expect: string }> {
    if (!id.includes('|')) {
      let mail: Mail | null = null;
      try { mail = await header(id); } catch (error) { if (error instanceof HyperBotsToolError && error.kind === 'transport') throw error; }
      if (mail) {
        if (mail.kind !== 'meeting_request') throw new HyperBotsToolError('refused', 'That message is not a meeting invitation.');
        if (!mail.meeting) throw new HyperBotsToolError('refused', 'This invitation is no longer in your calendar.');
        const meeting = mail.meeting, organizer = meeting.organizer || person(mail.from);
        return { subject: mail.subject, when: span(meeting.start, meeting.end, meeting.allDay), organizer, expect: meeting.lastModified,
          key: [mail.id, meeting.lastModified, meeting.start, meeting.end, organizer, meeting.responseStatus] };
      }
    }
    const e = await event(id);
    if (e.isOrganizer) throw new HyperBotsToolError('refused', 'The owner organizes this meeting, so there is no invitation to answer.');
    return { subject: e.subject, when: span(e.start, e.end, e.allDay), organizer: e.organizer, expect: e.lastModified, key: [e.id, e.lastModified] };
  }

  return [
    hyperBotsOutlookTool(bridge),
    readTool({
      name: 'outlook_get_event', binding: CALENDAR, schema: GetArgs,
      description: 'Read one event from the owner\'s Outlook calendar in full: description, every attendee with their response, join link. Use an id from outlook_list_events.',
      parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', description: 'Event id from outlook_list_events' } } },
      summarize: () => 'Read one Outlook event in full',
      read: async a => eventOut(await event(a.id), true),
    }),
    writeTool({
      name: 'outlook_create_event', schema: CreateArgs,
      description: 'Create an event in the owner\'s Outlook calendar. With attendees it is a meeting and Outlook sends the invitations. onlineMeeting adds a Teams or Skype for Business meeting link through the Outlook add-in (Skype only where Outlook has the Skype Meeting button). Requires owner approval.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['subject', 'start', 'end'],
        properties: {
          subject: { type: 'string', maxLength: 255, description: 'Title (one line)' },
          start: { type: 'string', description: 'ISO datetime, e.g. 2026-11-18T10:00:00 (local time unless an offset is given); a date for all-day events' },
          end: { type: 'string', description: 'ISO datetime after start; for all-day events the day after the last day' },
          allDay: { type: 'boolean', description: 'All-day event (default false)' },
          location: { type: 'string', maxLength: 2048 },
          description: { type: 'string', maxLength: 8192, description: 'Plain-text description or agenda' },
          attendees: { type: 'array', maxItems: 50, items: { type: 'string', format: 'email' }, description: 'Email addresses to invite' },
          onlineMeeting: { type: 'string', enum: ['teams', 'skype'], description: 'Add a Microsoft Teams or Skype for Business meeting' },
        },
      },
      summarize: a => `Create ${a.attendees.length ? 'meeting' : 'event'} "${a.subject}", ${span(a.start, a.end, a.allDay)}${a.onlineMeeting === 'teams' ? ' with Teams' : a.onlineMeeting === 'skype' ? ' with Skype' : ''}${a.attendees.length ? `, inviting ${a.attendees.length}` : ''}`,
      async prepare(a) {
        const from = await account(bridge);
        const card = [row('Organizer', fromRow(from).value), row('Title', a.subject), row('When', span(a.start, a.end, a.allDay))];
        if (a.location) card.push(row('Location', a.location));
        if (a.onlineMeeting) card.push(row('Online meeting', a.onlineMeeting === 'teams' ? 'Microsoft Teams' : 'Skype for Business'));
        if (a.attendees.length) card.push(...recipientRows(a.attendees, [], from.address, 'Invites'));
        if (a.description) card.push(row('Description', a.description, { long: true }));
        const destination = `Outlook calendar as ${from.address} on this PC${a.attendees.length ? `; Outlook sends ${plural(a.attendees.length, 'invitation')}` : ''}`;
        return { destination, fingerprint: fingerprint(['create', identity(from)]), card, account: from, extra: null };
      },
      async perform(a, p) {
        const created = await outlook(bridge, 'create', {
          subject: a.subject, start: a.start, end: a.end, allDay: a.allDay, location: a.location, body: a.description,
          attendees: a.attendees, send: a.attendees.length > 0, onlineMeeting: a.onlineMeeting ?? null, account: p.account.address,
        });
        return { id: created.id, subject: created.subject, start: created.start, end: created.end, joinUrl: created.joinUrl, invited: a.attendees };
      },
    }),
    writeTool({
      name: 'outlook_update_event', schema: UpdateArgs,
      targets: a => [a.id],
      description: 'Edit a meeting or appointment the owner organizes: title, time, location or description. Give only the fields that change (the description replaces the whole text and loses its formatting, so leave it out unless it must change). Outlook sends the update to its attendees. Requires owner approval.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['id'],
        properties: {
          id: { type: 'string', description: 'Event id from outlook_list_events' },
          subject: { type: 'string', maxLength: 255 }, start: { type: 'string', description: 'New ISO start (a date for all-day events)' }, end: { type: 'string', description: 'New ISO end' },
          location: { type: 'string', maxLength: 2048 }, description: { type: 'string', maxLength: 8192, description: 'Replaces the whole description' },
        },
      },
      summarize: a => `Edit an Outlook meeting: ${['subject', 'start', 'end', 'location', 'description'].filter(k => a[k as keyof typeof a] !== undefined).join(', ')}`,
      async prepare(a) {
        const [from, e] = await Promise.all([account(bridge), event(a.id)]);
        if (!e.isOrganizer) throw new HyperBotsToolError('refused', 'Only the organizer can edit this meeting; answer the invitation instead.');
        for (const value of [a.start, a.end]) if (value && (value.length === 10) !== e.allDay) throw new HyperBotsToolError('args', e.allDay ? 'This is an all-day event: give dates such as 2026-11-17.' : 'Give datetimes such as 2026-11-17T09:00:00.');
        // Only real changes are written and shown: rewriting an unchanged description would flatten its formatting (a Teams block).
        // Models often resend the description they saw: the whole text, or exactly the preview outlook_list_events gave.
        // Anything else, a shortened text included, is a change.
        const flat = (value: string) => value.replace(/\s+/g, ' ').trim();
        const kept = a.description !== undefined && [flat(e.body), flat(clip(e.body.trim(), 300))].includes(flat(a.description));
        const same = (x: string, y: string) => x.length === 10 ? x === y : Date.parse(x) === Date.parse(y);
        const patch: { subject?: string; start?: string; end?: string; location?: string; body?: string } = {};
        if (a.subject !== undefined && a.subject !== e.subject) patch.subject = a.subject;
        if (a.start !== undefined && !same(a.start, e.start)) patch.start = a.start;
        if (a.end !== undefined && !same(a.end, e.end)) patch.end = a.end;
        if (a.location !== undefined && a.location !== e.location) patch.location = a.location;
        if (a.description !== undefined && !kept) patch.body = a.description;
        if (!Object.keys(patch).length) throw new HyperBotsToolError('args', 'Nothing would change: every given field already has that value.');
        if (patch.body !== undefined && (e.joinUrl || ONLINE.test(e.body))) throw new HyperBotsToolError('args', 'This event\'s description holds its online meeting join details, which a new description would remove. Call outlook_update_event again without the description field (the owner can edit the description in Outlook).');
        const card = [meetingRow(e.subject, span(e.start, e.end, e.allDay))];
        if (patch.subject !== undefined) card.push(row('New title', patch.subject));
        if (patch.start !== undefined || patch.end !== undefined) card.push(row('New time', span(patch.start ?? e.start, patch.end ?? e.end, e.allDay)));
        if (patch.location !== undefined) card.push(row('New location', patch.location || '(none)'));
        if (patch.body !== undefined) card.push(row('New description', patch.body || '(empty)', { long: true }));
        const invited = recipientsOf(e, from.address);
        if (invited.length) card.push(...recipientRows(invited, [], from.address, 'Update goes to'));
        return { destination: `Outlook calendar as ${from.address} on this PC`, fingerprint: fingerprint(['update', identity(from), e.id, e.lastModified, patch]), card, account: from, extra: { lastModified: e.lastModified, patch } };
      },
      async perform(a, p) {
        const updated = await outlook(bridge, 'update', { id: a.id, expectedLastModified: p.extra.lastModified, patch: p.extra.patch, send: true, account: p.account.address });
        return { id: updated.id, subject: updated.subject, start: updated.start, end: updated.end, updateSentTo: attendeesOf(updated, p.account.address) };
      },
    }),
    writeTool({
      name: 'outlook_forward_event', schema: ForwardEventArgs,
      targets: a => [a.id],
      description: 'Forward a meeting to more people. If the owner organizes it, they are added as attendees and the update goes to everyone; otherwise the original invitation is forwarded (comment is used only then). Requires owner approval.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['id', 'to'],
        properties: {
          id: { type: 'string', description: 'Event id from outlook_list_events' },
          to: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', format: 'email' } },
          comment: { type: 'string', maxLength: 8192, description: 'A note above the forwarded invitation' },
        },
      },
      summarize: a => `Forward an Outlook meeting to ${a.to.join(', ')}`,
      async prepare(a) {
        const [from, e] = await Promise.all([account(bridge), event(a.id)]);
        const existing = e.isOrganizer ? recipientsOf(e, from.address) : [];
        const card = [fromRow(from), meetingRow(e.subject, span(e.start, e.end, e.allDay)),
          row('How', e.isOrganizer ? `You organize it: adds them as attendees and sends the updated meeting to ${plural(existing.length + a.to.length, 'attendee', true)}.`
            : `Forwards the invitation you received${e.isRecurring ? ' (the whole series)' : ''}; Exchange tells the organizer.`),
          ...(e.isOrganizer ? recipientRows(a.to, existing, from.address, 'Adds', 'Update also goes to') : recipientRows(a.to, [], from.address))];
        if (a.comment && !e.isOrganizer) card.push(row('Comment', a.comment, { long: true }));
        return { destination: `Outlook as ${from.address} on this PC`, fingerprint: fingerprint(['forward-event', identity(from), e.id, e.lastModified]), card, account: from, extra: e.lastModified };
      },
      async perform(a, p) {
        const sent = await outlook(bridge, 'event.forward', { id: a.id, to: a.to, comment: a.comment, account: p.account.address, expect: p.extra });
        return { forwarded: sent.mode === 'organizer' ? 'added as attendees; update sent' : 'invitation forwarded', to: sent.to };
      },
    }),
    readTool({
      name: 'outlook_list_messages', binding: MAIL, schema: MailListArgs,
      description: 'List messages in the owner\'s Outlook Inbox, Sent Items or Drafts, newest first: sender, subject, time, a short preview and an id for the other tools. Reading never marks mail as read.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          folder: { type: 'string', enum: ['inbox', 'sent', 'drafts'], description: 'Default inbox' },
          unreadOnly: { type: 'boolean', description: 'Only unread messages (default false)' },
          since: { type: 'string', description: 'Only messages received after this ISO datetime' },
          from: { type: 'string', maxLength: 100, description: 'Sender name or address contains this text' },
          subject: { type: 'string', maxLength: 100, description: 'Subject contains this text' },
          max: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum messages (default 10)' },
        },
      },
      summarize: a => `List Outlook ${a.folder}${a.unreadOnly ? ' (unread)' : ''}${a.from ? ` from "${a.from}"` : ''}${a.subject ? ` about "${a.subject}"` : ''}${a.since ? ` since ${a.since.slice(0, 16)} UTC` : ''} (up to ${a.max})`,
      async read(a) {
        const list = await outlook(bridge, 'mail.list', { folder: a.folder, unreadOnly: a.unreadOnly, since: a.since ?? null, from: a.from, subject: a.subject, max: a.max });
        return list.map(mailOut);
      },
    }),
    readTool({
      name: 'outlook_read_message', binding: MAIL, schema: ReadArgs,
      description: 'Read one Outlook message in full: plain-text body, recipients, attachment names, and the meeting details when it is an invitation. Does not mark it as read. Use an id from outlook_list_messages.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['id'],
        properties: { id: { type: 'string', description: 'Message id from outlook_list_messages' }, maxChars: { type: 'integer', minimum: 500, maximum: 20000, description: 'Body length limit (default 8000)' } },
      },
      summarize: () => 'Read one Outlook message',
      async read(a) {
        const m = await outlook(bridge, 'mail.read', { id: a.id, maxChars: a.maxChars });
        const replyTo = m.replyTo.map(person).filter(x => x !== person(m.from));
        return {
          ...mailOut(m), preview: undefined, to: m.to.map(person), cc: m.cc.map(person), ...(m.toCount + m.ccCount > m.to.length + m.cc.length ? { recipientCount: m.toCount + m.ccCount } : {}),
          ...(replyTo.length ? { replyTo } : {}), ...(m.protected ? {} : { body: m.body, ...(m.bodyTruncated ? { bodyTruncated: true } : {}) }),
          attachments: m.attachments,
          ...(m.meeting ? { meeting: { start: m.meeting.start, end: m.meeting.end, allDay: m.meeting.allDay, location: m.meeting.location || null, organizer: m.meeting.organizer, myResponse: response(m.meeting.responseStatus), isRecurring: m.meeting.isRecurring, eventId: m.meeting.eventId } } : {}),
        };
      },
    }),
    writeTool({
      name: 'outlook_send_message', schema: SendArgs, delivery: true,
      description: 'Write a new plain-text email from the owner\'s Outlook account. The owner approves it and chooses Send or Save to Drafts. Email addresses only; no attachments.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['to', 'subject', 'body'],
        properties: {
          to: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', format: 'email' } },
          cc: { type: 'array', maxItems: 20, items: { type: 'string', format: 'email' } },
          subject: { type: 'string', maxLength: 255, description: 'One line' },
          body: { type: 'string', maxLength: 20000, description: 'Plain text' },
        },
      },
      summarize: a => `Email ${a.to.join(', ')}: "${a.subject}"`,
      async prepare(a) {
        const from = await account(bridge);
        const card = [fromRow(from), ...recipientRows(a.to, a.cc, from.address), row('Subject', a.subject), row('Message', a.body, { long: true })];
        return { destination: `Outlook mail as ${from.address} on this PC`, fingerprint: fingerprint(['send', identity(from)]), card, account: from, extra: null };
      },
      async perform(a, p, delivery) {
        const done = await outlook(bridge, 'mail.send', { to: a.to, cc: a.cc, subject: a.subject, body: a.body, delivery, account: p.account.address });
        return { result: delivery === 'draft' ? 'Saved in Outlook Drafts; the owner will send it from Outlook.' : 'Sent.', ...done };
      },
    }),
    writeTool({
      name: 'outlook_reply_message', schema: ReplyArgs, delivery: true,
      targets: a => [a.id],
      description: 'Reply (or reply all) to an Outlook message. Your plain text goes above the quoted original. The owner approves it and chooses Send or Save to Drafts.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['id', 'body'],
        properties: { id: { type: 'string', description: 'Message id from outlook_list_messages' }, body: { type: 'string', maxLength: 20000, description: 'Plain-text reply' }, replyAll: { type: 'boolean', description: 'Reply to everyone (default false)' } },
      },
      summarize: a => a.replyAll ? 'Reply all to an Outlook message' : 'Reply to an Outlook message',
      async prepare(a) {
        // The recipients are the ones Outlook's own Reply / Reply All gives (Reply-To included), and the reply is sent only to them.
        const [from, m, to] = await Promise.all([account(bridge), header(a.id), outlook(bridge, 'mail.recipients', { id: a.id, replyAll: a.replyAll })]);
        if (!m.version) throw new HyperBotsToolError('refused', UNREADABLE);
        const card = [fromRow(from), row(a.replyAll ? 'Reply all to' : 'Reply to', target(m)), ...recipientRows(to.to, to.cc, from.address), row('Message', a.body, { long: true })];
        const recipients = [...to.to, ...to.cc].map(x => x.toLowerCase()).sort();
        return { destination: `Outlook mail as ${from.address} on this PC`, fingerprint: fingerprint(['reply', identity(from), m.id, m.version, a.replyAll, recipients]), card, account: from, extra: { expect: [...to.to, ...to.cc], version: m.version } };
      },
      async perform(a, p, delivery) {
        const done = await outlook(bridge, 'mail.reply', { id: a.id, replyAll: a.replyAll, body: a.body, delivery, account: p.account.address, expect: p.extra.expect, version: p.extra.version });
        return { result: delivery === 'draft' ? 'Saved in Outlook Drafts; the owner will send it from Outlook.' : 'Sent.', ...done };
      },
    }),
    writeTool({
      name: 'outlook_forward_message', schema: ForwardArgs, delivery: true,
      targets: a => [a.id],
      description: 'Forward an Outlook message (with its attachments) to new recipients, with an optional note above it. Forwarding an invitation forwards the meeting. The owner approves it and chooses Send or Save to Drafts.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['id', 'to'],
        properties: {
          id: { type: 'string', description: 'Message id from outlook_list_messages' },
          to: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', format: 'email' } },
          cc: { type: 'array', maxItems: 20, items: { type: 'string', format: 'email' } },
          body: { type: 'string', maxLength: 20000, description: 'Plain-text note above the forwarded message' },
        },
      },
      summarize: a => `Forward an Outlook message to ${a.to.join(', ')}`,
      async prepare(a) {
        const [from, m] = await Promise.all([account(bridge), header(a.id)]);
        if (!m.version) throw new HyperBotsToolError('refused', UNREADABLE);
        const card = [fromRow(from), row(m.kind === 'meeting_request' ? 'Forwarding invitation' : 'Forwarding', target(m)), ...recipientRows(a.to, a.cc, from.address)];
        if (m.hasAttachments) card.push(row('Attachments', 'Its attachments are forwarded too', { tone: 'warning' }));
        if (a.body) card.push(row('Note', a.body, { long: true }));
        return { destination: `Outlook mail as ${from.address} on this PC`, fingerprint: fingerprint(['forward', identity(from), m.id, m.version]), card, account: from, extra: m.version };
      },
      async perform(a, p, delivery) {
        const done = await outlook(bridge, 'mail.forward', { id: a.id, to: a.to, cc: a.cc, body: a.body, delivery, account: p.account.address, version: p.extra });
        return { result: delivery === 'draft' ? 'Saved in Outlook Drafts; the owner will send it from Outlook.' : 'Sent.', ...done };
      },
    }),
    writeTool({
      name: 'outlook_respond_meeting', schema: RespondArgs, delivery: true,
      targets: a => [a.id],
      description: 'Answer a meeting invitation: accept, tentative or decline, with an optional comment. With tentative or decline you may propose a new time (proposedStart and proposedEnd). Takes an invitation message id (outlook_list_messages) or a calendar event id (outlook_list_events). The owner approves it and chooses Send or Save to Drafts.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['id', 'response'],
        properties: {
          id: { type: 'string', description: 'Invitation message id or calendar event id' },
          response: { type: 'string', enum: ['accept', 'tentative', 'decline'] },
          comment: { type: 'string', maxLength: 8192, description: 'Plain-text note to the organizer' },
          proposedStart: { type: 'string', description: 'Proposed new start, ISO datetime (tentative or decline only)' },
          proposedEnd: { type: 'string', description: 'Proposed new end, ISO datetime' },
        },
      },
      summarize: a => `${a.response === 'accept' ? 'Accept' : a.response === 'tentative' ? 'Tentatively accept' : 'Decline'} a meeting invitation${a.proposedStart ? ' and propose a new time' : ''}`,
      async prepare(a) {
        const [from, m] = await Promise.all([account(bridge), invitation(a.id)]);
        const answer = a.response === 'accept' ? 'Accept' : a.response === 'tentative' ? 'Tentative' : 'Decline';
        const card = [fromRow(from), meetingRow(m.subject, m.when), row('Organizer', m.organizer), row('Answer', answer)];
        if (a.proposedStart && a.proposedEnd) card.push(row('Proposed new time', span(a.proposedStart, a.proposedEnd, false)));
        if (a.comment) card.push(row('Comment', a.comment, { long: true }));
        return { destination: `Outlook as ${from.address} on this PC`, fingerprint: fingerprint(['respond', identity(from), ...m.key]), card, account: from, extra: m.expect };
      },
      async perform(a, p, delivery) {
        const done = await outlook(bridge, 'meeting.respond', {
          id: a.id, response: a.response, comment: a.comment, delivery, account: p.account.address, expect: p.extra,
          proposed: a.proposedStart && a.proposedEnd ? { start: a.proposedStart, end: a.proposedEnd } : null,
        });
        return { result: delivery === 'draft' ? 'The answer is saved in Outlook Drafts; the owner will send it.' : 'Answer sent to the organizer.', ...done };
      },
    }),
  ];
}
