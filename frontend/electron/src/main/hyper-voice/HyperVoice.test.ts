import * as NodeFs from 'node:fs/promises';
import * as NodeOs from 'node:os';
import * as NodePath from 'node:path';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { describe, expect, it, vi } from 'vitest';
import { CloudSpeechError, DEFAULT_SPEECH_POST_PROCESSING_PROMPT } from '@shared/hyper-voice/speech';

vi.mock('electron', () => ({ dialog: {}, ipcMain: {}, net: {} }));
const { hyperVoiceFailure } = await import('./HyperVoiceIpc');
const SpeechPostProcessing = await import('./postProcessing');
const SpeechService = await import('./SpeechService');
const VoiceSettings = await import('./VoiceSettings');

const request = (transcript: string) => ({
  transcript,
  draft: { text: 'Notes: ', selection: { start: 7, end: 7 } },
  options: {
    speechCustomWords: [{ term: 'HyperTask', aliases: ['hyper task'] }],
    speechPostProcessingPrompt: { mode: 'default' as const, customInstructions: '' },
    speechCorrectionWord: 'sorry',
  },
});

const cleanup = (complete: (prompt: string) => Promise<string>) =>
  SpeechPostProcessing.layer.pipe(
    Layer.provide(Layer.succeed(SpeechPostProcessing.TranscriptCleanupModel, { complete: (prompt) => complete(prompt) })),
  );
const process = (layer: ReturnType<typeof cleanup>, transcript: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* SpeechPostProcessing.SpeechPostProcessing).process(request(transcript));
    }).pipe(Effect.provide(layer)),
  );

describe('transcript cleanup', () => {
  it('sends t3code\'s prompt to the endpoint and applies dictionary spellings to the answer', async () => {
    const complete = vi.fn(async (_prompt: string) => '  Meet the hyper task team at 4.  ');
    const result = await process(cleanup(complete), 'meet the hyper task team at three sorry four');
    expect(result.text).toBe('Meet the HyperTask team at 4.');
    const prompt = complete.mock.calls[0]![0] as string;
    expect(prompt.startsWith(DEFAULT_SPEECH_POST_PROCESSING_PROMPT)).toBe(true);
    expect(prompt).toContain('Correction cue: "sorry"');
    expect(prompt).toContain('<transcript>\nmeet the hyper task team at three sorry four\n</transcript>');
    expect(prompt).toContain('<composer_before>\nNotes: \n</composer_before>');
  });

  it('keeps the original transcript when the endpoint answers with nothing, and skips empty speech', async () => {
    const complete = vi.fn(async (_prompt: string) => '   ');
    expect((await process(cleanup(complete), 'hello there')).text).toBe('hello there');
    expect((await process(cleanup(complete), '   ')).text).toBe('   ');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('reports endpoint failures as a cleanup failure with the endpoint\'s reason', async () => {
    const failing = cleanup(async () => { throw new Error('Set up the model endpoint in Settings → AI.'); });
    const error = await process(failing, 'hello').catch((cause: unknown) => cause);
    expect(hyperVoiceFailure(error).message).toBe('Transcript cleanup failed: Set up the model endpoint in Settings → AI.');
  });
});

describe('voice settings file', () => {
  it('starts from defaults, merges patches and keeps other cloud keys', async () => {
    const directory = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), 'hyper-voice-settings-'));
    const file = NodePath.join(directory, 'nested', 'settings.json');
    const run = <A>(use: (service: typeof VoiceSettings.VoiceSettingsService.Service) => Effect.Effect<A, unknown>) =>
      Effect.runPromise(
        Effect.gen(function* () { return yield* use(yield* VoiceSettings.VoiceSettingsService); }).pipe(
          Effect.provide(VoiceSettings.layer(file)),
        ),
      );
    try {
      const initial = await run((service) => service.getSettings);
      expect(initial).toMatchObject({ speechModelId: 'handy-computer/parakeet-unified-en-0.6b-gguf', speechAcceleration: 'auto', speechModelUnloadTimeout: 'min_15', speechPostProcessingModel: null, cloudSpeechCredentials: { openai: '', xai: '', openrouter: '' } });
      await run((service) => service.updateSettings({ cloudSpeechCredentials: { openai: 'blob-a' } }));
      await run((service) => service.updateSettings({ speechAcceleration: 'cpu', cloudSpeechCredentials: { xai: 'blob-b' } }));
      const saved = JSON.parse(await NodeFs.readFile(file, 'utf8'));
      expect(saved).toMatchObject({ speechAcceleration: 'cpu', cloudSpeechCredentials: { openai: 'blob-a', xai: 'blob-b', openrouter: '' } });
    } finally {
      await NodeFs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('voice failures', () => {
  it('maps speech errors to messages a person can act on', () => {
    expect(hyperVoiceFailure(new SpeechService.SpeechBusyError({ operation: 'transcription' })).message).toMatch(/^Voice input is busy\./);
    expect(hyperVoiceFailure(new SpeechService.SpeechModelNotFoundError({ modelId: 'x' })).message).toBe('That speech model is not installed. Download it in Settings → Voice.');
    expect(hyperVoiceFailure(new CloudSpeechError({ provider: 'xai', reason: 'rate-limit' })).message).toBe(new CloudSpeechError({ provider: 'xai', reason: 'rate-limit' }).message);
    expect(hyperVoiceFailure(new SpeechService.SpeechOperationError({ operation: 'model download', cause: new Error('Speech model download failed: status 404.\n    at stack') })).message).toBe('Model download failed: Speech model download failed: status 404.');
  });
});
