// Copied from t3code (apps/server/src/speech/model.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: imports.
import type { EnvironmentSpeechModel } from "@shared/hyper-voice/speech";
import catalog from "./catalog.json";

export type SpeechModel = {
  readonly id: string;
  readonly revision: string;
  readonly name: string;
  readonly description: string;
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
  readonly languages: readonly string[];
  readonly accuracy: number;
  readonly speed: number;
  readonly benchmark: NonNullable<EnvironmentSpeechModel["benchmark"]>;
  readonly recommended: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsLanguageDetection: boolean;
  readonly supportsTranslation: boolean;
};

// Scores remain required by the wire schema but are not displayed.
// The JSON import types each benchmark language as possibly undefined, so it is read as the catalog's own shape.
type CatalogModel = Omit<SpeechModel, "accuracy" | "speed">;
export const SPEECH_MODELS: readonly SpeechModel[] = (
  catalog.models as unknown as readonly CatalogModel[]
).map((model) => ({
  ...model,
  accuracy: 0,
  speed: 0,
}));

export const DEFAULT_SPEECH_MODEL_ID = "handy-computer/parakeet-unified-en-0.6b-gguf";
export const getSpeechModel = (modelId: string): SpeechModel | undefined =>
  SPEECH_MODELS.find((model) => model.id === modelId);

export { effectiveSpeechLanguage } from "@shared/hyper-voice/speechShared";
