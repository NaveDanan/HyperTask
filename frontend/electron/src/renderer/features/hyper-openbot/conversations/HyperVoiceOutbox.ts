// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// HyperTask adaptation by NaveDanan: transcript recovery lasts only for this renderer session.
import type { HyperOpenBotServiceState } from '@shared/HyperOpenBotService';
import type { SaveHyperVoiceSessionInput } from './HyperVoiceContracts';

let epoch = 0;
let observingIdentity = false;
const pending = new Map<string, SaveHyperVoiceSessionInput>();
const listeners = new Set<() => void>();
const key = (call: Pick<SaveHyperVoiceSessionInput, 'channelId' | 'id'>, owner: string, identityEpoch: number) => JSON.stringify([identityEpoch, owner, call.channelId, call.id]);
const changed = () => { for (const listener of listeners) listener(); };
export const hyperVoiceIdentityEpoch = () => epoch;
export function hyperSubscribeVoiceRecovery(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Keep listening after Chat unmounts, so sign-out elsewhere clears every pending transcript. */
export function hyperObserveVoiceIdentity(subscribe: (listener: (state: HyperOpenBotServiceState) => void) => () => void) {
  if (observingIdentity) return;
  subscribe(state => {
    if (!['signed_out', 'profile_required', 'unsupported'].includes(state.problem)) return;
    epoch++;
    pending.clear();
    changed();
  });
  observingIdentity = true;
}

/** No localStorage, audio, reload recovery or process-exit persistence. */
export function rememberVoiceCall(call: SaveHyperVoiceSessionInput, owner: string | undefined, identityEpoch = epoch): boolean {
  if (!owner || identityEpoch !== epoch) return false;
  pending.set(key(call, owner, identityEpoch), structuredClone(call));
  changed();
  return true;
}
export function forgetVoiceCall(call: Pick<SaveHyperVoiceSessionInput, 'channelId' | 'id'>, owner: string | undefined, identityEpoch = epoch) {
  if (owner && identityEpoch === epoch && pending.delete(key(call, owner, identityEpoch))) changed();
}
export function recoverVoiceCalls(channelId: string, owner: string | undefined, identityEpoch = epoch): SaveHyperVoiceSessionInput[] {
  if (!owner || identityEpoch !== epoch) return [];
  return [...pending.entries()].filter(([name]) => {
    const [savedEpoch, savedOwner, savedChannel] = JSON.parse(name);
    return savedEpoch === identityEpoch && savedOwner === owner && savedChannel === channelId;
  }).map(([, call]) => structuredClone(call));
}
