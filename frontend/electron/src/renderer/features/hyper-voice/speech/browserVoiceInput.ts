// Copied from t3code (apps/web/src/speech/browserVoiceInput.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: requests go to the main process (no connection), and live audio streams over IPC.
import { cloudSpeechLanguages, effectiveSpeechLanguage } from "@shared/hyper-voice/speechShared";
import {
  requireCloudSpeechKey,
  transcribeCloudPcm,
  getEnvironmentSpeechStatus,
  openSpeechStream,
  throwIfVoiceTranscriptionAborted,
  transcribeEnvironmentPcm,
  type VoiceInputErrorCode,
  VoiceTranscriptionError,
  type VoiceTranscriptionOptions,
} from "../runtime";
import type {
  CloudSpeechModelId,
  CloudSpeechProvider,
  SpeechStreamText,
  SpeechTranscriptionOptions,
} from "@shared/hyper-voice/speech";
import * as Schema from "effect/Schema";

import { createBrowserPcmCapture } from "./browserPcmCapture";
import { HyperVoiceRequestError, runEnvironmentSpeech } from "../environment";
import { m, msg } from "../gt";

const isVoiceTranscriptionError = Schema.is(VoiceTranscriptionError);
const isHyperVoiceRequestError = Schema.is(HyperVoiceRequestError);

export function createBrowserVoiceInputPlatform(input: {
  readonly cloudProvider?: CloudSpeechProvider | undefined;
  /** The exact OpenRouter model the grant names; required with that provider. */
  readonly cloudModel?: CloudSpeechModelId | undefined;
  readonly hasAudioConsent: () => boolean;
  readonly getTranscriptionOptions: () => SpeechTranscriptionOptions;
  readonly getStreamingEnabled: () => boolean;
  readonly getMicrophoneId: () => string | Promise<string>;
  readonly onLevel: (level: number) => void;
  readonly onDurationLimit: () => void;
  readonly onText: (text: SpeechStreamText) => void;
  readonly onError: (message: string, code?: VoiceInputErrorCode) => void;
}) {
  return createBrowserPcmCapture(input, async (options) => {
    const recordingOptions = input.getTranscriptionOptions();
    const streamingEnabled = input.getStreamingEnabled();
    const transcribeRecording = async (
      uri: string,
      { signal: transcriptionSignal }: VoiceTranscriptionOptions,
    ) => {
      try {
        const response = await fetch(uri, { signal: transcriptionSignal });
        const pcm = new Uint8Array(await response.arrayBuffer());
        const result = await runEnvironmentSpeech(
          input.cloudProvider
            ? transcribeCloudPcm(
                input.cloudProvider,
                pcm,
                recordingOptions,
                input.hasAudioConsent,
                input.cloudModel,
              )
            : transcribeEnvironmentPcm(pcm, recordingOptions, input.hasAudioConsent),
          { signal: transcriptionSignal },
        );
        throwIfVoiceTranscriptionAborted(transcriptionSignal);
        return result.text;
      } catch (cause) {
        throwIfVoiceTranscriptionAborted(transcriptionSignal);
        if (isVoiceTranscriptionError(cause)) throw cause;
        // t3code's client turns a cloud provider's own error into the transcription error; main sends its text.
        if (input.cloudProvider && isHyperVoiceRequestError(cause))
          throw new VoiceTranscriptionError({ code: "transcription-failed", message: cause.message });
        throw new VoiceTranscriptionError({
          code: "transcription-failed",
          message: m(msg("Voice transcription failed. Check the destination in Settings → Voice.")),
          cause,
        });
      }
    };
    if (input.cloudProvider) {
      if (input.cloudProvider === "openrouter" && !input.cloudModel)
        throw new VoiceTranscriptionError({
          code: "unavailable",
          message: m(msg("Choose an OpenRouter model in Settings → Voice.")),
        });
      await runEnvironmentSpeech(requireCloudSpeechKey(input.cloudProvider), options).catch(
        (cause: unknown) => {
          throw isHyperVoiceRequestError(cause)
            ? new VoiceTranscriptionError({ code: "unavailable", message: cause.message })
            : cause;
        },
      );
      throwIfVoiceTranscriptionAborted(options.signal);
      return {
        locale: effectiveSpeechLanguage(cloudSpeechLanguages, recordingOptions.speechLanguage),
        transcribe: transcribeRecording,
      };
    }
    const status = await runEnvironmentSpeech(getEnvironmentSpeechStatus(), options);
    throwIfVoiceTranscriptionAborted(options.signal);
    if (!status.supported)
      throw new VoiceTranscriptionError({ code: "unavailable", message: status.reason });
    const language = status.languages
      ? effectiveSpeechLanguage(
          {
            languages: status.languages,
            supportsLanguageDetection: status.supportsLanguageDetection ?? false,
          },
          recordingOptions.speechLanguage,
        )
      : "auto";
    const nativeStreaming = status.supportsStreaming && streamingEnabled;
    const locale =
      !nativeStreaming && status.supportsTranslation && recordingOptions.speechTranslateToEnglish
        ? "en"
        : language;
    if (status.supportsStreaming ? !nativeStreaming : !status.supportsBufferedStreaming) {
      return { locale, transcribe: transcribeRecording };
    }
    return {
      locale,
      transcribe: transcribeRecording,
      streaming: openSpeechStream({
        canSend: input.hasAudioConsent,
        options: recordingOptions,
        signal: options.signal,
        onText: input.onText,
        onError: (error) => input.onError(error.message),
      }),
    };
  });
}
