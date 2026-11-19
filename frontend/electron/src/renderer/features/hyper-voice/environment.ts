// The voice endpoints of t3code's client runtime (packages/client-runtime/src/voice-input/environment.ts and
// apps/web/src/speech/runEnvironmentSpeech.ts), Copyright (c) 2026 T3 Tools Inc., MIT License.
// See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: every call goes to the Electron main process over IPC (window.hypertask.hyperVoice)
// instead of an authenticated environment HTTP request, so the functions take no connection.
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { IpcResult } from '@shared/api';
import type {
  CloudSpeechModelId,
  CloudSpeechProvider,
  EnvironmentSpeechPostProcessingRequest,
  SpeechAcceleration,
  SpeechModelUnloadTimeout,
  SpeechPostProcessingOptions,
  SpeechTranscriptionOptions,
} from '@shared/hyper-voice/speech';
import { CloudSpeechError } from '@shared/hyper-voice/speech';

/** A voice request main refused or could not complete; `message` is written for the person. */
export class HyperVoiceRequestError extends Schema.TaggedError<HyperVoiceRequestError>()('HyperVoiceRequestError', {
  kind: Schema.String,
  message: Schema.String,
}) {}

const voice = () => window.hypertask.hyperVoice;

const request = <A>(run: () => Promise<IpcResult<A>>, canSend?: () => boolean) =>
  Effect.suspend(() =>
    canSend?.() === false
      ? Effect.interrupt
      : Effect.tryPromise({
          try: run,
          catch: (cause) =>
            new HyperVoiceRequestError({ kind: 'other', message: cause instanceof Error ? cause.message : String(cause) }),
        }).pipe(
          Effect.flatMap((result) =>
            result.ok ? Effect.succeed(result.value) : Effect.fail(new HyperVoiceRequestError({ kind: result.kind, message: result.message })),
          ),
        ),
  );

export const getEnvironmentSpeechStatus = () => request(() => voice().status());

export const getCloudSpeechKeys = () => request(() => voice().cloudKeys());

export const getCloudSpeechModels = () => request(() => voice().cloudModels());

export const requireCloudSpeechKey = (provider: CloudSpeechProvider) =>
  getCloudSpeechKeys().pipe(
    Effect.flatMap((keys) =>
      keys[provider]
        ? Effect.void
        : Effect.fail(
            new HyperVoiceRequestError({
              kind: 'state',
              message: new CloudSpeechError({ provider, reason: 'missing-key' }).message,
            }),
          ),
    ),
  );

export const setCloudSpeechKey = (provider: CloudSpeechProvider, key: string | null) =>
  request(() => voice().setCloudKey(provider, key));

export const transcribeCloudPcm = (
  provider: CloudSpeechProvider,
  pcm: Uint8Array,
  options: SpeechTranscriptionOptions,
  canSend: () => boolean,
  model?: CloudSpeechModelId,
) => request(() => voice().transcribeCloud(provider, pcm, options, model), canSend);

export const getEnvironmentSpeechModels = (includeBenchmarks = false) =>
  request(() => voice().models(includeBenchmarks));

export const downloadEnvironmentSpeechModel = (modelId: string) => request(() => voice().downloadModel(modelId));

export const selectEnvironmentSpeechModel = (modelId: string) => request(() => voice().selectModel(modelId));

export const cancelEnvironmentSpeechModelDownload = (modelId: string) =>
  request(() => voice().cancelModelDownload(modelId));

export const prepareEnvironmentSpeechModel = () => request(() => voice().prepareModel());

export const transcribeEnvironmentPcm = (
  pcm: Uint8Array,
  options: SpeechTranscriptionOptions,
  canSend: () => boolean,
) => request(() => voice().transcribe(pcm, options), canSend);

/** Sends the transcript and draft context to the Settings → AI endpoint; a separate opt-in. */
export const postProcessEnvironmentTranscript = (
  transcript: string,
  draft: {
    readonly text: string;
    readonly selection: { readonly start: number; readonly end: number };
  },
  options: SpeechPostProcessingOptions,
  canSend: () => boolean,
) => {
  const payload: EnvironmentSpeechPostProcessingRequest = { transcript, draft, options };
  return request(() => voice().postProcess(payload), canSend);
};

export const updateEnvironmentSpeechAcceleration = (acceleration: SpeechAcceleration) =>
  request(() => voice().updateAcceleration(acceleration));

export const updateEnvironmentSpeechModelUnloadTimeout = (timeout: SpeechModelUnloadTimeout) =>
  request(() => voice().updateModelUnloadTimeout(timeout));

export const linkEnvironmentSpeechModels = (path: string) => request(() => voice().linkModels(path));

export const pickEnvironmentSpeechModelPath = (kind: 'file' | 'folder') => request(() => voice().pickModelPath(kind));

export const removeEnvironmentSpeechModel = (modelId: string) => request(() => voice().removeModel(modelId));

export const getSpeechCleanupModels = () => request(() => voice().cleanupModels());

export const setSpeechCleanupModel = (model: string | null) => request(() => voice().setCleanupModel(model));

/** runEnvironmentSpeech: HyperTask's requests need no connection runtime, so this only runs the effect. */
export function runEnvironmentSpeech<A, E>(effect: Effect.Effect<A, E>, options?: Effect.RunOptions): Promise<A> {
  return Effect.runPromise(effect, options);
}
