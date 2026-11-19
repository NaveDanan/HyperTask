// The voice-input entry of t3code's client runtime (packages/client-runtime/src/voice-input/index.ts),
// Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: the environment requests come from ../environment (IPC).
export {
  VoiceInputController,
  VOICE_RECORDING_LIMIT_SECONDS,
  MICROPHONE_PERMISSION_ERROR,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
  type VoiceInputErrorCode,
  type VoiceInputPhase,
  type VoiceInputState,
  type VoiceRecorder,
  type VoiceRecorderStatus,
} from "./controller";
export {
  cancelEnvironmentSpeechModelDownload,
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getCloudSpeechKeys,
  getCloudSpeechModels,
  requireCloudSpeechKey,
  setCloudSpeechKey,
  transcribeCloudPcm,
  getEnvironmentSpeechStatus,
  linkEnvironmentSpeechModels,
  postProcessEnvironmentTranscript,
  removeEnvironmentSpeechModel,
  selectEnvironmentSpeechModel,
  transcribeEnvironmentPcm,
  updateEnvironmentSpeechAcceleration,
  updateEnvironmentSpeechModelUnloadTimeout,
} from "../environment";
export { openSpeechStream } from "./stream";
export {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceStreamingSession,
  type VoiceTranscriber,
  type VoiceTranscriptionErrorCode,
  type VoiceTranscriptionOptions,
} from "./transcription";
