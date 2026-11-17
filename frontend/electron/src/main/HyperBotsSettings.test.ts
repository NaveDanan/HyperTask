import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));
import { HYPER_BOTS_DEFAULT_SETTINGS, hyperBotsWithDirectRooms } from '@shared/HyperBots';
import { HyperBotsArgs } from './HyperBotsIpc';
import { HyperBotsRuntime } from './HyperBotsRuntime';
import { HyperBotsStore } from './HyperBotsStore';
const create = () => {
  const store = new HyperBotsStore(null);
  const runtime = new HyperBotsRuntime({ store, engine: { complete: vi.fn() }, tools: { get: () => undefined, specs: () => [] }, defaultModel: async () => 'default' });
  return { runtime, store };
};
it('Runtime and IPC accept avatar/mode/kind and 24 rooms, normalize saved settings and preserve defaults', () => {
  const { runtime, store } = create(), input = hyperBotsWithDirectRooms(structuredClone(HYPER_BOTS_DEFAULT_SETTINGS));
  for (let i = 2; i < 8; i++) input.bots.push({ ...input.bots[0]!, id: 'bot-' + i, name: 'Bot ' + i });
  const settings = hyperBotsWithDirectRooms(input);
  for (let i = 1; i < 16; i++) settings.rooms.push({ id: 'group-' + i, name: 'Group ' + i, kind: 'group', botIds: ['scout', 'scribe'] });
  expect(settings.rooms).toHaveLength(24);
  expect(HyperBotsArgs.settings.safeParse(settings).success).toBe(true);
  expect(runtime.saveSettings(settings)).toEqual(settings);
  expect(store.settings()).toEqual(settings);
  expect(runtime.settings()).toEqual(settings);
  expect(create().runtime.settings()).toEqual(hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS));
  const over = { ...settings, rooms: [...settings.rooms, { id: 'overflow', name: 'Overflow', botIds: [] }] };
  expect(HyperBotsArgs.settings.safeParse(over).success).toBe(false);
  expect(() => runtime.saveSettings(over)).toThrow();
});
it.each(['bad shape', 'two bots direct', 'duplicate direct'] as const)('both settings schemas reject %s', invalid => {
  const settings = hyperBotsWithDirectRooms(structuredClone(HYPER_BOTS_DEFAULT_SETTINGS));
  if (invalid === 'bad shape') (settings.bots[0]!.avatar as { shape: string }).shape = 'banana';
  if (invalid === 'two bots direct') settings.rooms.find(room => room.id === 'dm-scout')!.botIds = ['scout', 'scribe'];
  if (invalid === 'duplicate direct') settings.rooms.push({ id: 'duplicate', name: 'Duplicate', kind: 'direct', botIds: ['scout'] });
  expect(HyperBotsArgs.settings.safeParse(settings).success).toBe(false);
  expect(() => create().runtime.saveSettings(settings)).toThrow();
});
it('normalizes legacy groups and direct rooms on both read and save without changing the state paths', () => {
  const { runtime, store } = create(), legacy = structuredClone(HYPER_BOTS_DEFAULT_SETTINGS);
  delete legacy.rooms[0]!.kind;
  store.saveSettings(legacy);
  expect(runtime.settings()).toEqual(hyperBotsWithDirectRooms(legacy));
  expect(runtime.saveSettings(legacy)).toEqual(hyperBotsWithDirectRooms(legacy));
  expect(store.settings()).toEqual(hyperBotsWithDirectRooms(legacy));
});
