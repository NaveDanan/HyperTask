import { afterEach, expect, it, vi } from 'vitest';
import { rememberVoiceCall, recoverVoiceCalls, forgetVoiceCall } from './HyperVoiceOutbox';
afterEach(() => vi.unstubAllGlobals());
it('recovers only authenticated owner/channel transcripts and forgets confirmed saves', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { get length() { return values.size; }, key: (i: number) => [...values.keys()][i], getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const call = { id: 'call', channelId: 'channel', anchorMessageId: null, startedAt: '2026-09-22T12:00:00Z', endedAt: '2026-09-22T12:01:00Z', transcript: [{ id: 'turn', role: 'user' as const, text: 'Words only' }] };
  expect(rememberVoiceCall(call, undefined)).toBe(false);
  expect(rememberVoiceCall(call, 'owner')).toBe(true);
  expect(recoverVoiceCalls('channel', 'other')).toEqual([]); expect(recoverVoiceCalls('other', 'owner')).toEqual([]);
  expect(recoverVoiceCalls('channel', 'owner')).toEqual([call]);
  values.set('openbot:voice-outbox:owner:channel:bad', '{invalid'); expect(recoverVoiceCalls('channel', 'owner')).toEqual([call]);
  forgetVoiceCall(call, 'other'); expect(recoverVoiceCalls('channel', 'owner')).toEqual([call]);
  forgetVoiceCall(call, 'owner'); expect(recoverVoiceCalls('channel', 'owner')).toEqual([]);
});
