import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { HyperBotRoutine } from '@shared/HyperBots';

export const HyperBotRoutines = z.array(z.strictObject({
  id: z.uuid(),
  prompt: z.string().trim().min(1).max(4000),
  startAt: z.iso.datetime(),
  everyMinutes: z.int().min(15).max(10_080),
})).max(12).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Routine IDs must be unique.');

export function hyperBotRoutineSlot(routine: HyperBotRoutine, now: Date) {
  const start = Date.parse(routine.startAt);
  const interval = routine.everyMinutes * 60_000;
  const elapsed = now.getTime() - start;
  if (elapsed < 0 || !Number.isFinite(elapsed)) return undefined;
  return start + Math.floor(elapsed / interval) * interval;
}

export function hyperBotRoutineMessageId(botId: string, roomId: string, routine: HyperBotRoutine, slot: number) {
  const digest = createHash('sha256').update(JSON.stringify([botId, roomId, routine.id, slot])).digest('hex');
  return digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-5' + digest.slice(13, 16) + '-8' + digest.slice(17, 20) + '-' + digest.slice(20, 32);
}
