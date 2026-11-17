import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, hyperBotsWithDirectRooms, type HyperBotsSnapshot } from '@shared/HyperBots';
import { HyperBotsOutbox } from './HyperBotsController';
import { HyperBotsView, type HyperBotActions } from './HyperBotScreen';
import { HyperBotCreateDialog } from './HyperBotCreateDialog';
import { HyperBotGroupDialog } from './HyperBotGroupDialog';
import { HyperBotSettingsDialog } from './HyperBotSettingsDialog';
import { HyperBotEngine } from './HyperBotEngine';
import { HyperBotSidebar, HyperBotStatusDot } from './HyperBotSidebar';
import { hyperBotMessageGroups } from './HyperBotTranscript';
const settings = hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS);
const snapshot: HyperBotsSnapshot = { settings, roomId: 'dm-scout', messages: [], runs: [], approvals: [], connections: { model: { ready: false, problem: 'Endpoint disabled.', defaultModel: 'model-a' }, outlook: { ready: true, detail: 'Classic Outlook is available' }, jira: { ready: false, problem: 'Choose a Jira project.' } } };
const actions: HyperBotActions = { select: vi.fn(), reload: vi.fn(), send: vi.fn(), decide: vi.fn(), saveSettings: vi.fn(async () => true) };
const render = (roomId = 'dm-scout') => renderToStaticMarkup(<HyperBotsView state={{ phase: 'ready', snapshot: { ...snapshot, roomId }, models: ['model-a'], sending: false, saving: false, deciding: [] }} outbox={new HyperBotsOutbox()} actions={actions} />);
function all(node: ReactNode, match: (element: ReactElement<any>) => boolean, found: ReactElement<any>[] = []) {
  if (Array.isArray(node)) node.forEach(child => all(child, match, found));
  else if (isValidElement<any>(node)) { if (match(node)) found.push(node); all((node as ReactElement<any>).props.children, match, found); }
  return found;
}
it('renders direct chats with native details, tool-derived empty text, exact composer label and model setup notice', () => {
  const html = render();
  expect(html).toContain('data-hyper-bot'); expect(html).toContain('Hyper-Bot');
  expect(html).toContain('Reads your Outlook calendar and mail'); expect(html).toContain('aria-label="Message Scout"');
  expect(html).toContain('Set up the AI endpoint in Settings → AI to chat.');
  expect(html).toContain('HyperTask AI endpoint'); expect(html).toContain('Endpoint default (model-a)');
  expect(html).toContain('Endpoint disabled.'); expect(html).toContain('Choose a Jira project.');
  expect(html).toContain('>Tools</button>'); expect(html).toContain('>Activity</button>');
  expect(html).not.toContain('Mention @'); expect(html).not.toMatch(/microphone|voice chat|>Share</i);
});
it('group chats show members and mention guidance, with no Tools tab', () => {
  const html = render('ops'); expect(html).toContain('Members'); expect(html).toContain('Remove Scout');
  expect(html).toContain('Mention @scout or @scribe'); expect(html).not.toContain('>Tools</button>');
});
it('ports the dialog structure, all 13 shapes, 11 swatches, two types, and scoped portal roots', () => {
  const html = renderToStaticMarkup(<HyperBotCreateDialog settings={settings} onSave={actions.saveSettings} onSelect={actions.select} onClose={vi.fn()} onGroup={vi.fn()} />);
  expect(html).toContain('data-hyper-bot'); expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
  expect(html).toContain('Create New Bot'); expect(html).toContain('Give your Bot a name');
  expect(html).toContain('maxLength="40"'); expect(html).toContain('width:96px');
  expect(html.match(/role="radio"/g)).toHaveLength(26);
  expect(html.match(/class="shape-grid__row"/g)).toHaveLength(3);
  expect(html.match(/class="swatches__row"/g)).toHaveLength(2);
  expect(html).toContain('New group chat instead'); expect(html).toContain('Personal assistant'); expect(html).toContain('Teammate');
  const group = renderToStaticMarkup(<HyperBotGroupDialog settings={settings} onSave={actions.saveSettings} onSelect={actions.select} onClose={vi.fn()} />);
  expect(group).toContain('Choose at least 2 bots'); expect(group.match(/role="checkbox"/g)).toHaveLength(2);
  expect(group).toMatch(/<button[^>]*disabled=""[^>]*>Create group</);
});
it('bot settings retain instruction limits and errors; the last bot cannot be deleted', () => {
  const single = { ...settings, bots: [settings.bots[0]!] };
  const html = renderToStaticMarkup(<HyperBotSettingsDialog settings={single} bot={single.bots[0]} room={settings.rooms[1]!} onSave={actions.saveSettings} onClose={vi.fn()} error="Could not save." />);
  expect(html).toContain('maxLength="4000"'); expect(html).toContain('Could not save.'); expect(html).toContain('Keep at least one bot.');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete bot</);
  const engine = renderToStaticMarkup(<HyperBotEngine bot={settings.bots[0]!} settings={settings} connection={snapshot.connections.model} models={[]} saving={false} onSave={actions.saveSettings} error="Model save failed." />);
  expect(engine).toContain('Undo'); expect(engine).toContain('Model save failed.');
});
it('sidebar selects direct rooms, shows previews, overlaps group members and labels status priority', () => {
  const select = vi.fn();
  const tree = HyperBotSidebar({ settings, roomId: 'ops', connections: snapshot.connections, onSelect: select, onCreate: vi.fn(), onGroup: vi.fn(), summaries: { 'dm-scribe': { preview: 'Filed OPS-12', pendingApprovals: 1, activeRun: true, unread: true } } });
  const html = renderToStaticMarkup(tree); expect(html).toContain('Filed OPS-12'); expect(html).toContain('members-avatar');
  all(tree, element => element.props.title === 'Scribe')[0]!.props.onClick(); expect(select).toHaveBeenCalledWith('dm-scribe');
  expect(renderToStaticMarkup(<HyperBotStatusDot summary={{ preview: '', pendingApprovals: 2, activeRun: true, unread: true }} />)).toContain('2 waiting for you');
  expect(renderToStaticMarkup(<HyperBotStatusDot summary={{ preview: '', pendingApprovals: 0, activeRun: true, unread: true }} />)).toContain('Working');
});
it('groups nearby messages by sender while preserving date dividers and five-minute gaps', () => {
  const message = (id: string, createdAt: string, bot = false) => ({ id, roomId: 'ops', clientMessageId: id, text: id, author: bot ? { kind: 'bot' as const, botId: 'scout' } : { kind: 'user' as const }, runId: null, model: null, hop: 0, createdAt });
  const groups = hyperBotMessageGroups([message('1', '2026-11-17T10:00:00Z'), message('2', '2026-11-17T10:01:00Z'), message('3', '2026-11-17T10:02:00Z', true), message('4', '2026-11-17T10:08:00Z', true), message('5', '2026-11-18T10:00:00Z', true)]);
  expect(groups.map(group => group.messages.length)).toEqual([2, 1, 1, 1]);
  expect(groups.map(group => group.divider)).toEqual([true, false, false, true]);
});

it('keeps the group-chat action available without groups and removes the list header controls', () => {
  const onGroup = vi.fn(), noGroups = { ...settings, rooms: settings.rooms.filter(room => room.kind === 'direct') };
  const tree = HyperBotSidebar({ settings: noGroups, roomId: 'dm-scout', connections: snapshot.connections, onSelect: vi.fn(), onCreate: vi.fn(), onGroup });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('>Group chats</h2>');
  expect(html).toContain('aria-label="New group chat"');
  expect(html).not.toContain('aria-label="New Bot"');
  expect(html).not.toContain('aria-label="Collapse sidebar"');
  expect(html).not.toContain('aria-label="Expand sidebar"');
  all(tree, element => element.props['aria-label'] === 'New group chat')[0]!.props.onClick();
  expect(onGroup).toHaveBeenCalledOnce();
});
