import { hyperBotUniqueId, hyperBotsWithDirectRooms, HYPER_BOTS_TOOLS, type HyperBotConfig, type HyperBotsSettings, type HyperBotsToolName } from '@shared/HyperBots';
export { hyperBotCreateGroup, hyperBotUniqueId } from '@shared/HyperBots';
export const HYPER_BOT_TOOL_ORDER = Object.keys(HYPER_BOTS_TOOLS) as HyperBotsToolName[];
export function hyperBotCreate(settings: HyperBotsSettings, input: Pick<HyperBotConfig, 'name' | 'avatar' | 'mode'>) {
  if (settings.bots.length >= 8) throw new Error('You can have up to 8 bots. Edit or delete a bot to make room.');
  const name = input.name.trim();
  if (!name || name.length > 40) throw new Error('Give your bot a name (up to 40 characters).');
  const id = hyperBotUniqueId(name, settings.bots.map(bot => bot.id));
  const instructions = input.mode === 'teammate'
    ? 'You are ' + name + ', a teammate bot in HyperTask. Work with the other bots and hand off when another bot fits better.'
    : 'You are ' + name + ", the owner's personal assistant in HyperTask. Be concise and ask before acting.";
  const tools: HyperBotsToolName[] = input.mode === 'teammate'
    ? ['outlook_list_events', 'outlook_get_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people']
    : ['outlook_list_events', 'outlook_get_event', 'outlook_create_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people', 'outlook_send_message'];
  const bot: HyperBotConfig = { ...input, name, id, instructions, model: '', tools };
  // A fresh room id: messages stay stored under a deleted bot's room, so a new bot with the same name must not reuse it.
  const room = { id: hyperBotUniqueId('dm-' + id + '-' + crypto.randomUUID().slice(0, 4), settings.rooms.map(row => row.id), 32, 'dm'), name, kind: 'direct' as const, botIds: [id] };
  return { bot, settings: hyperBotsWithDirectRooms({ ...settings, bots: [...settings.bots, bot], rooms: [...settings.rooms, room] }) };
}
export function hyperBotDelete(settings: HyperBotsSettings, id: string): HyperBotsSettings {
  if (settings.bots.length <= 1) throw new Error('Keep at least one bot.');
  return hyperBotsWithDirectRooms({ ...settings, bots: settings.bots.filter(bot => bot.id !== id), rooms: settings.rooms
    .filter(room => !(room.kind === 'direct' && room.botIds.includes(id)))
    .map(room => ({ ...room, botIds: room.botIds.filter(botId => botId !== id) })).filter(room => room.botIds.length > 0) });
}
export function hyperBotUpdate(settings: HyperBotsSettings, bot: HyperBotConfig): HyperBotsSettings {
  return { ...settings, bots: settings.bots.map(row => row.id === bot.id ? bot : row), rooms: settings.rooms.map(room => room.kind === 'direct' && room.botIds[0] === bot.id ? { ...room, name: bot.name } : room) };
}
export const hyperBotType = (bot: HyperBotConfig) => bot.mode === 'teammate' ? 'Teammate' : 'Personal assistant';
export function hyperBotDescription(bot: HyperBotConfig) {
  if (!bot.tools.length) return 'No tools yet. Pick them in Tools.';
  const readCalendar = bot.tools.some(name => name === 'outlook_list_events' || name === 'outlook_get_event');
  const readMail = bot.tools.some(name => name === 'outlook_list_messages' || name === 'outlook_read_message');
  const parts: string[] = [];
  if (readCalendar || readMail) parts.push('Reads your Outlook ' + (readCalendar && readMail ? 'calendar and mail' : readCalendar ? 'calendar' : 'mail'));
  if (bot.tools.includes('outlook_search_people')) parts.push('Searches your employee directory');
  if (bot.tools.some(name => HYPER_BOTS_TOOLS[name].group === 'outlook-calendar' && HYPER_BOTS_TOOLS[name].access === 'write')) parts.push('Manages Outlook meetings');
  if (bot.tools.some(name => HYPER_BOTS_TOOLS[name].group === 'outlook-mail' && HYPER_BOTS_TOOLS[name].access === 'write')) parts.push('Drafts and sends Outlook mail');
  if (bot.tools.includes('jira_create_issue')) parts.push('Creates Jira issues');
  return parts.join(' · ');
}
export function hyperBotStoredRoom(userId: string): string | undefined { try { return localStorage.getItem('hypertask.hyper-bot.room.' + userId) || undefined; } catch { return undefined; } }
export function hyperBotRememberRoom(userId: string, roomId: string) { try { localStorage.setItem('hypertask.hyper-bot.room.' + userId, roomId); } catch { /* Storage can be disabled. */ } }
