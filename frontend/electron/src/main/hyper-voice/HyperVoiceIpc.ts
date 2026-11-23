// Serves HyperVoiceApi (src/shared/hyper-voice/api.ts) from the main process: the routes of t3code's voice HTTP API and
// live-transcription socket (apps/server/src/speech/http.ts and stream.ts), Copyright (c) 2026 T3 Tools Inc.,
// MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: IPC handlers instead of HTTP routes; one live stream per id instead of per socket.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain, net, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Schema from 'effect/Schema';
import * as Scope from 'effect/Scope';
import { HyperVoiceChannel as V, type HyperVoiceCleanupModels } from '@shared/hyper-voice/api';
import {
  CloudSpeechError,
  CloudSpeechModelId,
  CloudSpeechProvider,
  EnvironmentSpeechPostProcessingRequest,
  SPEECH_MAX_OPTIONS_BYTES,
  SPEECH_STREAM_MAX_CHUNK_BYTES,
  SpeechAcceleration,
  SpeechModelUnloadTimeout,
  SpeechTranscriptionOptions,
} from '@shared/hyper-voice/speech';
import { HyperBotsEngineError, HyperBotsOpenAIEngine, hyperBotsReadEndpoint } from '../HyperBotsEngine';
import { unprotect } from '../dpapi';
import { listEndpointModels } from '../openai-endpoint';
import { SettingsError, toIpcResult } from '../settings-error';
import { hyperTrustedWindowAdapter, type HyperTrustedWindowRegistry } from '../HyperTrustedWindows';
import * as CloudSpeech from './CloudSpeech';
import { createHyperVoiceRuntime } from './HyperVoiceRuntime';
import * as SpeechPostProcessing from './postProcessing';
import * as SpeechService from './SpeechService';
import * as VoiceSettings from './VoiceSettings';

/** A live stream unused this long is closed, as t3code's socket times out after ten minutes. */
const STREAM_LIFETIME_MS = 10 * 60_000;
const CLEANUP_TIMEOUT_MS = 2 * 60_000;

const firstLine = (value: string) => value.split('\n', 1)[0]!.trim().slice(0, 300);
const causeText = (cause: unknown): string => {
  // Effect.tryPromise without a catch wraps the real error in an UnknownError.
  if (typeof cause === 'object' && cause !== null && '_tag' in cause && cause._tag === 'UnknownError' && 'cause' in cause && cause.cause !== undefined)
    return causeText(cause.cause);
  return cause instanceof Error && cause.message ? firstLine(cause.message) : typeof cause === 'string' ? firstLine(cause) : '';
};

/** What the person reads for each failure. Native stacks and transport details stay in the main log. */
export function hyperVoiceFailure(error: unknown): SettingsError {
  if (error instanceof SettingsError) return error;
  const tag = typeof error === 'object' && error !== null && '_tag' in error ? String(error._tag) : '';
  switch (tag) {
    case 'CloudSpeechError':
      return new SettingsError('state', (error as CloudSpeechError).message);
    case 'SpeechBusyError':
      return new SettingsError('state', 'Voice input is busy. Wait for the current recording or model download to finish, then try again.');
    case 'SpeechInvalidAudioError':
      return new SettingsError('format', 'The recording could not be used. Recordings are limited to five minutes; try recording again.');
    case 'SpeechUnsupportedPlatformError':
      return new SettingsError('unsupported', `Voice transcription is not available on ${process.platform}-${process.arch}.`);
    case 'SpeechModelNotFoundError':
      return new SettingsError('state', 'That speech model is not installed. Download it in Settings → Voice.');
    case 'SpeechDownloadCancelledError':
      return new SettingsError('state', 'The model download was cancelled.');
    case 'HyperVoiceSettingsError':
      return new SettingsError('other', (error as VoiceSettings.HyperVoiceSettingsError).message);
    case 'SpeechOperationError': {
      const { operation, cause } = error as SpeechService.SpeechOperationError;
      if (operation === 'post-processing') {
        const detail = cause instanceof HyperBotsEngineError ? cause.message : causeText(cause);
        return new SettingsError('state', `Transcript cleanup failed${detail ? `: ${detail}` : '.'}`);
      }
      const detail = causeText(cause);
      const label = operation.charAt(0).toUpperCase() + operation.slice(1);
      return new SettingsError('other', `${label} failed${detail ? `: ${detail}` : '.'}`);
    }
  }
  return new SettingsError('other', causeText(error) || 'Voice input failed.');
}

const decodeOptions = Schema.decodeUnknownSync(SpeechTranscriptionOptions);
const decodeProvider = Schema.decodeUnknownSync(CloudSpeechProvider);
const decodeModelId = Schema.decodeUnknownSync(CloudSpeechModelId);
const decodeAcceleration = Schema.decodeUnknownSync(SpeechAcceleration);
const decodeUnloadTimeout = Schema.decodeUnknownSync(SpeechModelUnloadTimeout);
const decodePostProcessing = Schema.decodeUnknownSync(EnvironmentSpeechPostProcessingRequest);

const invalid = (message: string) => new SettingsError('format', message);
function parse<T>(decode: (value: unknown) => T, value: unknown, message: string): T {
  try {
    return decode(value);
  } catch {
    throw invalid(message);
  }
}
function speechOptions(value: unknown) {
  if (JSON.stringify(value ?? null).length > SPEECH_MAX_OPTIONS_BYTES) throw invalid('Speech options are too large.');
  return parse(decodeOptions, value, 'Invalid speech options.');
}
const RECORDING_UNUSABLE = 'The recording could not be used. Recordings are limited to five minutes; try recording again.';
function pcm(value: unknown, maxBytes: number, message = RECORDING_UNUSABLE) {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maxBytes || value.byteLength % 4 !== 0)
    throw invalid(message);
  return value;
}
function text(value: unknown, max: number, message: string) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw invalid(message);
  return value.trim();
}

interface LiveStream {
  owner: WebContents;
  scope: Scope.Closeable;
  stream: SpeechService.SpeechStream;
  /** Feeds and the finish run in arrival order; the native stream accepts one request at a time. */
  queue: Promise<unknown>;
  timer: NodeJS.Timeout;
}

export interface HyperVoiceMain {
  /** Closes live streams and the speech runtime, which kills the native worker. */
  dispose(): Promise<void>;
}

export function registerHyperVoiceIpc(options: {
  window: () => BrowserWindow | null;
  trustedWindows?: HyperTrustedWindowRegistry;
  /** `<userData>`: settings and models live in its hyper-voice folder. */
  userData: string;
  /** Where Settings → AI keeps local_ai/openai-endpoint.json. */
  supportDirectory: () => string;
}): HyperVoiceMain {
  // net.fetch: Chromium's network stack, so the system proxy and the Windows certificate store apply.
  const netFetch = ((input, init) => net.fetch(input as string, init)) as typeof fetch;
  const engine = new HyperBotsOpenAIEngine({ endpoint: () => hyperBotsReadEndpoint(options.supportDirectory(), unprotect), fetch: netFetch, timeoutMs: CLEANUP_TIMEOUT_MS });
  // Created below; the cleanup model reads the pinned model from the runtime's own settings.
  let readSettings: () => Promise<VoiceSettings.VoiceSettings> = async () => { throw new Error('Voice is starting.'); };
  const runtime = createHyperVoiceRuntime({
    directory: path.join(options.userData, 'hyper-voice'),
    fetch: netFetch,
    cleanup: {
      complete: async (prompt, signal) => {
        const endpoint = await hyperBotsReadEndpoint(options.supportDirectory(), unprotect);
        const model = (await readSettings()).speechPostProcessingModel?.trim() || endpoint.defaultModel;
        const { message } = await engine.complete({ model, messages: [{ role: 'user', content: prompt }], tools: [] }, signal);
        return message.content ?? '';
      },
    },
  });
  type Services = SpeechService.SpeechService | CloudSpeech.CloudSpeech | SpeechPostProcessing.SpeechPostProcessing | VoiceSettings.VoiceSettingsService;
  const run = async <A, E>(effect: Effect.Effect<A, E, Services>): Promise<A> => {
    const exit = await runtime.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return exit.value;
    if (Cause.hasInterruptsOnly(exit.cause)) throw new SettingsError('state', 'Voice input was stopped.');
    const error = Cause.squash(exit.cause);
    const failure = hyperVoiceFailure(error);
    if (failure.kind === 'other') console.error('[hyper-voice]', Cause.pretty(exit.cause));
    throw failure;
  };
  const speech = () => run(Effect.gen(function* () { return yield* SpeechService.SpeechService; }));
  const cloud = () => run(Effect.gen(function* () { return yield* CloudSpeech.CloudSpeech; }));
  const postProcessing = () => run(Effect.gen(function* () { return yield* SpeechPostProcessing.SpeechPostProcessing; }));
  const settingsService = () => run(Effect.gen(function* () { return yield* VoiceSettings.VoiceSettingsService; }));
  // Builds the runtime now, so a broken install is logged at startup rather than at the first recording.
  void speech().catch((error: unknown) => console.error('[hyper-voice] speech runtime could not start', error));
  readSettings = async () => run((await settingsService()).getSettings);

  const trustedRegistry = options.trustedWindows ?? hyperTrustedWindowAdapter(options.window);
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => trustedRegistry.isTrustedSender(event);
  const handle = <T>(channel: string, work: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T>) =>
    ipcMain.handle(channel, (event, ...args) => toIpcResult(async () => {
      if (!trusted(event)) throw new SettingsError('state', 'Untrusted voice caller refused.');
      try {
        return await work(event, ...args);
      } catch (error) {
        throw hyperVoiceFailure(error);
      }
    }));

  // Local models (SpeechService).
  handle(V.Status, async () => run((await speech()).status));
  handle(V.Models, async (_, includeBenchmarks) => run((await speech()).models(includeBenchmarks === true)));
  handle(V.DownloadModel, async (_, modelId) => run((await speech()).downloadModel(text(modelId, 160, 'Invalid speech model.'))));
  handle(V.SelectModel, async (_, modelId) => run((await speech()).selectModel(text(modelId, 160, 'Invalid speech model.'))));
  handle(V.CancelModelDownload, async (_, modelId) => run((await speech()).cancelDownload(text(modelId, 160, 'Invalid speech model.'))));
  handle(V.RemoveModel, async (_, modelId) => run((await speech()).removeModel(text(modelId, 160, 'Invalid speech model.'))));
  handle(V.LinkModels, async (_, source) => {
    const folder = text(source, 4096, 'Choose a model file or folder.');
    try {
      return await run((await speech()).linkModels(folder));
    } catch (error) {
      // linkModels reports "not found" when the path held no catalog model it could add.
      if (error instanceof SettingsError && error.message.startsWith('That speech model is not installed'))
        throw new SettingsError('state', 'No new catalog speech models were found there. Choose a .gguf file from the model list, or a folder that holds one.');
      throw error;
    }
  });
  handle(V.PickModelPath, async (_, kind) => {
    const owner = options.window();
    const properties: Array<'openFile' | 'openDirectory'> = kind === 'folder' ? ['openDirectory'] : ['openFile'];
    const dialogOptions = { title: kind === 'folder' ? 'Choose a folder with speech models' : 'Choose a speech model file', properties, ...(kind === 'folder' ? {} : { filters: [{ name: 'Speech models', extensions: ['gguf'] }] }) };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(V.PrepareModel, async () => { await run((await speech()).prepareModel); });
  handle(V.UpdateAcceleration, async (_, value) => run((await speech()).updateAcceleration(parse(decodeAcceleration, value, 'Invalid acceleration.'))));
  handle(V.UpdateModelUnloadTimeout, async (_, value) => run((await speech()).updateModelUnloadTimeout(parse(decodeUnloadTimeout, value, 'Invalid unload timeout.'))));
  handle(V.Transcribe, async (_, audio, opts) => {
    const text = await run((await speech()).transcribe(pcm(audio, SpeechService.MAX_SPEECH_BYTES), speechOptions(opts)));
    return { text };
  });

  // Live transcription (t3code's /ws/voice socket).
  const streams = new Map<string, LiveStream>();
  const watched = new WeakSet<WebContents>();
  const closeStream = (id: string) => {
    const live = streams.get(id);
    if (!live) return;
    streams.delete(id);
    clearTimeout(live.timer);
    // Closing the scope resets or kills the native stream; an unfinished recording leaves nothing behind.
    void runtime.runPromise(Scope.close(live.scope, Exit.void)).catch(() => undefined);
  };
  const ownStream = (event: IpcMainInvokeEvent, id: unknown) => {
    const live = typeof id === 'string' ? streams.get(id) : undefined;
    if (!live || live.owner !== event.sender) throw new SettingsError('state', 'This recording already ended. Try recording again.');
    return live;
  };
  handle(V.StreamStart, async (event, opts) => {
    const parsed = speechOptions(opts);
    const service = await speech();
    const scope = await runtime.runPromise(Scope.make());
    let stream: SpeechService.SpeechStream;
    try {
      stream = await run(service.startStream(parsed).pipe(Scope.provide(scope)));
    } catch (error) {
      await runtime.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
      throw error;
    }
    const streamId = randomUUID();
    const owner = event.sender;
    if (!watched.has(owner)) {
      watched.add(owner);
      const closeOwned = () => { for (const [id, live] of streams) if (live.owner === owner) closeStream(id); };
      owner.once('destroyed', closeOwned);
      owner.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) closeOwned(); });
    }
    streams.set(streamId, { owner, scope, stream, queue: Promise.resolve(), timer: setTimeout(() => closeStream(streamId), STREAM_LIFETIME_MS) });
    return { streamId };
  });
  const enqueue = <T>(live: LiveStream, work: () => Promise<T>) => {
    const next = live.queue.then(work);
    live.queue = next.catch(() => undefined);
    return next;
  };
  handle(V.StreamFeed, async (event, id, audio) => {
    const live = ownStream(event, id);
    const bytes = pcm(audio, SPEECH_STREAM_MAX_CHUNK_BYTES, 'Live audio arrives in chunks of at most one second of 16 kHz Float32 PCM.');
    try {
      return await enqueue(live, () => run(live.stream.feed(bytes)));
    } catch (error) {
      closeStream(id as string);
      throw error;
    }
  });
  handle(V.StreamFinish, async (event, id) => {
    const live = ownStream(event, id);
    try {
      const text = await enqueue(live, () => run(live.stream.finish));
      return { text };
    } finally {
      closeStream(id as string);
    }
  });
  ipcMain.on(V.StreamCancel, (event, id) => {
    if (!trusted(event) || typeof id !== 'string') return;
    if (streams.get(id)?.owner === event.sender) closeStream(id);
  });

  // Cloud transcription (CloudSpeech).
  handle(V.CloudKeys, async () => run((await cloud()).configured));
  handle(V.SetCloudKey, async (_, provider, key) => {
    const which = parse(decodeProvider, provider, 'Unknown transcription provider.');
    if (key !== null && (typeof key !== 'string' || key.trim().length === 0 || key.length > 4096)) throw invalid('Enter an API key.');
    if (typeof key === 'string' && /^[a-z][a-z\d+.-]*:\/\//i.test(key.trim())) throw invalid('Enter the API key itself, not a URL.');
    await run((await cloud()).setKey(which, key));
  });
  handle(V.CloudModels, async () => ({ models: await run((await cloud()).models) }));
  handle(V.TranscribeCloud, async (_, provider, audio, opts, model) => {
    const which = parse(decodeProvider, provider, 'Unknown transcription provider.');
    const chosen = model === undefined || model === null ? undefined : parse(decodeModelId, model, 'Invalid OpenRouter model.');
    const text = await run((await cloud()).transcribe(which, pcm(audio, SpeechService.MAX_SPEECH_BYTES), speechOptions(opts), chosen));
    return { text };
  });

  // Transcript cleanup through the Settings → AI endpoint.
  const cleanupModels = async (): Promise<HyperVoiceCleanupModels> => {
    const { speechPostProcessingModel: selected } = await readSettings();
    let saved: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(options.supportDirectory(), 'local_ai', 'openai-endpoint.json'), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
    } catch { /* No endpoint saved yet. */ }
    const value = (key: string) => (typeof saved?.[key] === 'string' ? (saved[key] as string).trim() : '');
    const configured = saved?.enabled === true && value('base_url') !== '' && value('model') !== '';
    if (!configured) return { configured: false, defaultModel: value('model'), selected, models: [] };
    const models = await listEndpointModels({ baseUrl: value('base_url'), protectedKey: value('protected_key') }).catch(() => [] as string[]);
    return { configured, defaultModel: value('model'), selected, models };
  };
  handle(V.PostProcess, async (_, request) =>
    run((await postProcessing()).process(parse(decodePostProcessing, request, 'Invalid cleanup request.'))));
  handle(V.CleanupModels, cleanupModels);
  handle(V.SetCleanupModel, async (_, model) => {
    const pinned = model === null ? null : text(model, 200, 'Choose a cleanup model.');
    await run((await settingsService()).updateSettings({ speechPostProcessingModel: pinned }));
    return cleanupModels();
  });

  return {
    async dispose() {
      for (const id of [...streams.keys()]) closeStream(id);
      await runtime.dispose();
    },
  };
}
