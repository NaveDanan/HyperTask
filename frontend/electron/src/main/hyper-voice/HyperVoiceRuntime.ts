// HyperTask's voice runtime: the layers t3code's server wires for speech (apps/server/src/server.ts), built for the
// Electron main process. Free of Electron imports so it can also run in a plain Node smoke test.
import * as NodePath from 'node:path';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodePathLayer from '@effect/platform-node/NodePath';
import * as SecureRandom from 'effect/crypto/SecureRandom';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import { FetchHttpClient } from 'effect/http';
import * as CloudSpeech from './CloudSpeech';
import * as SpeechPostProcessing from './postProcessing';
import * as SpeechModelStore from './SpeechModelStore';
import * as SpeechService from './SpeechService';
import * as VoiceSettings from './VoiceSettings';

export interface HyperVoiceRuntimeOptions {
  /** `<userData>/hyper-voice`: settings.json and models/ live here. */
  directory: string;
  /** Network access for model downloads and cloud speech (Electron's net.fetch in the app). */
  fetch: typeof globalThis.fetch;
  /** Transcript cleanup through the Settings → AI endpoint. */
  cleanup: SpeechPostProcessing.TranscriptCleanupModel['Service'];
}

export function hyperVoiceLayer(options: HyperVoiceRuntimeOptions) {
  const platform = Layer.mergeAll(
    NodeFileSystem.layer,
    NodePathLayer.layer,
    SecureRandom.layerWebCrypto,
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch))),
  );
  const settings = VoiceSettings.layer(NodePath.join(options.directory, 'settings.json'));
  const store = SpeechModelStore.layer(NodePath.join(options.directory, 'models')).pipe(Layer.provide(platform));
  const speech = SpeechService.layer.pipe(Layer.provide(Layer.mergeAll(store, settings)));
  const cloud = CloudSpeech.layer.pipe(Layer.provide(Layer.mergeAll(settings, platform)));
  const cleanup = SpeechPostProcessing.layer.pipe(
    Layer.provide(Layer.succeed(SpeechPostProcessing.TranscriptCleanupModel, options.cleanup)),
  );
  return Layer.mergeAll(speech, cloud, cleanup, settings);
}

export type HyperVoiceRuntime = ReturnType<typeof createHyperVoiceRuntime>;

/** One runtime for the app's life. Disposing it closes the speech scope, which kills the native worker. */
export function createHyperVoiceRuntime(options: HyperVoiceRuntimeOptions) {
  return ManagedRuntime.make(hyperVoiceLayer(options));
}
