import { z } from 'zod';
const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();
const dateTime = z.union([instant, date]);
const id = z.string().regex(/^[A-Fa-f0-9]+(?:\|\d{4}-\d{2}-\d{2}T[\d:.]+Z)?$/).max(2048);
const fields = z.strictObject({ subject: z.string().trim().min(1).max(255), start: dateTime, end: dateTime, allDay: z.boolean(), location: z.string().max(2048), body: z.string().max(8192) });
function dates(value: { start: string; end: string; allDay?: boolean }) {
  return Date.parse(value.end) > Date.parse(value.start) && (value.allDay === undefined || (value.allDay ? value.start.length === 10 && value.end.length === 10 : value.start.length > 10 && value.end.length > 10));
}
export const HyperPersonSchema = z.strictObject({ name: z.string().max(512), email: z.email().max(320), title: z.string().max(1024), department: z.string().max(1024), phone: z.string().max(256), office: z.string().max(1024), company: z.string().max(1024), photo: z.string().regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/).max(90000).optional(), source: z.enum(['ad', 'outlook']) });
export const HyperOutlookArgs = {
  'people.search': z.strictObject({ query: z.string().trim().min(2, 'Type at least two characters.').max(128), limit: z.number().int().min(1).max(20).default(20) }),
  'people.lookup': z.strictObject({ email: z.email().max(320) }),
  status: z.undefined(),
  list: z.strictObject({ start: instant, end: instant }).refine(value => dates(value) && Date.parse(value.end) - Date.parse(value.start) <= 740 * 86400000, 'Choose a calendar range of at most two years.'),
  create: fields.extend({ attendees: z.array(z.email().max(320)).max(200), send: z.boolean() }).refine(dates, 'End must be after start.').refine(value => !value.attendees.length || value.send, 'Confirm sending to attendees first.'),
  update: z.strictObject({ id, expectedLastModified: instant, patch: fields.partial().refine(value => Object.keys(value).length > 0).refine(value => !value.start || !value.end || dates(value as { start: string; end: string; allDay?: boolean }), 'End must be after start.'), send: z.boolean() }),
  delete: z.strictObject({ id, send: z.boolean() }),
  respond: z.strictObject({ id, response: z.enum(['accept', 'tentative', 'decline']), send: z.boolean() }),
  open: z.strictObject({ id }),
};
export const HyperOutlookEventSchema = fields.extend({
  id, organizer: z.string(), isOrganizer: z.boolean(), responseStatus: z.number().int(),
  attendees: z.array(z.strictObject({ name: z.string(), email: z.string(), type: z.number().int(), response: z.number().int() })).max(200), attendeeCount: z.number().int().nonnegative(),
  busyStatus: z.number().int(), isRecurring: z.boolean(), recurrenceState: z.number().int(), isCancelled: z.boolean(), isPrivate: z.boolean(), joinUrl: z.string().url().nullable(), lastModified: instant,
});
export const HyperOutlookValues = {
  'people.search': z.array(HyperPersonSchema).max(20),
  'people.lookup': HyperPersonSchema.nullable(),
  status: z.strictObject({ available: z.boolean(), userName: z.string(), email: z.string(), reason: z.string().optional() }),
  list: z.array(HyperOutlookEventSchema).max(2000), create: HyperOutlookEventSchema, update: HyperOutlookEventSchema,
  delete: z.null(), respond: z.null(), open: z.null(),
};
export type HyperOutlookOp = keyof typeof HyperOutlookArgs;
export const HyperOutlookReply = z.discriminatedUnion('ok', [
  z.strictObject({ id: z.string(), ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ id: z.string(), ok: z.literal(false), kind: z.enum(['format', 'state', 'unsupported', 'other', 'conflict']), message: z.string() }),
]);
