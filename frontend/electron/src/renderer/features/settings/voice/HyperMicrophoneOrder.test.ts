import { describe, expect, it } from 'vitest';
import { microphoneOrder, moveMicrophone, preferredMicrophoneId, rememberMicrophones } from './HyperMicrophoneOrder';

describe('microphone priority', () => {
  it('uses the first connected microphone and falls back to system default', () => {
    const base = microphoneOrder({ voiceMicrophones: [], voiceMicrophone: '' });
    const devices = [{ deviceId: 'one', label: 'Desk mic' }, { deviceId: 'two', label: 'Headset' }];
    const known = rememberMicrophones(base, devices);
    const preferred = moveMicrophone(known, 'device:two', -2);
    expect(preferredMicrophoneId(preferred, devices)).toBe('two');
    expect(preferredMicrophoneId(preferred, [devices[0]!])).toBe('');
  });
});
