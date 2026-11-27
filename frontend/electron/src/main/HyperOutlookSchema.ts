import { z } from 'zod';
import { HyperOutlookColorIds } from '@shared/HyperOutlookColor';
const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();
const dateTime = z.union([instant, date]);
const id = z.string().regex(/^[A-Fa-f0-9]+(?:\|\d{4}-\d{2}-\d{2}T[\d:.]+Z)?$/).max(2048);
// A mail or meeting message: an Outlook EntryID in the default store.
const entry = z.string().regex(/^[A-Fa-f0-9]{2,2048}$/);
const email = z.email().max(320);
const recipients = z.array(email).max(20);
const delivery = z.enum(['send', 'draft']);
// A message's content hash (HyperOutlookScript Hyper-MailVersion): a reply or forward is approved for this content only.
const version = z.string().regex(/^[0-9A-F]{64}$/);
const content = z.strictObject({ subject: z.string().trim().min(1).max(255), start: dateTime, end: dateTime, allDay: z.boolean(), location: z.string().max(2048), body: z.string().max(8192) });
// Colour is an id from HyperOutlookColors; null clears it. The bridge turns it into the Outlook category write.
const fields = content.extend({ color: z.enum(HyperOutlookColorIds).nullable().optional() });
function dates(value: { start: string; end: string; allDay?: boolean }) {
  return Date.parse(value.end) > Date.parse(value.start) && (value.allDay === undefined || (value.allDay ? value.start.length === 10 && value.end.length === 10 : value.start.length > 10 && value.end.length > 10));
}
const fewRecipients = (value: { to: string[]; cc: string[] }) => value.to.length + value.cc.length <= 20;
export const HyperPersonSchema = z.strictObject({ name: z.string().max(512), email: z.email().max(320), title: z.string().max(1024), department: z.string().max(1024), phone: z.string().max(256), office: z.string().max(1024), company: z.string().max(1024), photo: z.string().regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/).max(90000).optional(), source: z.enum(['ad', 'outlook']) });
const hubFolder = z.enum(['inbox', 'sent']);
const mailTarget = z.strictObject({ storeId: entry, entryId: entry, folder: hubFolder });
const mailCursor = z.strictObject({ modified: instant, entryId: entry });
const mailDate = instant.nullish().catch(null).transform(v => v && +v.slice(0, 4) > 1601 && +v.slice(0, 4) < 4000 ? v : null);
const visibility = z.enum(['public', 'unknown']).catch('unknown');
const headerText = z.string().min(1).max(4096).nullish().catch(null);
export const HyperOutlookArgs = {
  'people.search': z.strictObject({ query: z.string().trim().min(2, 'Type at least two characters.').max(128), limit: z.number().int().min(1).max(20).default(20) }),
  'people.lookup': z.strictObject({ email: z.email().max(320) }),
  status: z.undefined(),
  'hub.mailHeaders': z.strictObject({ storeId: entry, folder: hubFolder, since: instant, activeFlags: z.boolean(),
    after: mailCursor.nullable(), limit: z.number().int().min(1).max(200) }),
  'hub.mailDetail': mailTarget.extend({ headerOnly: z.boolean() }),
  'mail.open': mailTarget,
  'hub.occurrence': z.strictObject({ storeId: entry, entryId: entry, originalStart: instant, start: instant, modified: instant, open: z.boolean() }),
  'calendar.resolve': z.strictObject({ storeId: entry, entryId: entry, originalStart: instant, start: instant }),
  'hub.store': z.strictObject({ storeId: entry }).optional(),
  'hub.calendar': z.strictObject({ storeId: entry, start: instant, end: instant, markers: z.boolean().optional(), seriesIds: z.array(z.string().min(1).max(4096)).max(2000).optional() }).refine(dates),
  list: z.strictObject({ start: instant, end: instant }).refine(value => dates(value) && Date.parse(value.end) - Date.parse(value.start) <= 740 * 86400000, 'Choose a calendar range of at most two years.'),
  // onlineMeeting presses the add-in's ribbon button on the new item; account sends invitations from that Outlook account only.
  create: fields.extend({ attendees: z.array(z.email().max(320)).max(200), send: z.boolean(), onlineMeeting: z.enum(['teams', 'skype']).nullable().optional(), account: email.optional() })
    .refine(dates, 'End must be after start.').refine(value => !value.attendees.length || value.send, 'Confirm sending to attendees first.'),
  // account: the approved sender (HyperBots); the meeting must already send from it.
  update: z.strictObject({ id, expectedLastModified: instant, account: email.optional(), patch: fields.partial().refine(value => Object.keys(value).length > 0).refine(value => !value.start || !value.end || dates(value as { start: string; end: string; allDay?: boolean }), 'End must be after start.'), send: z.boolean() }),
  delete: z.strictObject({ id, send: z.boolean() }),
  respond: z.strictObject({ id, response: z.enum(['accept', 'tentative', 'decline']), send: z.boolean() }),
  open: z.strictObject({ id }),
  // The ops below are for HyperBots in main only: HyperOutlookIpc gives them no renderer channel.
  'event.get': z.strictObject({ id }),
  'event.delete': z.strictObject({ id, send: z.boolean(), account: email, expect: instant }),
  'event.forward': z.strictObject({ id, to: recipients.min(1), comment: z.string().max(8192), account: email, expect: instant }),
  'mail.account': z.undefined(),
  // Filters are dates and booleans only; from/subject are matched in PowerShell, never put into an Outlook filter string.
  'mail.list': z.strictObject({ folder: z.enum(['inbox', 'sent', 'drafts']), unreadOnly: z.boolean(), since: instant.nullable(), from: z.string().max(200), subject: z.string().max(200), max: z.number().int().min(1).max(50) }),
  // maxChars 0 reads the header only (sender, recipients, reply-to): what an approval card shows.
  'mail.read': z.strictObject({ id: entry, maxChars: z.number().int().min(0).max(20000) }),
  'mail.deleteTarget': z.strictObject({ id: entry }),
  'mail.delete': z.strictObject({ id: entry, folder: entry, account: email, expect: instant }),
  'mail.send': z.strictObject({ to: recipients.min(1), cc: recipients, subject: z.string().trim().min(1).max(255).refine(value => !/[\r\n]/.test(value), 'The subject must be one line.'), body: z.string().max(20000), delivery, account: email }).refine(fewRecipients, 'At most 20 recipients.'),
  // The exact recipients Outlook's Reply / Reply All gives (Reply-To included): an unsaved reply, discarded at once.
  'mail.recipients': z.strictObject({ id: entry, replyAll: z.boolean() }),
  // expect: the recipients the owner approved; any other reply is discarded unsent.
  'mail.reply': z.strictObject({ id: entry, replyAll: z.boolean(), body: z.string().trim().min(1).max(20000), delivery, account: email, expect: z.array(z.string().max(1024)).max(50), version }),
  'mail.forward': z.strictObject({ id: entry, to: recipients.min(1), cc: recipients, body: z.string().max(20000), delivery, account: email, version }).refine(fewRecipients, 'At most 20 recipients.'),
  // id: a calendar event (from list/event.get) or an invitation message (from mail.list/mail.read).
  'meeting.respond': z.strictObject({ id, response: z.enum(['accept', 'tentative', 'decline']), comment: z.string().max(8192), proposed: z.strictObject({ start: instant, end: instant }).nullable(), delivery, account: email, expect: instant })
    .refine(value => !value.proposed || value.response !== 'accept', 'A new time can be proposed only with tentative or decline.')
    .refine(value => !value.proposed || Date.parse(value.proposed.end) > Date.parse(value.proposed.start), 'The proposed end must be after its start.'),
};
export const HyperOutlookEventSchema = content.extend({
  id, organizer: z.string(), isOrganizer: z.boolean(), responseStatus: z.number().int(),
  attendees: z.array(z.strictObject({ name: z.string(), email: z.string(), type: z.number().int(), response: z.number().int() })).max(200), attendeeCount: z.number().int().nonnegative(),
  busyStatus: z.number().int(), isRecurring: z.boolean(), recurrenceState: z.number().int(), isCancelled: z.boolean(), isPrivate: z.boolean(), joinUrl: z.string().url().nullable(), lastModified: instant,
  categories: z.array(z.string().max(255)).max(100),
});
const Address = z.strictObject({ name: z.string().max(1024), email: z.string().max(1024) });
/** `protected`: private, confidential, encrypted or rights-protected; the script then returns no text from it. */
export const HyperOutlookMailSummarySchema = z.strictObject({
  id: entry, kind: z.enum(['mail', 'meeting_request', 'meeting_cancellation', 'meeting_response', 'meeting_forward']), subject: z.string().max(4096), from: Address, received: instant,
  unread: z.boolean(), importance: z.number().int(), hasAttachments: z.boolean(), protected: z.boolean(), preview: z.string().max(400),
});
export const HyperOutlookMailSchema = HyperOutlookMailSummarySchema.extend({
  to: z.array(Address).max(50), toCount: z.number().int().nonnegative(), cc: z.array(Address).max(50), ccCount: z.number().int().nonnegative(), replyTo: z.array(Address).max(50),
  body: z.string().max(20000), bodyTruncated: z.boolean(), attachments: z.array(z.strictObject({ name: z.string().max(1024), size: z.number().int() })).max(50),
  meeting: z.strictObject({ start: dateTime, end: dateTime, allDay: z.boolean(), location: z.string().max(2048), organizer: z.string().max(1024), responseStatus: z.number().int(), isRecurring: z.boolean(), eventId: id.nullable(), lastModified: instant }).nullable(),
  // '' when Outlook could not read all of the message: a bot then cannot reply to or forward it.
  version: z.union([version, z.literal('')]),
});
const Delivered = z.strictObject({ delivery, subject: z.string().max(4096), to: z.array(z.string().max(1024)).max(200), cc: z.array(z.string().max(1024)).max(200) });
const hubInterval = { start: instant, end: instant };
const hubOccurrence = z.discriminatedUnion('private', [
  z.strictObject({ ...hubInterval, private: z.literal(true) }),
  z.strictObject({ ...hubInterval, private: z.literal(false), entryId: entry, originalStart: instant,
    marker: z.object({ attendeeCount: z.int().nonnegative(), categories: z.array(z.string()), responseStatus: z.number(), recurrenceState: z.number(), isOrganizer: z.boolean(), start: dateTime, end: dateTime, modified: instant }).optional(),
    title: z.string(), allDay: z.boolean(), availability: z.enum(['busy', 'tentative', 'oof', 'free', 'working-elsewhere']),
    isMeeting: z.boolean(), organizerIsOwner: z.boolean(),
    details: z.strictObject({ sensitivity: z.enum(['normal', 'personal']), modified: instant, excerpt: z.string().max(1024),
      organizer: z.string(), organizerEmail: z.string().nullish(), joinUrl: z.url().nullable(), attendees: z.array(z.strictObject({ name: z.string(), email: z.string() })).max(200),
      seriesId: z.string().optional() }).optional() }),
]);
export const HyperOutlookValues = {
  'people.search': z.array(HyperPersonSchema).max(20),
  'people.lookup': HyperPersonSchema.nullable(),
  status: z.strictObject({ available: z.boolean(), userName: z.string(), email: z.string(), reason: z.string().optional() }),
  'hub.mailHeaders': z.strictObject({ storeId: entry, exhausted: z.boolean(), complete: z.boolean(), replyCoverage: z.boolean(), excludedIds: z.array(entry), next: mailCursor.nullable(),
    headers: z.array(z.object({ visibility, entryId: entry, modified: instant, authoredAt: mailDate,
      authoredZone: z.string().regex(/^[+-](?:[01]\d|2[0-3]):[0-5]\d$/).nullish().catch(null), flag: z.enum(['active', 'complete', 'none', 'unknown']).catch('unknown'),
      flagStart: mailDate, flagDue: mailDate, flagCompleted: mailDate, conversationId: headerText, messageId: headerText, inReplyTo: headerText,
    })).max(200) }).refine(p => p.exhausted === (p.next === null)),
  'hub.mailDetail': z.object({ visibility, storeId: entry, entryId: entry, subject: z.string().max(4096), body: z.string().max(20000),
    bodyTruncated: z.boolean().default(false), ownerSender: z.boolean().nullish().catch(null), attachmentNames: z.array(z.string().max(1024)).max(50).default([]), to: z.array(z.string()).max(100), sender: z.string(), distributionList: z.boolean().nullable(), modified: instant,
  }).nullable().transform(detail => detail?.visibility === 'public' ? detail : null),
  'mail.open': z.null(),
  'hub.occurrence': z.null(),
  'calendar.resolve': HyperOutlookEventSchema,
  'hub.store': entry,
  'hub.calendar': z.strictObject({ storeId: entry, ...hubInterval, exhausted: z.boolean(), completeness: z.enum(['complete', 'partial']), events: z.array(hubOccurrence).max(2000) })
    .refine(read => read.exhausted || read.completeness === 'partial'),
  list: z.array(HyperOutlookEventSchema).max(2000), create: HyperOutlookEventSchema, update: HyperOutlookEventSchema,
  delete: z.null(), respond: z.null(), open: z.null(),
  'event.get': HyperOutlookEventSchema,
  'event.delete': z.null(),
  'event.forward': z.strictObject({ mode: z.enum(['organizer', 'invitation']), to: z.array(z.string().max(1024)).max(200) }),
  'mail.account': z.strictObject({ address: z.string().max(320), name: z.string().max(1024) }),
  'mail.list': z.array(HyperOutlookMailSummarySchema).max(50),
  'mail.read': HyperOutlookMailSchema,
  'mail.deleteTarget': z.strictObject({ subject: z.string().max(4096), from: Address, folder: entry, lastModified: instant }),
  'mail.delete': z.null(),
  'mail.recipients': z.strictObject({ to: z.array(z.string().max(1024)).max(50), cc: z.array(z.string().max(1024)).max(50) }),
  'mail.send': Delivered, 'mail.reply': Delivered, 'mail.forward': Delivered,
  'meeting.respond': z.strictObject({ delivery, response: z.enum(['accept', 'tentative', 'decline']), subject: z.string().max(4096) }),
};
export type HyperOutlookOp = keyof typeof HyperOutlookArgs;
export const HyperOutlookReply = z.discriminatedUnion('ok', [
  z.strictObject({ id: z.string(), ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ id: z.string(), ok: z.literal(false), kind: z.enum(['format', 'state', 'unsupported', 'other', 'conflict', 'unknown']), message: z.string() }),
]);
