import { hyperBotUniqueId, hyperBotsWithDirectRooms, HYPER_BOTS_TOOL_CONNECTIONS, HYPER_BOTS_TOOLS, type HyperBotConfig, type HyperBotsSettings, type HyperBotsToolConnection, type HyperBotsToolGroup, type HyperBotsToolName } from '@shared/HyperBots';
export { hyperBotCreateGroup, hyperBotUniqueId } from '@shared/HyperBots';
export const HYPER_BOT_TOOL_ORDER = Object.keys(HYPER_BOTS_TOOLS) as HyperBotsToolName[];
export function hyperBotConnectionTools(connection: HyperBotsToolConnection) {
  const groups: readonly HyperBotsToolGroup[] = HYPER_BOTS_TOOL_CONNECTIONS[connection].groups;
  return HYPER_BOT_TOOL_ORDER.filter(tool => groups.includes(HYPER_BOTS_TOOLS[tool].group));
}
export function hyperBotCreate(settings: HyperBotsSettings, input: Pick<HyperBotConfig, 'name' | 'avatar' | 'mode' | 'permissionLevel'> & Partial<Pick<HyperBotConfig, 'instructions' | 'model' | 'tools'>>) {
  if (settings.bots.length >= 8) throw new Error('You can have up to 8 bots. Edit or delete a bot to make room.');
  const name = input.name.trim();
  if (!name || name.length > 40) throw new Error('Give your bot a name (up to 40 characters).');
  const id = hyperBotUniqueId(name, settings.bots.map(bot => bot.id));
  const defaultInstructions = input.mode === 'teammate'
    ? 'You are ' + name + ', a teammate bot in HyperTask. Work with the other bots and hand off when another bot fits better.'
    : 'You are ' + name + ", the owner's personal assistant in HyperTask. Use your enabled tools when asked and summarize the results.";
  const bot: HyperBotConfig = {
    ...input, name, id, instructions: input.instructions?.trim() || defaultInstructions,
    model: input.model ?? '', tools: input.tools ?? [], permissionLevel: input.permissionLevel ?? 'supervised',
  };
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
  if (!bot.tools.length) return 'Enable a connection in Bot settings to add tools.';
  const readCalendar = bot.tools.some(name => name === 'outlook_list_events' || name === 'outlook_get_event');
  const readMail = bot.tools.some(name => name === 'outlook_list_messages' || name === 'outlook_read_message');
  const parts: string[] = [];
  if (readCalendar || readMail) parts.push('Reads your Outlook ' + (readCalendar && readMail ? 'calendar and mail' : readCalendar ? 'calendar' : 'mail'));
  if (bot.tools.includes('outlook_search_people')) parts.push('Searches your employee directory');
  if (bot.tools.some(name => HYPER_BOTS_TOOLS[name].group === 'outlook-calendar' && HYPER_BOTS_TOOLS[name].access === 'write')) parts.push('Manages Outlook meetings');
  if (bot.tools.some(name => HYPER_BOTS_TOOLS[name].group === 'outlook-mail' && HYPER_BOTS_TOOLS[name].access === 'write')) parts.push('Drafts and sends Outlook mail');
  if (bot.tools.some(name => HYPER_BOTS_TOOLS[name].group === 'jira')) parts.push('Works with Jira issues');
  if (bot.tools.some(name => HYPER_BOTS_TOOLS[name].group === 'newsletter')) parts.push('Works with newsletters and Gantt projects');
  if (bot.tools.some(name => HYPER_BOTS_TOOLS[name].group === 'hypertask-projects')) parts.push('Works with HyperTask Kanban and Gantt');
  return parts.join(' · ');
}
export function hyperBotStoredRoom(userId: string): string | undefined { try { return localStorage.getItem('hypertask.hyper-bot.room.' + userId) || undefined; } catch { return undefined; } }
export function hyperBotRememberRoom(userId: string, roomId: string) { try { localStorage.setItem('hypertask.hyper-bot.room.' + userId, roomId); } catch { /* Storage can be disabled. */ } }
