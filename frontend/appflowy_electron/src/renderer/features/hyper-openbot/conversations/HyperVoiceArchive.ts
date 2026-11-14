// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
import { hyperOpenBotFetch, hyperOpenBotRequest, HYPER_OPENBOT_ORIGIN } from '../transport';
import { rememberVoiceCall, forgetVoiceCall } from './HyperVoiceOutbox';
import type { SaveHyperVoiceSessionInput, HyperVoiceSessionRecord } from './HyperVoiceContracts';
const saving = new Map<string, Promise<HyperVoiceSessionRecord>>();
/** Deduplicate retries across native page navigation; the durable record remains owner-scoped. */
export function hyperSaveVoiceTranscript(call: SaveHyperVoiceSessionInput, owner: string): Promise<HyperVoiceSessionRecord> {
  const key = JSON.stringify([owner, call.id]); const running = saving.get(key); if (running) return running;
  rememberVoiceCall(call, owner);
  const promise = (async () => {
    const me = await hyperOpenBotRequest<{ user: { id: string } }>('/api/me');
    if (me.user.id !== owner) throw new Error('The voice transcript belongs to another signed-in account.');
    const response = await hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + '/api/voice/sessions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-openbot-voice': '1' }, body: JSON.stringify(call), signal: AbortSignal.timeout(30_000) });
    const body = await response.json().catch(() => ({}));
    // Upstream may return a saved session with a non-2xx summary/refusal result. The transcript is saved.
    if (!body.session || body.session.id !== call.id || body.session.channelId !== call.channelId) throw new Error('Could not save this voice chat.');
    forgetVoiceCall(call, owner); return body.session as HyperVoiceSessionRecord;
  })().finally(() => saving.delete(key));
  saving.set(key, promise); return promise;
}
