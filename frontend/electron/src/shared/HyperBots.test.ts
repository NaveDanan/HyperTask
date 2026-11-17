import { expect, it } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, hyperBotsWithDirectRooms } from './HyperBots';
it('migrates legacy rooms to groups and appends exactly one direct room per bot without mutation', () => {
  const settings = structuredClone(HYPER_BOTS_DEFAULT_SETTINGS);
  delete settings.rooms[0]!.kind;
  const next = hyperBotsWithDirectRooms(settings);
  expect(settings.rooms).toHaveLength(1);
  expect(settings.rooms[0]!.kind).toBeUndefined();
  expect(next.rooms).toEqual([{ ...settings.rooms[0], kind: 'group' }, { id: 'dm-scout', name: 'Scout', kind: 'direct', botIds: ['scout'] }, { id: 'dm-scribe', name: 'Scribe', kind: 'direct', botIds: ['scribe'] }]);
  expect(hyperBotsWithDirectRooms(next)).toEqual(next);
  expect(hyperBotsWithDirectRooms(settings)).toEqual(next);
});
it('keeps existing direct rooms and deterministically resolves truncated IDs and collisions', () => {
  const settings = structuredClone(HYPER_BOTS_DEFAULT_SETTINGS);
  settings.bots[0]!.id = 'a'.repeat(32); settings.rooms = [{ id: ('dm-' + 'a'.repeat(32)).slice(0, 32), name: 'Collision', botIds: [], kind: 'group' }, { id: 'custom', name: 'Existing', kind: 'direct', botIds: ['scribe'] }];
  const first = hyperBotsWithDirectRooms(settings);
  const direct = first.rooms.find(room => room.botIds[0] === settings.bots[0]!.id)!;
  expect(direct.id).toBe('dm-' + 'a'.repeat(27) + '-2');
  expect(direct.id).toHaveLength(32);
  expect(first.rooms.find(room => room.id === 'custom')).toEqual(settings.rooms[1]);
  expect(hyperBotsWithDirectRooms(settings)).toEqual(first);
  expect(hyperBotsWithDirectRooms(first)).toEqual(first);
});
it('allocates successive collision suffixes without changing group IDs', () => {
  const settings = structuredClone(HYPER_BOTS_DEFAULT_SETTINGS);
  settings.rooms.push({ id: 'dm-scout', name: 'One', botIds: [] }, { id: 'dm-scout-2', name: 'Two', botIds: [] });
  expect(hyperBotsWithDirectRooms(settings).rooms.at(-2)?.id).toBe('dm-scout-3');
});
