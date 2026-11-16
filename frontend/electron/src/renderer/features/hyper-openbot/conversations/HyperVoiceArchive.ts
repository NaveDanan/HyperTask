// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
import { hyperOpenBotFetch, hyperOpenBotRequest, HYPER_OPENBOT_ORIGIN } from '../transport';
import { rememberVoiceCall, forgetVoiceCall, hyperVoiceIdentityEpoch } from './HyperVoiceOutbox';
import type { SaveHyperVoiceSessionInput, HyperVoiceSessionRecord, HyperVoiceSessionPage } from './HyperVoiceContracts';
import { closingOf } from './HyperVoiceCut';
const saving = new Map<string, Promise<HyperVoiceSessionRecord>>();
/** Deduplicate only within the captured owner/channel/identity epoch. */
export function hyperSaveVoiceTranscript(call: SaveHyperVoiceSessionInput, owner: string, epoch = hyperVoiceIdentityEpoch()): Promise<HyperVoiceSessionRecord> {
  const current = () => { if (epoch !== hyperVoiceIdentityEpoch()) throw new Error('The signed-in profile changed.'); };
  if (epoch !== hyperVoiceIdentityEpoch()) return Promise.reject(new Error('The signed-in profile changed.'));
  const key = JSON.stringify([epoch, owner, call.channelId, call.id]); const running = saving.get(key); if (running) return running;
  rememberVoiceCall(call, owner, epoch);
  const promise = (async () => {
    const me = await hyperOpenBotRequest<{ user: { id: string } }>('/api/me');
    current();
    if (me.user.id !== owner) throw new Error('The voice transcript belongs to another signed-in account.');
    const response = await hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + '/api/voice/sessions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-openbot-voice': '1' }, body: JSON.stringify(call), signal: AbortSignal.timeout(30_000) });
    const body = await response.json().catch(() => ({}));
    current();
    // Upstream may return a saved session with a non-2xx summary/refusal result. The transcript is saved.
    if (!body.session || body.session.id !== call.id || body.session.channelId !== call.channelId) throw new Error('Could not save this voice chat.');
    forgetVoiceCall(call, owner, epoch); return body.session as HyperVoiceSessionRecord;
  })().finally(() => saving.delete(key));
  saving.set(key, promise); return promise;
}

/** The pinned server paginates in ascending startedAt/id order. */
export async function hyperLoadVoiceHistory(channelId: string, assertCurrent: () => void): Promise<HyperVoiceSessionRecord[]> {
  const result: HyperVoiceSessionRecord[] = [];
  let cursor: string | null = null;
  const cursors = new Set<string>();
  do {
    assertCurrent();
    const params = new URLSearchParams({ channelId });
    if (cursor) params.set('cursor', cursor);
    const page = await hyperOpenBotRequest<HyperVoiceSessionPage>(`/api/voice/sessions?${params}`);
    assertCurrent();
    if (page.sessions.some(call => call.channelId !== channelId)) throw new Error('Voice history belongs to another conversation.');
    result.push(...page.sessions);
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('Voice history returned a repeated cursor.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return result;
}

export function hyperVoiceHistoryContext(calls: readonly HyperVoiceSessionRecord[]): string {
  return closingOf(calls.slice(-12).map(call => `Voice chat (${call.startedAt}):\n${call.transcript.map(line => `${line.role}: ${line.text}`).join('\n')}`).join('\n\n'), 12000);
}
