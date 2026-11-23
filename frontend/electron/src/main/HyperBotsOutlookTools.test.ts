import { expect, it, vi } from 'vitest';
import { HyperBotsToolError } from './HyperBotsRuntime';
import { HyperOutlookLost } from './HyperOutlookBridge';
import { hyperBotsOutlookTools, hyperBotsOutside } from './HyperBotsOutlookTools';
import { SettingsError } from './settings-error';

// Regression tests with a fake bridge. Real behaviour is checked in the HyperTask app against real Outlook.
const signal = new AbortController().signal;
const ID = 'AB12';
const account = { address: 'nave@corp.example', name: 'Nave' };
const mail = (extra: object = {}) => ({
  id: ID, kind: 'mail', subject: 'Budget', from: { name: 'Dana', email: 'dana@corp.example' }, received: '2026-11-17T07:00:00.000Z', unread: true, importance: 1,
  hasAttachments: true, protected: false, preview: 'Hello', to: [{ name: 'Nave', email: 'nave@corp.example' }, { name: 'Lee', email: 'lee@corp.example' }], toCount: 2,
  cc: [{ name: 'Out', email: 'out@vendor.example' }], ccCount: 1, replyTo: [], body: '', bodyTruncated: false, attachments: [], meeting: null, version: 'A'.repeat(64), ...extra,
});
const event = (extra: object = {}) => ({
  id: 'CD34', subject: 'Sync', start: '2026-11-18T08:00:00.000Z', end: '2026-11-18T08:30:00.000Z', allDay: false, location: '', body: 'Agenda',
  organizer: 'Nave', isOrganizer: true, responseStatus: 1, attendees: [{ name: 'Lee', email: 'lee@corp.example', type: 1, response: 3 }], attendeeCount: 1,
  busyStatus: 2, isRecurring: false, recurrenceState: 0, isCancelled: false, isPrivate: false, joinUrl: null, lastModified: '2026-11-17T06:00:00.000Z', ...extra,
});
function setup(over: Record<string, (args: any) => unknown> = {}) {
  const ops: Record<string, (args: any) => unknown> = {
    'mail.account': () => account, 'mail.read': () => mail(), 'event.get': () => event(), list: () => [event()],
    'mail.list': () => [mail(), mail({ id: 'EF56', protected: true, preview: '' })],
    'mail.send': a => ({ delivery: a.delivery, subject: a.subject, to: a.to, cc: a.cc }), 'mail.reply': a => ({ delivery: a.delivery, subject: 'RE: Budget', to: ['dana@corp.example'], cc: [] }),
    'mail.forward': a => ({ delivery: a.delivery, subject: 'FW: Budget', to: a.to, cc: a.cc }), 'meeting.respond': a => ({ delivery: a.delivery, response: a.response, subject: 'Sync' }),
    create: a => event({ subject: a.subject }), update: () => event({ subject: 'Moved' }), 'event.forward': a => ({ mode: 'organizer', to: a.to }), ...over,
  };
  const request = vi.fn(async (op: string, args: unknown) => ops[op]!(args));
  const tools = Object.fromEntries(hyperBotsOutlookTools({ request } as never).map(tool => [tool.name, tool]));
  return { request, tools, tool: (name: string) => tools[name]! };
}
const failsWith = async (run: Promise<unknown>, kind: string, pattern?: RegExp) => {
  const error = await run.then(() => null, e => e);
  expect(error).toBeInstanceOf(HyperBotsToolError);
  expect((error as HyperBotsToolError).kind).toBe(kind);
  if (pattern) expect((error as Error).message).toMatch(pattern);
};

it('offers every Outlook tool once, reads as reads and writes as writes', () => {
  const { tools } = setup();
  expect(Object.keys(tools).sort()).toEqual(['outlook_create_event', 'outlook_forward_event', 'outlook_forward_message', 'outlook_get_event', 'outlook_list_events',
    'outlook_list_messages', 'outlook_read_message', 'outlook_reply_message', 'outlook_respond_meeting', 'outlook_search_people', 'outlook_send_message', 'outlook_update_event']);
  for (const name of ['outlook_list_events', 'outlook_get_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people']) expect(tools[name]!.access).toBe('read');
  expect(Object.values(tools).filter(tool => tool.access === 'write')).toHaveLength(7);
});

it('flags only addresses outside the sender domain; subdomains are inside', () => {
  expect(hyperBotsOutside(['a@corp.example', 'b@mail.corp.example', 'c@vendor.example', 'Dana'], 'nave@corp.example')).toEqual(['c@vendor.example']);
});

it('mail reads: list hides the text of protected mail, read never asks for more than allowed', async () => {
  const { request, tool } = setup();
  const list = tool('outlook_list_messages');
  expect(await list.bind!({}, signal)).toEqual({ destination: 'Outlook mail on this PC', fingerprint: 'outlook:local-mail' });
  const rows = await list.run(list.parse({ unreadOnly: true, from: 'dana' }), signal) as any[];
  expect(request).toHaveBeenCalledWith('mail.list', { folder: 'inbox', unreadOnly: true, since: null, from: 'dana', subject: '', max: 10 });
  expect(rows[0]).toMatchObject({ id: ID, from: 'Dana <dana@corp.example>', importance: 'normal', preview: 'Hello' });
  expect(rows[1]).not.toHaveProperty('preview');
  expect(rows[1].protected).toMatch(/not shared/);
  for (const bad of [{ folder: 'archive' }, { max: 51 }, { extra: 1 }]) expect(() => list.parse(bad)).toThrow(HyperBotsToolError);
  const read = tool('outlook_read_message');
  expect(() => read.parse({ id: 'not-hex' })).toThrow(HyperBotsToolError);
  expect(() => read.parse({ id: ID, maxChars: 30000 })).toThrow(HyperBotsToolError);
  await read.run(read.parse({ id: ID }), signal);
  expect(request).toHaveBeenLastCalledWith('mail.read', { id: ID, maxChars: 8000 });
});

it('send: the card shows sender, recipients with outsiders flagged and the text; the run needs a delivery and the approved sender', async () => {
  const { request, tool } = setup();
  const send = tool('outlook_send_message');
  expect(() => send.parse({ to: ['Dana'], subject: 'x', body: 'y' })).toThrow(HyperBotsToolError);
  expect(() => send.parse({ to: ['a@corp.example'], subject: 'two\nlines', body: 'y' })).toThrow(HyperBotsToolError);
  expect(() => send.parse({ to: Array.from({ length: 15 }, (_, i) => `a${i}@corp.example`), cc: Array.from({ length: 6 }, (_, i) => `c${i}@corp.example`), subject: 'x', body: 'y' })).toThrow(/20 recipients/);
  const args = send.parse({ to: ['lee@corp.example'], cc: ['out@vendor.example'], subject: 'Plan', body: 'שלום\nHi' });
  const bound = await send.bind!(args, signal);
  expect(bound.destination).toBe('Outlook mail as nave@corp.example on this PC');
  expect(bound.card).toEqual([
    { label: 'From', value: 'Nave <nave@corp.example>' }, { label: 'To', value: 'lee@corp.example' }, { label: 'Cc', value: 'out@vendor.example' },
    { label: 'Outside corp.example', value: 'out@vendor.example', tone: 'warning' }, { label: 'Subject', value: 'Plan' }, { label: 'Message', value: 'שלום\nHi', long: true },
  ]);
  await failsWith(send.run(args, signal, bound.fingerprint, { delivery: null }), 'refused', /Send or Save to Drafts/);
  expect(request).not.toHaveBeenCalledWith('mail.send', expect.anything());
  expect(await send.run(args, signal, bound.fingerprint, { delivery: 'draft' })).toMatchObject({ result: expect.stringMatching(/Drafts/), delivery: 'draft' });
  expect(request).toHaveBeenLastCalledWith('mail.send', { to: ['lee@corp.example'], cc: ['out@vendor.example'], subject: 'Plan', body: 'שלום\nHi', delivery: 'draft', account: 'nave@corp.example' });
  // Another default account after approval: nothing is sent.
  const other = setup({ 'mail.account': () => ({ address: 'other@corp.example', name: 'Other' }) }).tool('outlook_send_message');
  await failsWith(other.run(args, signal, bound.fingerprint, { delivery: 'send' }), 'refused', /changed after it was approved/);
});

it('a lost Outlook request is an unknown outcome; an Outlook refusal is final', async () => {
  const lost = setup({ 'mail.send': () => { throw new HyperOutlookLost('Outlook timed out.'); } }).tool('outlook_send_message');
  const args = lost.parse({ to: ['lee@corp.example'], subject: 'x', body: 'y' });
  const { fingerprint } = await lost.bind!(args, signal);
  await failsWith(lost.run(args, signal, fingerprint, { delivery: 'send' }), 'transport', /timed out/);
  const refused = setup({ 'mail.send': () => { throw new SettingsError('state', 'A recipient could not be resolved in Outlook; nothing was sent.'); } }).tool('outlook_send_message');
  await failsWith(refused.run(args, signal, fingerprint, { delivery: 'send' }), 'refused', /could not be resolved/);
});

it('reply: the card shows the recipients Outlook\'s own Reply gives, and the reply is sent only to those', async () => {
  const { request, tool } = setup({
    'mail.recipients': a => a.replyAll ? { to: ['list@corp.example', 'lee@corp.example'], cc: ['out@vendor.example'] } : { to: ['list@corp.example'], cc: [] },
  });
  const reply = tool('outlook_reply_message');
  const one = await reply.bind!(reply.parse({ id: ID, body: 'Thanks' }), signal);
  expect(one.card).toContainEqual({ label: 'To', value: 'list@corp.example' });
  expect(one.card).toContainEqual({ label: 'Reply to', value: expect.stringContaining('"\u2068Budget\u2069" from \u2068Dana <dana@corp.example>\u2069') });
  expect(request).toHaveBeenCalledWith('mail.recipients', { id: ID, replyAll: false });
  const all = await reply.bind!(reply.parse({ id: ID, body: 'Thanks', replyAll: true }), signal);
  expect(all.card).toContainEqual({ label: 'To', value: 'list@corp.example, lee@corp.example' });
  expect(all.card).toContainEqual({ label: 'Outside corp.example', value: 'out@vendor.example', tone: 'warning' });
  expect(one.fingerprint).not.toBe(all.fingerprint);
  await reply.run(reply.parse({ id: ID, body: 'Thanks', replyAll: true }), signal, all.fingerprint, { delivery: 'send' });
  expect(request).toHaveBeenLastCalledWith('mail.reply', { id: ID, replyAll: true, body: 'Thanks', delivery: 'send', account: 'nave@corp.example', expect: ['list@corp.example', 'lee@corp.example', 'out@vendor.example'], version: 'A'.repeat(64) });
  // Outlook would now reply to someone else: the approval no longer matches and nothing is sent.
  const moved = setup({ 'mail.recipients': () => ({ to: ['attacker@vendor.example'], cc: [] }) }).tool('outlook_reply_message');
  await failsWith(moved.run(reply.parse({ id: ID, body: 'Thanks' }), signal, one.fingerprint, { delivery: 'send' }), 'refused', /changed after it was approved/);
});

it('forward: warns that attachments go along and passes the note', async () => {
  const { request, tool } = setup();
  const forward = tool('outlook_forward_message');
  const args = forward.parse({ id: ID, to: ['out@vendor.example'], body: 'FYI' });
  const bound = await forward.bind!(args, signal);
  expect(bound.card).toContainEqual({ label: 'Attachments', value: 'Its attachments are forwarded too', tone: 'warning' });
  expect(bound.card).toContainEqual({ label: 'Note', value: 'FYI', long: true });
  await forward.run(args, signal, bound.fingerprint, { delivery: 'send' });
  expect(request).toHaveBeenLastCalledWith('mail.forward', { id: ID, to: ['out@vendor.example'], cc: [], body: 'FYI', delivery: 'send', account: 'nave@corp.example', version: 'A'.repeat(64) });
  // The message changed after approval (same id, other content): nothing is sent.
  const edited = setup({ 'mail.read': () => mail({ version: 'B'.repeat(64) }) }).tool('outlook_forward_message');
  await failsWith(edited.run(args, signal, bound.fingerprint, { delivery: 'send' }), 'refused', /changed after it was approved/);
});

it('respond: only invitations, proposals only with tentative or decline, and the proposal reaches Outlook', async () => {
  const invite = { start: '2026-11-18T08:00:00.000Z', end: '2026-11-18T08:30:00.000Z', allDay: false, location: '', organizer: 'Dana', responseStatus: 5, isRecurring: false, eventId: 'CD34', lastModified: '2026-11-17T05:00:00.000Z' };
  const { request, tool } = setup({ 'mail.read': () => mail({ kind: 'meeting_request', meeting: invite }) });
  const respond = tool('outlook_respond_meeting');
  expect(() => respond.parse({ id: ID, response: 'accept', proposedStart: '2026-11-18T10:00:00', proposedEnd: '2026-11-18T10:30:00' })).toThrow(/tentative/);
  expect(() => respond.parse({ id: ID, response: 'decline', proposedStart: '2026-11-18T10:00:00' })).toThrow(/both/);
  expect(() => respond.parse({ id: ID, response: 'maybe' })).toThrow(HyperBotsToolError);
  const args = respond.parse({ id: ID, response: 'tentative', comment: 'Clash', proposedStart: '2026-11-18T10:00:00Z', proposedEnd: '2026-11-18T10:30:00Z' });
  const bound = await respond.bind!(args, signal);
  expect(bound.card).toContainEqual({ label: 'Answer', value: 'Tentative' });
  // A Hebrew title must not flip the English line: the line is marked left to right and the title isolated.
  const hebrew = await setup({ 'mail.read': () => mail({ kind: 'meeting_request', subject: '\u05E0\u05D9\u05E1\u05D5\u05DF 3', meeting: invite }) }).tool('outlook_respond_meeting').bind!(args, signal);
  expect(hebrew.card!.find(row => row.label === 'Meeting')!.value).toMatch(/^\u200E"\u2068\u05E0\u05D9\u05E1\u05D5\u05DF 3\u2069", Wed, 18 Nov 2026/);
  expect(bound.card!.map(row => row.label)).toContain('Proposed new time');
  await respond.run(args, signal, bound.fingerprint, { delivery: 'send' });
  expect(request).toHaveBeenLastCalledWith('meeting.respond', { id: ID, response: 'tentative', comment: 'Clash', delivery: 'send', account: 'nave@corp.example', expect: '2026-11-17T05:00:00.000Z',
    proposed: { start: '2026-11-18T10:00:00.000Z', end: '2026-11-18T10:30:00.000Z' } });
  // The meeting was updated (same message, same answer status) while the card waited: the owner decides again.
  const moved = setup({ 'mail.read': () => mail({ kind: 'meeting_request', meeting: { ...invite, start: '2026-11-18T09:00:00.000Z', end: '2026-11-18T09:30:00.000Z', lastModified: '2026-11-17T05:10:00.000Z' } }) }).tool('outlook_respond_meeting');
  await failsWith(moved.run(args, signal, bound.fingerprint, { delivery: 'send' }), 'refused', /changed after it was approved/);
  const plain = setup().tool('outlook_respond_meeting');
  await failsWith(plain.bind!(plain.parse({ id: ID, response: 'accept' }), signal), 'refused', /not a meeting invitation/);
  // An event the owner organizes has no invitation to answer.
  const own = setup({ 'mail.read': () => { throw new SettingsError('state', 'Only mail and meeting messages in your mailbox are supported.'); } }).tool('outlook_respond_meeting');
  await failsWith(own.bind!(own.parse({ id: 'CD34', response: 'accept' }), signal), 'refused', /organizes this meeting/);
});

it('create: Teams is on the card and reaches Outlook; attendees mean invitations are sent', async () => {
  const { request, tool } = setup();
  const create = tool('outlook_create_event');
  expect(() => create.parse({ subject: 'x', start: '2026-11-18', end: '2026-11-18T10:00:00' })).toThrow(/All-day events take dates/);
  expect(() => create.parse({ subject: 'x', start: '2026-11-18T10:00:00', end: '2026-11-18T11:00:00', onlineMeeting: 'zoom' })).toThrow(HyperBotsToolError);
  const args = create.parse({ subject: 'Design review', start: '2026-11-18T10:00:00Z', end: '2026-11-18T11:00:00Z', attendees: ['lee@corp.example', 'out@vendor.example'], onlineMeeting: 'teams' });
  const bound = await create.bind!(args, signal);
  expect(bound.destination).toBe('Outlook calendar as nave@corp.example on this PC; Outlook sends 2 invitations');
  expect(bound.card).toContainEqual({ label: 'Online meeting', value: 'Microsoft Teams' });
  expect(bound.card).toContainEqual({ label: 'Outside corp.example', value: 'out@vendor.example', tone: 'warning' });
  await create.run(args, signal, bound.fingerprint, { delivery: null });
  expect(request).toHaveBeenLastCalledWith('create', { subject: 'Design review', start: '2026-11-18T10:00:00.000Z', end: '2026-11-18T11:00:00.000Z', allDay: false, location: '', body: '',
    attendees: ['lee@corp.example', 'out@vendor.example'], send: true, onlineMeeting: 'teams', account: 'nave@corp.example' });
  const skype = create.parse({ subject: 'Call', start: '2026-11-18', end: '2026-11-19', allDay: true, onlineMeeting: 'skype' });
  expect((await create.bind!(skype, signal)).card).toContainEqual({ label: 'Online meeting', value: 'Skype for Business' });
});

it('update: organizer only, and an edit made in Outlook after approval sends nothing', async () => {
  const { request, tool } = setup();
  const update = tool('outlook_update_event');
  expect(() => update.parse({ id: 'CD34' })).toThrow(/at least one/);
  const args = update.parse({ id: 'CD34', subject: 'Sync (moved)', start: '2026-11-18T09:00:00Z', end: '2026-11-18T09:30:00Z' });
  const bound = await update.bind!(args, signal);
  expect(bound.card).toContainEqual({ label: 'New title', value: 'Sync (moved)' });
  expect(bound.card).toContainEqual({ label: 'Update goes to', value: 'lee@corp.example' });
  await update.run(args, signal, bound.fingerprint);
  expect(request).toHaveBeenLastCalledWith('update', { id: 'CD34', expectedLastModified: '2026-11-17T06:00:00.000Z', patch: { subject: 'Sync (moved)', start: '2026-11-18T09:00:00.000Z', end: '2026-11-18T09:30:00.000Z' }, send: true, account: 'nave@corp.example' });
  const edited = setup({ 'event.get': () => event({ lastModified: '2026-11-17T06:05:00.000Z' }) }).tool('outlook_update_event');
  await failsWith(edited.run(args, signal, bound.fingerprint), 'refused', /changed after it was approved/);
  // Unchanged fields are dropped (an unchanged description is not rewritten); nothing left is refused.
  const partly = await update.bind!(update.parse({ id: 'CD34', subject: 'Sync', description: 'Agenda\r\n', location: 'Room 2' }), signal);
  expect(partly.card!.map(row => row.label)).toEqual(['Meeting', 'New location', 'Update goes to']);
  await failsWith(update.bind!(update.parse({ id: 'CD34', subject: 'Sync', start: '2026-11-18T08:00:00Z' }), signal), 'args', /Nothing would change/);
  // The organizer, listed as a recipient of their own meeting, is not counted as an attendee.
  const alone = await setup({ 'event.get': () => event({ attendees: [{ name: 'Nave', email: 'nave@corp.example', type: 1, response: 1 }], attendeeCount: 1 }) }).tool('outlook_update_event').bind!(args, signal);
  expect(alone.card!.map(row => row.label)).not.toContain('Update goes to');
  // Everyone who gets the update is shown, outsiders flagged; hidden or shortened attendee lists are refused.
  const external = await setup({ 'event.get': () => event({ attendees: [{ name: 'Out', email: 'out@vendor.example', type: 1, response: 3 }], attendeeCount: 1 }) }).tool('outlook_update_event').bind!(args, signal);
  expect(external.card).toContainEqual({ label: 'Outside corp.example', value: 'out@vendor.example', tone: 'warning' });
  await failsWith(setup({ 'event.get': () => event({ isPrivate: true, attendees: [], attendeeCount: 2 }) }).tool('outlook_update_event').bind!(args, signal), 'refused', /private meeting/);
  await failsWith(setup({ 'event.get': () => event({ attendeeCount: 250 }) }).tool('outlook_update_event').bind!(args, signal), 'refused', /too many attendees/);
  // A description holding Teams join details is never rewritten by a bot; other fields still can be.
  const teams = setup({ 'event.get': () => event({ body: 'Agenda\n____\nMicrosoft Teams meeting\nJoin: https://teams.microsoft.com/meet/123?p=x', joinUrl: null }) }).tool('outlook_update_event');
  await failsWith(teams.bind!(update.parse({ id: 'CD34', description: 'A new agenda' }), signal), 'args', /online meeting join details/);
  expect((await teams.bind!(update.parse({ id: 'CD34', location: 'Room 2' }), signal)).card).toContainEqual({ label: 'New location', value: 'Room 2' });
  // The bot resending the clipped preview it saw is no change: only the location is written.
  const copied = await teams.bind!(update.parse({ id: 'CD34', location: 'Room 2', description: 'Agenda ____   Microsoft Teams meeting Join: https://teams.microsoft.com/meet/123?p=x' }), signal);
  expect(copied.card!.map(row => row.label)).toEqual(['Meeting', 'New location', 'Update goes to']);
  // Exactly the preview outlook_list_events showed is no change either; a shortened description is a real change.
  const long = 'Agenda '.repeat(60) + 'Private appendix';
  const previewed = setup({ 'event.get': () => event({ body: long }) }).tool('outlook_update_event');
  const preview = long.trim().slice(0, 300) + '…';
  expect((await previewed.bind!(update.parse({ id: 'CD34', location: 'Room 2', description: preview }), signal)).card!.map(row => row.label)).toEqual(['Meeting', 'New location', 'Update goes to']);
  const shortened = await setup({ 'event.get': () => event({ body: 'Agenda\nPrivate appendix' }) }).tool('outlook_update_event').bind!(update.parse({ id: 'CD34', location: 'Room 2', description: 'Agenda' }), signal);
  expect(shortened.card).toContainEqual({ label: 'New description', value: 'Agenda', long: true });
  const invited = setup({ 'event.get': () => event({ isOrganizer: false }) }).tool('outlook_update_event');
  await failsWith(invited.bind!(args, signal), 'refused', /Only the organizer/);
  const allDay = setup({ 'event.get': () => event({ allDay: true, start: '2026-11-18', end: '2026-11-19' }) }).tool('outlook_update_event');
  await failsWith(allDay.bind!(args, signal), 'args', /all-day/);
});

it('forward event: explains organizer and attendee forwarding on the card', async () => {
  const { request, tool } = setup();
  const forward = tool('outlook_forward_event');
  const args = forward.parse({ id: 'CD34', to: ['out@vendor.example'], comment: 'Join us' });
  const organizer = await forward.bind!(args, signal);
  expect(organizer.card).toContainEqual({ label: 'How', value: expect.stringContaining('to all 2 attendees') });
  expect(organizer.card!.map(row => row.label)).not.toContain('Comment');
  await forward.run(args, signal, organizer.fingerprint);
  expect(request).toHaveBeenLastCalledWith('event.forward', { id: 'CD34', to: ['out@vendor.example'], comment: 'Join us', account: 'nave@corp.example', expect: '2026-11-17T06:00:00.000Z' });
  expect(organizer.card).toContainEqual({ label: 'Adds', value: 'out@vendor.example' });
  expect(organizer.card).toContainEqual({ label: 'Update also goes to', value: 'lee@corp.example' });
  const attendee = await setup({ 'event.get': () => event({ isOrganizer: false, isRecurring: true }) }).tool('outlook_forward_event').bind!(args, signal);
  expect(attendee.card).toContainEqual({ label: 'How', value: expect.stringContaining('the whole series') });
  expect(attendee.card).toContainEqual({ label: 'Comment', value: 'Join us', long: true });
});

it('a failed final check before sending is a definite refusal: nothing was sent', async () => {
  let reads = 0;
  const { request, tool } = setup({ 'mail.account': () => { if (++reads > 1) throw new HyperOutlookLost('Outlook timed out.'); return account; } });
  const send = tool('outlook_send_message');
  const args = send.parse({ to: ['lee@corp.example'], subject: 'x', body: 'y' });
  const { fingerprint } = await send.bind!(args, signal);
  await failsWith(send.run(args, signal, fingerprint, { delivery: 'send' }), 'refused', /nothing was sent/);
  expect(request).not.toHaveBeenCalledWith('mail.send', expect.anything());
});

it('writes name the items they act on, so the runtime can require that the bot was shown them', () => {
  const { tool } = setup();
  expect(tool('outlook_reply_message').targets!(tool('outlook_reply_message').parse({ id: ID, body: 'x' }))).toEqual([ID]);
  expect(tool('outlook_update_event').targets!(tool('outlook_update_event').parse({ id: 'CD34', location: 'x' }))).toEqual(['CD34']);
  expect(tool('outlook_send_message').targets).toBeUndefined();
  expect(tool('outlook_list_messages').targets).toBeUndefined();
});

it('a message Outlook could not fully read (no content hash) cannot be replied to or forwarded', async () => {
  const { request, tool } = setup({ 'mail.read': () => mail({ version: '' }), 'mail.recipients': () => ({ to: ['dana@corp.example'], cc: [] }) });
  const reply = tool('outlook_reply_message'), forward = tool('outlook_forward_message');
  await failsWith(reply.bind!(reply.parse({ id: ID, body: 'x' }), signal), 'refused', /could not read all of this message/);
  await failsWith(forward.bind!(forward.parse({ id: ID, to: ['lee@corp.example'] }), signal), 'refused', /could not read all of this message/);
  expect(request).not.toHaveBeenCalledWith('mail.reply', expect.anything());
  expect(request).not.toHaveBeenCalledWith('mail.forward', expect.anything());
});

it('outlook_search_people resolves English and Hebrew directory queries, strips photo bytes, and handles errors', async () => {
  const aaron = { name: 'Aaron Mitchell', email: 'aaron.mitchell@corp.example', title: 'Staff Engineer', department: 'Platform', phone: '123', office: 'TLV', company: 'HyperTask', photo: 'data:image/png;base64,AAAA', source: 'ad' as const };
  const israel = { name: 'ישראל ישראלי', email: 'israel@corp.example', title: 'מנהל מוצר', department: 'מוצר', phone: '', office: '', company: '', source: 'outlook' as const };
  const { tool } = setup({
    'people.search': a => {
      if (a.query === 'Aaron Mitchel' || a.query === 'Mitchell') return [aaron];
      if (a.query === 'ישראל ישראלי') return [israel];
      return [];
    },
  });
  const search = tool('outlook_search_people');
  expect(await search.bind!({ query: 'Aaron Mitchel' }, signal)).toEqual({ destination: 'Employee & Outlook directory on this PC', fingerprint: 'outlook:local-directory' });
  const en = await search.run(search.parse({ query: 'Aaron Mitchel' }), signal) as Array<Record<string, unknown>>;
  expect(en).toEqual([{ name: 'Aaron Mitchell', email: 'aaron.mitchell@corp.example', title: 'Staff Engineer', department: 'Platform', office: 'TLV', company: 'HyperTask', source: 'ad' }]);
  expect(en[0]).not.toHaveProperty('photo');

  const he = await search.run(search.parse({ query: 'לישראל ישראלי' }), signal) as Array<Record<string, unknown>>;
  expect(he).toEqual([{ name: 'ישראל ישראלי', email: 'israel@corp.example', title: 'מנהל מוצר', department: 'מוצר', source: 'outlook' }]);

  const unavailable = setup({ 'people.search': () => { throw new SettingsError('state', 'Employee directory is unavailable.'); } }).tool('outlook_search_people');
  await failsWith(unavailable.run(unavailable.parse({ query: 'Aaron' }), signal), 'refused', /unavailable/);
});

it('enriches create_event and send_message approval cards with Display Name, email, title and department when cached', async () => {
  const people: Record<string, unknown> = {
    'aaron.mitchell@corp.example': { name: 'Aaron Mitchell', email: 'aaron.mitchell@corp.example', title: 'Staff Engineer', department: 'Platform', phone: '', office: '', company: '', source: 'ad' },
    'israel@corp.example': { name: 'ישראל ישראלי', email: 'israel@corp.example', title: 'מנהל פרויקט', department: 'הנדסה', phone: '', office: '', company: '', source: 'outlook' },
  };
  const { tool } = setup({ 'people.lookup': a => people[a.email] ?? null });
  const create = tool('outlook_create_event');
  const createBound = await create.bind!(create.parse({
    subject: 'Sync', start: '2026-11-18T18:00:00Z', end: '2026-11-18T18:30:00Z',
    attendees: ['aaron.mitchell@corp.example', 'israel@corp.example'],
  }), signal);
  const invites = createBound.card?.find(r => r.label === 'Invites')?.value ?? '';
  expect(invites).toContain('Aaron Mitchell');
  expect(invites).toContain('<aaron.mitchell@corp.example>');
  expect(invites).toContain('Staff Engineer · Platform');
  expect(invites).toContain('ישראל ישראלי');
  expect(invites).toContain('<israel@corp.example>');

  const send = tool('outlook_send_message');
  const sendBound = await send.bind!(send.parse({
    to: ['aaron.mitchell@corp.example'], cc: ['unknown@vendor.example'], subject: 'Hi', body: 'Hello',
  }), signal);
  expect(sendBound.card?.find(r => r.label === 'To')?.value).toContain('Aaron Mitchell');
  expect(sendBound.card?.find(r => r.label === 'Cc')?.value).toBe('unknown@vendor.example');
  expect(sendBound.card?.find(r => r.label === 'Outside corp.example')?.value).toBe('unknown@vendor.example');
});
