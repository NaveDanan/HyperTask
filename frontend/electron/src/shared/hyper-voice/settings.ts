// Voice settings, copied from t3code (packages/contracts/src/settings.ts: VoiceShortcutMode, VoiceMicrophoneEntry,
// VoiceTranscriptionDestination and the voice fields of ClientSettingsSchema and ServerSettings).
// Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md.
// Adapted for HyperTask by NaveDanan: HyperTask has one environment (this app), so destinations carry no environment
// id; the project dictionary and per-provider cleanup model become the Settings → AI endpoint's model.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CloudSpeechModelId,
  SpeechAcceleration,
  SpeechCorrectionCue,
  SpeechCustomWords,
  SpeechLanguage,
  SpeechModelUnloadTimeout,
  SpeechPostProcessingPromptSettings,
} from "./speech";

export const VoiceShortcutMode = Schema.Literals(["auto", "hold", "toggle"]);
export type VoiceShortcutMode = typeof VoiceShortcutMode.Type;

export const VoiceMicrophoneEntry = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("default") }),
  Schema.Struct({ kind: Schema.Literal("device"), deviceId: Schema.String, label: Schema.String }),
]);
export type VoiceMicrophoneEntry = typeof VoiceMicrophoneEntry.Type;

/**
 * Where this device sends microphone audio: HyperTask's own local model ("environment"), or a cloud provider that
 * HyperTask forwards the recording to. An OpenRouter grant also names the exact model, since OpenRouter has no default.
 */
export const VoiceTranscriptionDestination = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("environment") }),
  Schema.Struct({
    kind: Schema.Literal("cloud"),
    provider: Schema.Literals(["openai", "xai"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("cloud"),
    provider: Schema.Literal("openrouter"),
    model: CloudSpeechModelId,
  }),
]);
export type VoiceTranscriptionDestination = typeof VoiceTranscriptionDestination.Type;

/** Device-local voice preferences (t3code's ClientSettings voice fields). The renderer keeps them. */
export const HyperVoiceClientSettings = Schema.Struct({
  // Superseded by voiceMicrophones; read only to seed an empty order.
  voiceMicrophone: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  // Device-local microphone order. Recording uses the first connected entry.
  voiceMicrophones: Schema.Array(VoiceMicrophoneEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  voiceShortcutMode: VoiceShortcutMode.pipe(Schema.withDecodingDefault(Effect.succeed("auto"))),
  speechLanguage: SpeechLanguage.pipe(Schema.withDecodingDefault(Effect.succeed("auto"))),
  speechTranslateToEnglish: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  speechCustomWords: SpeechCustomWords.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  speechSilenceFiltering: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  speechStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  speechRemoveFillerWords: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  speechPostProcessingPrompt: SpeechPostProcessingPromptSettings.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({ mode: "default" as const, customInstructions: "" }),
    ),
  ),
  speechCorrectionWord: SpeechCorrectionCue.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type HyperVoiceClientSettings = typeof HyperVoiceClientSettings.Type;
export const DEFAULT_HYPER_VOICE_CLIENT_SETTINGS: HyperVoiceClientSettings =
  Schema.decodeSync(HyperVoiceClientSettings)({});

/** The machine's voice settings (t3code's ServerSettings voice fields). The main process keeps them. */
export const HyperVoiceMachineSettings = Schema.Struct({
  speechModelId: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("handy-computer/parakeet-unified-en-0.6b-gguf")),
  ),
  speechAcceleration: SpeechAcceleration.pipe(Schema.withDecodingDefault(Effect.succeed("auto"))),
  speechModelUnloadTimeout: SpeechModelUnloadTimeout.pipe(
    Schema.withDecodingDefault(Effect.succeed("min_15")),
  ),
  // Null follows the Settings → AI endpoint's model; a name pins transcript cleanup to another model of that endpoint.
  speechPostProcessingModel: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type HyperVoiceMachineSettings = typeof HyperVoiceMachineSettings.Type;
