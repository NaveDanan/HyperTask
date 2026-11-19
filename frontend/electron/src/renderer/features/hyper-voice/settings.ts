// Device-local voice preferences, the voice part of t3code's client settings (apps/web/src/hooks/useSettings.ts:
// useClientSettings and updateClientSettings). Copyright (c) 2026 T3 Tools Inc., MIT License.
// See src/shared/hyper-voice/NOTICE.md. HyperTask keeps them in this window's localStorage.
import * as Equal from 'effect/Equal';
import * as Schema from 'effect/Schema';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  DEFAULT_HYPER_VOICE_CLIENT_SETTINGS,
  HyperVoiceClientSettings,
} from '@shared/hyper-voice/settings';

export type ClientSettings = HyperVoiceClientSettings;
export type ClientSettingsPatch = Partial<ClientSettings>;

const STORAGE_KEY = 'hypertask.voice.settings.v1';
const decode = Schema.decodeUnknownSync(HyperVoiceClientSettings);
const encode = Schema.encodeSync(HyperVoiceClientSettings);

function read(): ClientSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? decode(JSON.parse(raw)) : DEFAULT_HYPER_VOICE_CLIENT_SETTINGS;
  } catch {
    return DEFAULT_HYPER_VOICE_CLIENT_SETTINGS;
  }
}

let snapshot: ClientSettings | undefined;
const listeners = new Set<() => void>();

export function getClientSettings(): ClientSettings {
  snapshot ??= read();
  return snapshot;
}

export function subscribeClientSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another window (or a test) that writes the key is picked up here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = read();
    for (const listener of listeners) listener();
  });
}

export function updateClientSettings(patch: ClientSettingsPatch): Promise<void> {
  const next = decode(encode({ ...getClientSettings(), ...patch }));
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encode(next)));
  } catch {
    // Storage can be full or unavailable; the change still applies for this session.
  }
  for (const listener of listeners) listener();
  return Promise.resolve();
}

const selectAll = (settings: ClientSettings) => settings;

/** Structurally equal selections retain their reference and skip rendering. */
export function useClientSettings<T = ClientSettings>(selector?: (settings: ClientSettings) => T): T {
  const select = (selector ?? selectAll) as (settings: ClientSettings) => T;
  const latest = useRef(select);
  latest.current = select;
  const cache = useRef<{ source: ClientSettings; select: unknown; value: T } | null>(null);
  const getSelection = useCallback(() => {
    const source = getClientSettings();
    const current = latest.current;
    const previous = cache.current;
    if (previous && previous.source === source && previous.select === current) return previous.value;
    const value = current(source);
    const kept = previous && Equal.equals(previous.value, value) ? previous.value : value;
    cache.current = { source, select: current, value: kept };
    return kept;
  }, []);
  return useSyncExternalStore(subscribeClientSettings, getSelection, getSelection);
}

/** Client settings load synchronously from localStorage, so they are always hydrated. */
export function useClientSettingsHydrated(): boolean {
  return true;
}
