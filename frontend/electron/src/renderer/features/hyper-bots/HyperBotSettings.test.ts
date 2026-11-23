import { expect, it } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, hyperBotsWithDirectRooms } from '@shared/HyperBots';
import { hyperBotCreate, hyperBotCreateGroup, hyperBotDelete, hyperBotUniqueId, hyperBotUpdate, hyperBotDescription } from './HyperBotSettings';
import { hyperBotAvatarOf } from './HyperBotAvatar';
import { hyperBotsPreviewText } from './HyperBotsController';
const settings = () => hyperBotsWithDirectRooms(structuredClone(HYPER_BOTS_DEFAULT_SETTINGS));
it('slugs new bot names, uses bot for non-Latin names, and suffixes within 24 characters', () => {
  expect(hyperBotUniqueId('  Inbox / Triage! ', [])).toBe('inbox-triage');
  expect(hyperBotUniqueId('שלום', ['bot', 'bot-2'])).toBe('bot-3');
  expect(hyperBotUniqueId('A'.repeat(40), ['a'.repeat(24)])).toBe('a'.repeat(22) + '-2');
  expect(hyperBotUniqueId('Scout', ['scout', 'scout-2'])).toBe('scout-3');
});
it('creates direct rooms, type-specific instructions and personal/teammate default tools; caps bots at eight', () => {
  const personal = hyperBotCreate(settings(), { name: 'Inbox', mode: 'personal', avatar: { shape: 'heart', color: 'orange' } });
  expect(personal.bot.instructions).toBe("You are Inbox, the owner's personal assistant in HyperTask. Be concise and ask before acting.");
  expect(personal.bot.tools).toEqual(['outlook_list_events', 'outlook_get_event', 'outlook_create_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people', 'outlook_send_message']);
  expect(personal.settings.rooms.at(-1)).toMatchObject({ kind: 'direct', botIds: [personal.bot.id] });
  const teammate = hyperBotCreate(settings(), { name: 'Ops', mode: 'teammate' });
  expect(teammate.bot.instructions).toBe('You are Ops, a teammate bot in HyperTask. Work with the other bots and hand off when another bot fits better.');
  expect(teammate.bot.tools).toEqual(['outlook_list_events', 'outlook_get_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people']);
  let full = settings(); for (let i = 0; i < 6; i++) full = hyperBotCreate(full, { name: 'Bot ' + i }).settings;
  expect(() => hyperBotCreate(full, { name: 'Ninth' })).toThrow('8 bots');
});
it('deleting a bot removes its direct room and membership from every group while retaining a bot', () => {
  const input = settings(), result = hyperBotDelete(input, 'scout');
  expect(result.bots.map(bot => bot.id)).toEqual(['scribe']);
  expect(result.rooms.some(room => room.id === 'dm-scout')).toBe(false);
  expect(result.rooms.find(room => room.id === 'ops')?.botIds).toEqual(['scribe']);
  expect(input.bots).toHaveLength(2);
  expect(() => hyperBotDelete(result, 'scribe')).toThrow('at least one');
});
it('requires at least two distinct existing bots when creating groups and makes unique room IDs', () => {
  expect(() => hyperBotCreateGroup(settings(), 'Team', ['scout'])).toThrow('at least 2');
  expect(() => hyperBotCreateGroup(settings(), 'Team', ['scout', 'scout', 'missing'])).toThrow('at least 2');
  const next = hyperBotCreateGroup(settings(), 'Ops', ['scribe', 'scout']);
  expect(next.room).toEqual({ id: 'ops-2', name: 'Ops', kind: 'group', botIds: ['scout', 'scribe'] });
  expect(() => hyperBotCreateGroup(settings(), ' ', ['scribe', 'scout'])).toThrow('name');
});
it('renames the direct room with its bot and derives descriptions from configured tools', () => {
  const input = settings(), bot = { ...input.bots[0]!, name: 'Reader' };
  expect(hyperBotUpdate(input, bot).rooms.find(room => room.id === 'dm-scout')?.name).toBe('Reader');
  expect(hyperBotDescription(bot)).toBe('Reads your Outlook calendar and mail · Searches your employee directory · Manages Outlook meetings · Drafts and sends Outlook mail');
  expect(hyperBotDescription({ ...bot, tools: ['outlook_list_events', 'outlook_list_messages'] })).toBe('Reads your Outlook calendar and mail');
  expect(hyperBotDescription({ ...bot, tools: [] })).toBe('No tools yet. Pick them in Tools.');
});
it('gives a new bot a fresh direct room, so a reused name never inherits a deleted bot history', () => {
  const first = hyperBotCreate(settings(), { name: 'Inbox' });
  const room = first.settings.rooms.find(row => row.kind === 'direct' && row.botIds[0] === first.bot.id)!;
  expect(room.id).toMatch(/^dm-inbox-[0-9a-f]{4}$/);
  const again = hyperBotCreate(hyperBotDelete(first.settings, first.bot.id), { name: 'Inbox' });
  expect(again.bot.id).toBe('inbox');
  expect(again.settings.rooms.find(row => row.kind === 'direct' && row.botIds[0] === 'inbox')!.id).not.toBe(room.id);
  expect(again.settings.rooms.filter(row => row.kind === 'direct' && row.botIds[0] === 'inbox')).toHaveLength(1);
});
it('shows bots saved without an avatar as their default look, or a stable colored one', () => {
  expect(hyperBotAvatarOf({ id: 'scout' })).toEqual({ shape: 'sparkle', color: 'blue' });
  expect(hyperBotAvatarOf({ id: 'helper', avatar: { shape: 'star', color: 'gray' } })).toEqual({ shape: 'star', color: 'gray' });
  const picked = hyperBotAvatarOf({ id: 'helper' });
  expect(hyperBotAvatarOf({ id: 'helper' })).toEqual(picked);
  expect(['black', 'gray']).not.toContain(picked.color);
});
it('previews the last message without Markdown marks', () => {
  expect(hyperBotsPreviewText('The approval was declined, so I did **not** accept **“ניסון 3”**.')).toBe('The approval was declined, so I did not accept “ניסון 3”.');
  expect(hyperBotsPreviewText('# Today\n- [Standup](https://x.example) at `09:00`\n```\ncode\n```\nkeep jira_create_issue')).toBe('Today Standup at 09:00 keep jira_create_issue');
});
