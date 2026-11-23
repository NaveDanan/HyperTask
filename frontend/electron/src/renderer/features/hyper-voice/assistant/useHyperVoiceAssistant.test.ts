import { describe, expect, it } from 'vitest';
import type { HyperAssistantBotCandidate } from '@shared/HyperAssistant';
import { sampleHyperVoiceSpectrum } from '../speech/browserPcmCapture';
import {
  computeMissingToolsForBot,
  createHyperVoiceVadTracker,
  isVoiceAssistantPinned,
  OVERLAY_SIZE_COMPACT,
  OVERLAY_SIZE_EXPANDED,
  OVERLAY_SIZE_SETUP,
  overlayBoundsForPhase,
  VOICE_VAD_INITIAL_GRACE_MS,
  VOICE_VAD_MIN_SPEECH_MS,
  VOICE_VAD_SILENCE_MS,
} from './useHyperVoiceAssistant';

describe('createHyperVoiceVadTracker', () => {
  it('fires grace-timeout when no speech occurs within the initial grace window', () => {
    const vad = createHyperVoiceVadTracker(1_000);
    expect(vad.update(0.01, 2_000)).toBe('continue');
    expect(vad.update(0.02, 6_999)).toBe('continue');
    expect(vad.hasSpoken).toBe(false);
    expect(vad.update(0.01, 1_000 + VOICE_VAD_INITIAL_GRACE_MS)).toBe('grace-timeout');
  });

  it('ignores transient clicks shorter than minSpeechMs', () => {
    const vad = createHyperVoiceVadTracker(0);
    expect(vad.update(0.3, 100)).toBe('continue');
    expect(vad.update(0.3, 100 + VOICE_VAD_MIN_SPEECH_MS - 50)).toBe('continue');
    expect(vad.update(0.01, 350)).toBe('continue');
    expect(vad.hasSpoken).toBe(false);
    expect(vad.update(0.01, 2_500)).toBe('continue');
  });

  it('auto-stops after ~1.8s of silence once real speech has occurred, resetting on resumed speech', () => {
    const vad = createHyperVoiceVadTracker(0);
    expect(vad.update(0.25, 200)).toBe('continue');
    expect(vad.update(0.28, 200 + VOICE_VAD_MIN_SPEECH_MS)).toBe('continue');
    expect(vad.hasSpoken).toBe(true);

    // Mid-sentence pause shorter than silence threshold
    expect(vad.update(0.01, 600)).toBe('continue');
    expect(vad.update(0.01, 600 + VOICE_VAD_SILENCE_MS - 300)).toBe('continue');

    // User resumes speaking -> resets silence timer
    expect(vad.update(0.22, 2_200)).toBe('continue');
    expect(vad.update(0.01, 2_400)).toBe('continue');
    expect(vad.update(0.01, 2_400 + VOICE_VAD_SILENCE_MS - 10)).toBe('continue');
    expect(vad.update(0.01, 2_400 + VOICE_VAD_SILENCE_MS)).toBe('auto-stop');
  });
});

describe('computeMissingToolsForBot & overlay helpers', () => {
  const bot = (tools: HyperAssistantBotCandidate['tools']): HyperAssistantBotCandidate => ({
    id: 'abby',
    name: 'Abby',
    handle: '@abby',
    roomId: 'dm-abby',
    mode: 'personal',
    tools,
  });

  it('detects missing Outlook calendar/mail/people tools per intent', () => {
    expect(computeMissingToolsForBot(bot(['outlook_list_events']), 'meeting', true)).toEqual([
      'outlook_create_event',
      'outlook_search_people',
    ]);
    expect(computeMissingToolsForBot(bot(['outlook_list_events']), 'meeting', false)).toEqual([
      'outlook_create_event',
      'outlook_search_people',
    ]);
    expect(
      computeMissingToolsForBot(bot(['outlook_send_message', 'outlook_search_people']), 'email', true),
    ).toEqual([]);
    expect(computeMissingToolsForBot(bot([]), 'general', true)).toEqual(['outlook_search_people']);
    expect(computeMissingToolsForBot(bot([]), 'general', false)).toEqual([]);
  });

  it('pins overlay during active listening, confirmation, and execution phases', () => {
    expect(isVoiceAssistantPinned('listening')).toBe(true);
    expect(isVoiceAssistantPinned('confirming')).toBe(true);
    expect(isVoiceAssistantPinned('executing')).toBe(true);
    expect(isVoiceAssistantPinned('idle')).toBe(false);
    expect(isVoiceAssistantPinned('done')).toBe(false);
  });

  it('returns appropriate compact/setup/expanded bounds per phase', () => {
    expect(overlayBoundsForPhase('listening')).toEqual(OVERLAY_SIZE_COMPACT);
    expect(overlayBoundsForPhase('needs-setup')).toEqual(OVERLAY_SIZE_SETUP);
    expect(overlayBoundsForPhase('confirming')).toEqual(OVERLAY_SIZE_EXPANDED);
    expect(overlayBoundsForPhase('executing')).toEqual(OVERLAY_SIZE_EXPANDED);
  });
});

describe('sampleHyperVoiceSpectrum', () => {
  it('computes rms, bass, mid, treble, peak, and downsampled bins from AnalyserNode', () => {
    const fakeAnalyser = {
      frequencyBinCount: 64,
      fftSize: 128,
      getByteFrequencyData(arr: Uint8Array) {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = i < 8 ? 255 : i < 30 ? 128 : 64;
        }
      },
      getByteTimeDomainData(arr: Uint8Array) {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = i % 2 === 0 ? 192 : 64;
        }
      },
    } as unknown as AnalyserNode;

    const freqBuf = new Uint8Array(new ArrayBuffer(64));
    const timeBuf = new Uint8Array(new ArrayBuffer(128));
    const outBins = new Float32Array(16);
    const result = sampleHyperVoiceSpectrum(fakeAnalyser, freqBuf, timeBuf, outBins);

    expect(result.bass).toBeCloseTo(1, 2);
    expect(result.mid).toBeGreaterThan(0.45);
    expect(result.treble).toBeCloseTo(64 / 255, 2);
    expect(result.peak).toBeCloseTo(0.5, 2);
    expect(result.rms).toBeGreaterThan(0.5);
    expect(outBins[0]).toBeCloseTo(1, 2);
  });
});
