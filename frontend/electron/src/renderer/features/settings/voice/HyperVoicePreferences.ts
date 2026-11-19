import { microphoneOrder, preferredMicrophoneId, rememberMicrophones, type MicrophoneEntry } from './HyperMicrophoneOrder';

const KEY = 'hypertask.voice.microphones';
export function readMicrophones(): MicrophoneEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    const entries = Array.isArray(value) ? value.filter((v): v is MicrophoneEntry =>
      v && (v.kind === 'default' || (v.kind === 'device' && typeof v.deviceId === 'string' && typeof v.label === 'string'))) : [];
    return [...microphoneOrder({ voiceMicrophones: entries, voiceMicrophone: '' })];
  } catch { return [{ kind: 'default' }]; }
}
export function saveMicrophones(entries: readonly MicrophoneEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(entries));
}
export async function chooseRecordingMicrophone(): Promise<string> {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const inputs = devices.filter(device => device.kind === 'audioinput');
  const order = rememberMicrophones(readMicrophones(), inputs);
  saveMicrophones(order);
  return preferredMicrophoneId(order, inputs);
}
