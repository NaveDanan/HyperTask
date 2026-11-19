// Copied from t3code (apps/server/src/speech/postProcessing.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: the cleaned transcript comes from the Settings → AI endpoint (TranscriptCleanupModel)
// instead of a coding-agent provider, so no working directory is needed.
import {
  DEFAULT_SPEECH_POST_PROCESSING_PROMPT,
  type EnvironmentSpeechPostProcessingRequest,
} from "@shared/hyper-voice/speech";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildTranscriptionPostProcessingPrompt } from "./TranscriptionPostProcessing";
import { applySpeechAliases } from "./customWords";
import { SpeechOperationError } from "./SpeechService";

/** One prompt in, the model's text out. HyperTask serves it with the Settings → AI endpoint. */
export class TranscriptCleanupModel extends Context.Service<
  TranscriptCleanupModel,
  {
    readonly complete: (prompt: string, signal: AbortSignal) => Promise<string>;
  }
>()("hypertask/hyper-voice/TranscriptCleanupModel") {}

export class SpeechPostProcessing extends Context.Service<
  SpeechPostProcessing,
  {
    readonly process: (
      input: EnvironmentSpeechPostProcessingRequest,
    ) => Effect.Effect<{ readonly text: string }, SpeechOperationError>;
  }
>()("hypertask/hyper-voice/SpeechPostProcessing") {}

const make = Effect.gen(function* () {
  const model = yield* TranscriptCleanupModel;
  return SpeechPostProcessing.of({
    process: Effect.fn("SpeechPostProcessing.process")(
      function* (input) {
        if (input.transcript.trim().length === 0) return { text: input.transcript };
        const { mode, customInstructions } = input.options.speechPostProcessingPrompt;
        const instructions =
          (mode === "custom" ? customInstructions.trim() : "") ||
          DEFAULT_SPEECH_POST_PROCESSING_PROMPT;
        // The endpoint's own error is the cause, so its reason reaches the person.
        const generated = yield* Effect.tryPromise({
          try: (signal) =>
            model.complete(
              buildTranscriptionPostProcessingPrompt(
                instructions,
                input.transcript,
                input.draft,
                input.options.speechCorrectionWord,
              ),
              signal,
            ),
          catch: (cause) => cause,
        });
        const text = generated.trim();
        return {
          text:
            text.length > 0
              ? applySpeechAliases(text, input.options.speechCustomWords)
              : input.transcript,
        };
      },
      Effect.mapError((cause) => new SpeechOperationError({ operation: "post-processing", cause })),
    ),
  });
});

export const layer = Layer.effect(SpeechPostProcessing, make);
