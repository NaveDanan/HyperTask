import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, type HyperBotsApproval, type HyperBotsMessage, type HyperBotsRunSummary, type HyperBotsSnapshot } from '@shared/HyperBots';
import { HyperBotsOutbox, type HyperBotsViewState } from './HyperBotsController';
import { HyperBotsPage } from './HyperBotsPage';
import { HyperBotsView, type HyperBotActions as HyperBotsActions } from './HyperBotScreen';
import { HyperBotsApprovalCard } from './HyperBotApproval';
import { HyperBotsComposer, HyperBotsComposerBox } from './HyperBotComposer';
import { hyperBotsMentionHint } from './HyperBotChat';
import { hyperBotFailuresByGroup, hyperBotMessageGroups } from './HyperBotTranscript';
import { HyperBotToolsForm } from './HyperBotTools';
import { HyperBotInstructions } from './HyperBotSettingsDialog';
import { HyperBotModelSelect } from './HyperBotEngine';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-11-16T10:00:00.000Z';
const message = (n: number, patch: Partial<HyperBotsMessage> = {}): HyperBotsMessage => ({ id: id(n), roomId: 'ops', clientMessageId: id(n + 100), author: { kind: 'user' }, text: `Message ${n}`, model: null, runId: null, hop: 0, createdAt: at, ...patch });
const run = (n: number, patch: Partial<HyperBotsRunSummary> = {}): HyperBotsRunSummary => ({ id: id(n), roomId: 'ops', botId: 'scout', triggerMessageId: id(1), model: 'gpt-x', status: 'running', steps: 0, error: null, createdAt: at, updatedAt: at, ...patch });
const approval = (n: number, patch: Partial<HyperBotsApproval> = {}): HyperBotsApproval => ({
  id: id(n), runId: id(50), roomId: 'ops', botId: 'scribe', toolCallId: 'call_1', tool: 'jira_create_issue', access: 'write', args: { summary: 'Fix login', projectKey: 'OPS' }, card: null, delivery: null,
  summary: 'Create OPS issue "Fix login"', destination: 'Jira project OPS at https://jira.example as nave', status: 'pending', decidedBy: null, result: null, error: null, createdAt: at, updatedAt: at, ...patch,
});
const snapshot = (patch: Partial<HyperBotsSnapshot> = {}): HyperBotsSnapshot => ({
  settings: HYPER_BOTS_DEFAULT_SETTINGS, roomId: 'ops', messages: [message(1)], runs: [], approvals: [],
  connections: { model: { ready: true, detail: 'gpt-x at https://host/v1', defaultModel: 'gpt-x' }, outlook: { ready: false, problem: 'Open classic Outlook on this PC.' }, jira: { ready: false, problem: 'Set up Jira in the Jira tab.' } }, ...patch,
});
const base: HyperBotsViewState = { phase: 'ready', snapshot: snapshot(), models: ['gpt-x', 'gpt-y'], sending: false, saving: false, deciding: [] };
const actions: HyperBotsActions = { select: vi.fn(), reload: vi.fn(), send: vi.fn(), decide: vi.fn(), saveSettings: vi.fn() };
const render = (patch: Partial<HyperBotsViewState> = {}, outbox = new HyperBotsOutbox()) => renderToStaticMarkup(<HyperBotsView state={{ ...base, ...patch }} outbox={outbox} actions={actions} />);
/** Walks a hook-free component's element tree without rendering nested components. */
function all(node: ReactNode, match: (element: ReactElement<any>) => boolean, found: ReactElement<any>[] = []) {
  if (Array.isArray(node)) node.forEach(child => all(child, match, found));
  else if (isValidElement<any>(node)) { if (match(node)) found.push(node); all((node as ReactElement<any>).props.children, match, found); }
  return found;
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : isValidElement<any>(node) ? text((node as ReactElement<any>).props.children) : '';
const button = (tree: ReactNode, label: string) => all(tree, element => text(element.props.children) === label && typeof element.props.onClick === 'function')[0];
it('asks for sign-in without a user', () => {
  expect(renderToStaticMarkup(<HyperBotsPage userProfile={null} />)).toContain('Sign in to use Hyper-Bot.');
});
it('shows the room, connection chips with their problems, transcript, run status and composer hint', () => {
  const html = render({ snapshot: snapshot({
    messages: [message(1, { text: 'Plan my day' }), message(2, { author: { kind: 'bot', botId: 'scout' }, model: 'gpt-y', text: 'Line one\nLine two', runId: id(60) })],
    runs: [run(60, { status: 'running' }), run(61, { botId: 'scribe', status: 'waiting_approval' }), run(62, { botId: 'scribe', status: 'failed', error: 'Jira returned 401.' })],
  }) });
  expect(html).toContain('<h1>Hyper-Bot</h1>');
  expect(html).toContain('Ops');
  expect(html).toContain('gpt-x at https://host/v1');
  expect(html).toContain('Open classic Outlook on this PC.');
  expect(html).toContain('Set up Jira in the Jira tab.');
  expect(html).toContain('aria-label="You"');
  expect(html).toContain('sender-label');
  expect(html).toContain('gpt-y');
  expect(html).toContain('Line one\nLine two');
  expect(html).toContain('Scout is working…');
  expect(html).toContain('Scribe is waiting for your approval');
  expect(html).toContain('Scribe could not finish: Jira returned 401.');
  expect(html).toContain('Mention @scout or @scribe to pick a bot; no mention = all bots in the room.');
  expect(html).toContain('aria-label="Refresh"');
  expect(html).toMatch(/<option value=""[^>]*>Bot default<\/option><option value="gpt-x">gpt-x<\/option><option value="gpt-y">gpt-y<\/option>/);
  expect(render({ snapshot: null, phase: 'unavailable', syncError: 'Refused.' })).toContain('Bots could not be opened. Refused.');
  expect(render({ error: 'The room did not answer.' })).toContain('The room did not answer.');
});
it('lists pending approvals above the composer with args, and decided ones with their outcome', () => {
  const html = render({ snapshot: snapshot({ approvals: [approval(5), approval(6, { status: 'unknown', error: 'Jira did not answer; the issue may exist.' }), approval(7, { botId: 'scout', tool: 'outlook_list_events', access: 'read', status: 'done', decidedBy: 'policy' })] }) });
  expect(html).toContain('Waiting for you');
  expect(html).toContain('Create Jira issues');
  expect(html).toContain('Create OPS issue &quot;Fix login&quot;');
  expect(html).toContain('&quot;projectKey&quot;: &quot;OPS&quot;');
  expect(html.indexOf('Waiting for you')).toBeLessThan(html.indexOf('aria-label="Message Ops"'));
  expect(html).toContain('unknown');
  expect(html).toContain('Jira did not answer; the issue may exist.');
  expect(html).toContain('done (allowed by policy)');
  expect(hyperBotsMentionHint(snapshot({ settings: { ...HYPER_BOTS_DEFAULT_SETTINGS, rooms: [{ id: 'ops', name: 'Ops', botIds: ['scout'] }] } }))).toBe('Mention @scout to pick a bot; no mention = all bots in the room.');
});
it('approval card emphasizes writes, shows exact args and decides by approval ID', () => {
  const onDecide = vi.fn();
  const card = HyperBotsApprovalCard({ approval: approval(5), botName: 'Scribe', busy: false, onDecide });
  const html = renderToStaticMarkup(card);
  expect(html).toMatch(/<span class="[^"]*text-warning[^"]*">Write<\/span>/);
  expect(html).toContain(JSON.stringify({ summary: 'Fix login', projectKey: 'OPS' }, null, 2).replaceAll('"', '&quot;'));
  button(card, 'Approve').props.onClick();
  button(card, 'Deny').props.onClick();
  expect(onDecide.mock.calls).toEqual([[id(5), true], [id(5), false]]);
  const read = renderToStaticMarkup(HyperBotsApprovalCard({ approval: approval(6, { tool: 'outlook_list_events', access: 'read' }), botName: 'Scout', busy: true, onDecide }));
  expect(read).toContain('Read Outlook calendar');
  expect(read).toMatch(/>Read<\/span>/);
  expect(read.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
});
it('approval card names where the call goes; recent decisions keep it and explain a skipped call', () => {
  const card = renderToStaticMarkup(HyperBotsApprovalCard({ approval: approval(5), botName: 'Scribe', busy: false, onDecide: vi.fn() }));
  expect(card).toMatch(/To: <\/span><span class="[^"]*font-medium[^"]*">Jira project OPS at https:\/\/jira.example as nave<\/span>/);
  expect(card.indexOf('Jira project OPS')).toBeLessThan(card.indexOf('Create OPS issue'));
  expect(renderToStaticMarkup(HyperBotsApprovalCard({ approval: approval(6, { destination: null }), botName: 'Scribe', busy: false, onDecide: vi.fn() }))).not.toContain('To: ');
  const html = render({ snapshot: snapshot({ approvals: [approval(7, { status: 'skipped', result: '{"error":"This bot no longer has this tool; the call was not made."}' })] }) });
  expect(html).toContain('skipped — the bot no longer has this tool');
  expect(html).toContain('to Jira project OPS at https://jira.example as nave');
  expect(html).not.toContain('Waiting for you');
});
it('audit #2: the composer reads the draft from the outbox, so a remount after settings close shows the cleared draft', async () => {
  const outbox = new HyperBotsOutbox();
  outbox.setDraft('ops', 'File OPS-1');
  outbox.setModel('gpt-y');
  const textarea = (html: string) => html.match(/<textarea[^>]*>([^<]*)<\/textarea>/)?.[1];
  const before = render({}, outbox);
  expect(textarea(before)).toBe('File OPS-1');
  expect(before).toMatch(/<option value="gpt-y" selected="">/);
  // Bot settings opens (the composer unmounts) while the send is in flight, and the send lands meanwhile.
  const entry = outbox.begin('ops', 'File OPS-1', 'gpt-y', () => id(900));
  const box = <HyperBotsComposerBox outbox={outbox} roomId="ops" models={[]} sending={false} hint="" onSend={vi.fn()} />;
  expect(textarea(renderToStaticMarkup(box))).toBe('File OPS-1');
  outbox.end(entry, true);
  // Settings closes: the composer that mounts again reads the store, not a stale copy.
  expect(textarea(render({}, outbox))).toBe('');
  expect(textarea(renderToStaticMarkup(box))).toBe('');
  expect(render({}, outbox)).toMatch(/<option value="gpt-y" selected="">/);
});
it('composer sends the text with the selected model, or null for the bot default, on submit and Enter', () => {
  const onSend = vi.fn(), onModel = vi.fn();
  const props = { text: 'File a ticket', model: 'gpt-y', models: ['gpt-x', 'gpt-y'], sending: false, hint: '', onText: vi.fn(), onModel, onSend };
  const form = HyperBotsComposer(props);
  form.props.onSubmit({ preventDefault() {} });
  expect(onSend).toHaveBeenLastCalledWith('File a ticket', 'gpt-y');
  all(form, element => element.props.label === 'Model for this message')[0].props.onChange('gpt-x');
  expect(onModel).toHaveBeenCalledWith('gpt-x');
  const area = all(HyperBotsComposer({ ...props, model: '' }), element => element.props['aria-label'] === 'Message the bots')[0];
  const preventDefault = vi.fn();
  area.props.onKeyDown({ key: 'Enter', shiftKey: true, nativeEvent: {}, preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
  area.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: {}, preventDefault });
  expect(onSend).toHaveBeenLastCalledWith('File a ticket', null);
  onSend.mockClear();
  HyperBotsComposer({ ...props, sending: true }).props.onSubmit({ preventDefault() {} });
  HyperBotsComposer({ ...props, text: '  ' }).props.onSubmit({ preventDefault() {} });
  expect(onSend).not.toHaveBeenCalled();
});
it('settings edit instructions/model, preserve catalog tool order and apply global read policies', () => {
  const onChange = vi.fn(), bot = HYPER_BOTS_DEFAULT_SETTINGS.bots[0]!;
  const form = HyperBotToolsForm({ settings: HYPER_BOTS_DEFAULT_SETTINGS, bot, onChange });
  const html = renderToStaticMarkup(form);
  expect(html).toContain('Ask me every time'); expect(html).toContain('Allow calendar reads without asking');
  expect(html).toContain('Writes always ask you first'); expect(html).toContain('Applies to all bots');
  const instructions = HyperBotInstructions({ bot: HYPER_BOTS_DEFAULT_SETTINGS.bots[1]!, onChange });
  all(instructions, element => element.props['aria-label'] === 'Instructions of @scribe')[0].props.onChange({ target: { value: 'Be brief.' } });
  expect(onChange.mock.calls[0][0]).toMatchObject({ id: 'scribe', instructions: 'Be brief.' });
  const model = HyperBotModelSelect({ id: 'scout', model: '', models: ['gpt-y'], defaultModel: 'gpt-x', onChange });
  expect(renderToStaticMarkup(model)).toContain('Endpoint default (gpt-x)');
  model.props.onChange('gpt-y'); expect(onChange.mock.calls[1][0]).toBe('gpt-y');
  all(form, element => element.props.type === 'radio')[1].props.onChange();
  expect(onChange.mock.calls[2][0].policy).toEqual({ outlook_list_events: 'allow', outlook_get_event: 'allow', outlook_list_messages: 'ask', outlook_read_message: 'ask', outlook_search_people: 'allow' });
  const tool = all(form, element => element.props.label === 'Edit meetings')[0];
  tool.props.onChange(true);
  expect(onChange.mock.calls[3][0].bots[0].tools).toEqual(['outlook_list_events', 'outlook_get_event', 'outlook_create_event', 'outlook_update_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people', 'outlook_send_message']);
});
it('mail write card shows the approved lines and offers Send or Save to Drafts', () => {
  const onDecide = vi.fn();
  const mail = approval(7, {
    tool: 'outlook_send_message', botId: 'scout', summary: 'Email lee@corp.example: "Plan"', destination: 'Outlook mail as nave@corp.example on this PC',
    card: [{ label: 'From', value: 'nave@corp.example' }, { label: 'Outside corp.example', value: 'out@vendor.example', tone: 'warning' }, { label: 'Message', value: 'שלום\nHi', long: true }],
  });
  const card = HyperBotsApprovalCard({ approval: mail, botName: 'Scout', busy: false, onDecide });
  const html = renderToStaticMarkup(card);
  expect(html).toContain('Via: ');
  expect(html).toMatch(/bg-warning-surface[^>]*><dt[^>]*>Outside corp\.example<\/dt>/);
  expect(html).toMatch(/whitespace-pre-wrap[^>]*>שלום\nHi<\/dd>/);
  expect(html).not.toContain('>Approve<');
  button(card, 'Save to Drafts').props.onClick();
  button(card, 'Send').props.onClick();
  button(card, 'Deny').props.onClick();
  expect(onDecide.mock.calls).toEqual([[id(7), true, 'draft'], [id(7), true, 'send'], [id(7), false]]);
});

it.each(['outlook_send_message', 'outlook_reply_message', 'outlook_forward_message', 'outlook_respond_meeting'])('keeps exact delivery labels/actions for %s', tool => {
  const onDecide = vi.fn(), card = HyperBotsApprovalCard({ approval: approval(8, { tool }), botName: 'Scout', busy: false, onDecide });
  button(card, 'Save to Drafts').props.onClick(); button(card, 'Send').props.onClick(); button(card, 'Deny').props.onClick();
  expect(onDecide.mock.calls).toEqual([[id(8), true, 'draft'], [id(8), true, 'send'], [id(8), false]]);
  expect(renderToStaticMarkup(card)).not.toContain('>Approve<');
});
it('keeps an old failure where it happened; only the latest failures sit at the end and announce themselves', () => {
  const messages = [message(1, { createdAt: '2026-11-17T07:37:00.000Z' }), message(2, { author: { kind: 'bot', botId: 'scribe' }, createdAt: '2026-11-17T21:06:00.000Z' })];
  const old = run(60, { status: 'failed', error: 'old', updatedAt: '2026-11-17T07:37:30.000Z' }), latest = run(61, { status: 'failed', error: 'new', updatedAt: '2026-11-17T21:07:00.000Z' });
  const groups = hyperBotMessageGroups(messages), placed = hyperBotFailuresByGroup(groups, [old, latest, run(62, { status: 'done' })]);
  expect(placed.get(groups[0]!.key)).toEqual([old]);
  expect(placed.get('')).toEqual([latest]);
  const html = render({ snapshot: snapshot({ messages, runs: [old, latest] }) });
  expect(html.indexOf('could not finish: old')).toBeLessThan(html.indexOf('Message 2'));
  expect(html.indexOf('could not finish: new')).toBeGreaterThan(html.indexOf('Message 2'));
  expect(html).toMatch(/<p class="notice is-error">Scout could not finish: old/);
  expect(html).toMatch(/<p role="alert" class="notice is-error">Scout could not finish: new/);
});
it('composer preserves text and avoids submitting during IME composition', () => {
  const onSend = vi.fn(), props = { text: ' שלום ', model: '', models: [], sending: false, hint: '', name: 'Scout', onText: vi.fn(), onModel: vi.fn(), onSend };
  const form = HyperBotsComposer(props), area = all(form, element => element.props['aria-label'] === 'Message Scout')[0];
  const preventDefault = vi.fn(); area.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault });
  expect(preventDefault).not.toHaveBeenCalled(); expect(onSend).not.toHaveBeenCalled();
  form.props.onSubmit({ preventDefault() {} }); expect(onSend).toHaveBeenCalledWith(' שלום ', null);
});
