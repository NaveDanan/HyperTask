// The voice IPC surface. Each method stands for one of t3code's environment voice endpoints
// (apps/server/src/speech/http.ts and stream.ts, called from packages/client-runtime/src/voice-input/environment.ts),
// served here by the Electron main process instead of an HTTP server.
import type { IpcResult } from '../api';
import type {
  CloudSpeechKeys,
  CloudSpeechModelId,
  CloudSpeechModels,
  CloudSpeechProvider,
  EnvironmentSpeechModels,
  EnvironmentSpeechPostProcessingRequest,
  EnvironmentSpeechStatus,
  SpeechAcceleration,
  SpeechModelUnloadTimeout,
  SpeechStreamText,
  SpeechTranscriptionOptions,
} from './speech';

/** The Settings → AI endpoint as transcript cleanup sees it. */
export interface HyperVoiceCleanupModels {
  /** False until Settings → AI has an endpoint; cleanup then cannot run. */
  configured: boolean;
  /** The endpoint's own model, which cleanup follows while `selected` is null. */
  defaultModel: string;
  /** A model pinned for cleanup, or null to follow the endpoint's model. */
  selected: string | null;
  /** Models the endpoint lists; empty when it lists none or could not be reached. */
  models: string[];
}

export interface HyperVoiceStreamUpdate {
  revision: number;
  text: SpeechStreamText | null;
}

export interface HyperVoiceApi {
  // Local models (SpeechService).
  status(): Promise<IpcResult<EnvironmentSpeechStatus>>;
  models(includeBenchmarks: boolean): Promise<IpcResult<EnvironmentSpeechModels>>;
  downloadModel(modelId: string): Promise<IpcResult<EnvironmentSpeechModels>>;
  selectModel(modelId: string): Promise<IpcResult<EnvironmentSpeechModels>>;
  cancelModelDownload(modelId: string): Promise<IpcResult<EnvironmentSpeechModels>>;
  removeModel(modelId: string): Promise<IpcResult<EnvironmentSpeechModels>>;
  /** Uses catalog model files already on this machine, from a file or folder path. */
  linkModels(path: string): Promise<IpcResult<EnvironmentSpeechModels>>;
  /** Native file or folder picker for linkModels; null when cancelled. */
  pickModelPath(kind: 'file' | 'folder'): Promise<IpcResult<string | null>>;
  prepareModel(): Promise<IpcResult<void>>;
  updateAcceleration(acceleration: SpeechAcceleration): Promise<IpcResult<EnvironmentSpeechStatus>>;
  updateModelUnloadTimeout(timeout: SpeechModelUnloadTimeout): Promise<IpcResult<EnvironmentSpeechStatus>>;
  /** 16 kHz mono Float32 PCM, as raw bytes. */
  transcribe(pcm: Uint8Array, options: SpeechTranscriptionOptions): Promise<IpcResult<{ text: string }>>;
  // Live transcription (t3code's /ws/voice socket): one stream per id, fed in order.
  streamStart(options: SpeechTranscriptionOptions): Promise<IpcResult<{ streamId: string }>>;
  streamFeed(streamId: string, pcm: Uint8Array): Promise<IpcResult<HyperVoiceStreamUpdate>>;
  streamFinish(streamId: string): Promise<IpcResult<{ text: string }>>;
  streamCancel(streamId: string): void;
  // Cloud transcription (CloudSpeech).
  cloudKeys(): Promise<IpcResult<CloudSpeechKeys>>;
  /** null removes the key. Keys are stored with the OS credential protection and never come back to the renderer. */
  setCloudKey(provider: CloudSpeechProvider, key: string | null): Promise<IpcResult<void>>;
  cloudModels(): Promise<IpcResult<CloudSpeechModels>>;
  transcribeCloud(
    provider: CloudSpeechProvider,
    pcm: Uint8Array,
    options: SpeechTranscriptionOptions,
    model?: CloudSpeechModelId,
  ): Promise<IpcResult<{ text: string }>>;
  // Transcript cleanup (SpeechPostProcessing), through the Settings → AI endpoint.
  postProcess(request: EnvironmentSpeechPostProcessingRequest): Promise<IpcResult<{ text: string }>>;
  cleanupModels(): Promise<IpcResult<HyperVoiceCleanupModels>>;
  setCleanupModel(model: string | null): Promise<IpcResult<HyperVoiceCleanupModels>>;
}

export const HyperVoiceChannel = {
  Status: 'hyper-voice:status',
  Models: 'hyper-voice:models',
  DownloadModel: 'hyper-voice:download-model',
  SelectModel: 'hyper-voice:select-model',
  CancelModelDownload: 'hyper-voice:cancel-model-download',
  RemoveModel: 'hyper-voice:remove-model',
  LinkModels: 'hyper-voice:link-models',
  PickModelPath: 'hyper-voice:pick-model-path',
  PrepareModel: 'hyper-voice:prepare-model',
  UpdateAcceleration: 'hyper-voice:update-acceleration',
  UpdateModelUnloadTimeout: 'hyper-voice:update-model-unload-timeout',
  Transcribe: 'hyper-voice:transcribe',
  StreamStart: 'hyper-voice:stream-start',
  StreamFeed: 'hyper-voice:stream-feed',
  StreamFinish: 'hyper-voice:stream-finish',
  StreamCancel: 'hyper-voice:stream-cancel',
  CloudKeys: 'hyper-voice:cloud-keys',
  SetCloudKey: 'hyper-voice:set-cloud-key',
  CloudModels: 'hyper-voice:cloud-models',
  TranscribeCloud: 'hyper-voice:transcribe-cloud',
  PostProcess: 'hyper-voice:post-process',
  CleanupModels: 'hyper-voice:cleanup-models',
  SetCleanupModel: 'hyper-voice:set-cleanup-model',
} as const;
