// Copied from t3code (apps/web/src/speech/browserPcmCapture.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
import type {
  PreparedVoiceTranscription,
  VoiceRecorder,
  VoiceStreamingSession,
  VoiceInputErrorCode,
  VoiceTranscriptionOptions,
} from "../runtime";
import { requestMicrophone } from "./requestMicrophone";
import workletUrl from "./pcmWorklet.ts?worker&url";
import { m, msg } from "../gt";

type PreparedBrowserTranscription = PreparedVoiceTranscription & {
  readonly streaming?: VoiceStreamingSession & { readonly feed: (pcm: Float32Array) => void };
};

export interface HyperVoiceAudioSpectrum {
  readonly rms: number;
  readonly bass: number;
  readonly mid: number;
  readonly treble: number;
  readonly peak: number;
  readonly bins: Float32Array;
}

/** Samples live frequency/amplitude bands from a Web Audio AnalyserNode without allocations. */
export function sampleHyperVoiceSpectrum(
  analyser: AnalyserNode,
  freqBuf: Uint8Array<ArrayBuffer>,
  timeBuf: Uint8Array<ArrayBuffer>,
  outBins: Float32Array,
): HyperVoiceAudioSpectrum {
  analyser.getByteFrequencyData(freqBuf);
  analyser.getByteTimeDomainData(timeBuf);

  let energy = 0;
  let peak = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const centered = (timeBuf[i]! - 128) / 128;
    const abs = Math.abs(centered);
    if (abs > peak) peak = abs;
    energy += centered * centered;
  }
  const rms = Math.min(1, Math.sqrt(energy / Math.max(1, timeBuf.length)) * 3.2);

  const count = freqBuf.length;
  const bassEnd = Math.max(1, Math.floor(count * 0.14));
  const midEnd = Math.max(bassEnd + 1, Math.floor(count * 0.48));
  const bandAvg = (from: number, to: number) => {
    let sum = 0;
    const span = Math.max(1, to - from);
    for (let i = from; i < to; i++) sum += freqBuf[i]! / 255;
    return sum / span;
  };
  const bass = bandAvg(0, bassEnd);
  const mid = bandAvg(bassEnd, midEnd);
  const treble = bandAvg(midEnd, count);

  const step = Math.max(1, Math.floor(count / Math.max(1, outBins.length)));
  for (let i = 0; i < outBins.length; i++) {
    const start = i * step;
    const end = Math.min(count, start + step);
    let acc = 0;
    for (let j = start; j < end; j++) acc += freqBuf[j]! / 255;
    outBins[i] = acc / Math.max(1, end - start);
  }
  return { rms, bass, mid, treble, peak, bins: outBins };
}

export function createBrowserPcmCapture(
  input: {
    readonly getMicrophoneId: () => string | Promise<string>;
    readonly onLevel: (level: number) => void;
    readonly onAnalyser?: (analyser: AnalyserNode | null) => void;
    readonly onDurationLimit: () => void;
    readonly onError: (message: string, code?: VoiceInputErrorCode) => void;
  },
  prepare: (options: VoiceTranscriptionOptions) => Promise<PreparedBrowserTranscription>,
) {
  let stream: MediaStream | undefined;
  let recordingUri: string | null = null;
  let chunks: Float32Array<ArrayBuffer>[] = [];
  let audioContext: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let signal: AbortSignal | undefined;
  let feed: ((pcm: Float32Array) => void) | undefined;
  let stopped:
    | { readonly resolve: () => void; readonly reject: (error: Error) => void }
    | undefined;

  const cleanupCapture = () => {
    if (durationTimer) clearTimeout(durationTimer);
    durationTimer = undefined;
    analyser?.disconnect();
    analyser = undefined;
    input.onAnalyser?.(null);
    worklet?.disconnect();
    worklet?.port.close();
    worklet = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    void audioContext?.close();
    audioContext = undefined;
    stopped?.resolve();
    stopped = undefined;
    chunks = [];
    feed = undefined;
    input.onLevel(0);
  };

  const recorder: VoiceRecorder = {
    get uri() {
      return recordingUri;
    },
    prepareToRecordAsync: async () => {
      const captureSignal = signal;
      if (!captureSignal) throw new Error(m(msg("Voice transcription is not prepared.")));
      captureSignal.throwIfAborted();
      if (recordingUri) URL.revokeObjectURL(recordingUri);
      recordingUri = null;
      chunks = [];
      const microphoneId = await input.getMicrophoneId();
      captureSignal.throwIfAborted();
      const captured = await new Promise<MediaStream>((resolve, reject) => {
        const onAbort = () => reject(captureSignal.reason);
        const permission = requestMicrophone(microphoneId, captureSignal);
        captureSignal.addEventListener("abort", onAbort, { once: true });
        void permission.then(
          (media) => {
            captureSignal.removeEventListener("abort", onAbort);
            if (captureSignal.aborted) media.getTracks().forEach((track) => track.stop());
            else resolve(media);
          },
          (error: unknown) => {
            captureSignal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
      if (captureSignal.aborted) {
        captured.getTracks().forEach((track) => track.stop());
        captureSignal.throwIfAborted();
      }
      stream = captured;
      try {
        const context = new AudioContext();
        audioContext = context;
        await context.audioWorklet.addModule(workletUrl);
        captureSignal.throwIfAborted();
        const node = new AudioWorkletNode(context, "t3-pcm-capture", { channelCount: 1 });
        worklet = node;
        node.port.onmessage = ({
          data,
        }: MessageEvent<Float32Array<ArrayBuffer> | number | "stopped" | "limit">) => {
          if (captureSignal.aborted) return;
          if (data === "stopped") {
            stopped?.resolve();
            return;
          }
          if (data === "limit") {
            input.onDurationLimit();
            return;
          }
          if (typeof data === "number") {
            input.onLevel(data);
            return;
          }
          if (feed) feed(data);
          else chunks.push(data);
        };
        node.onprocessorerror = () => {
          stopped?.reject(new Error(m(msg("Microphone processing failed."))));
          input.onError(m(msg("Microphone processing failed.")), "microphone-failed");
        };
        for (const track of captured.getTracks())
          track.addEventListener(
            "ended",
            () => input.onError(m(msg("The microphone disconnected.")), "microphone-disconnected"),
            {
              once: true,
            },
          );
        const source = context.createMediaStreamSource(captured);
        if (input.onAnalyser && typeof context.createAnalyser === "function") {
          const analyserNode = context.createAnalyser();
          analyserNode.fftSize = 256;
          analyserNode.smoothingTimeConstant = 0.75;
          source.connect(analyserNode);
          analyser = analyserNode;
          input.onAnalyser(analyserNode);
        }
        source.connect(node);
        // The processor emits silence, keeping the graph active without microphone playback.
        node.connect(context.destination);
        await context.resume();
        captureSignal.throwIfAborted();
      } catch (error) {
        cleanupCapture();
        throw error;
      }
    },
    record: ({ forDuration }) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- AudioWorklet MessagePorts do not accept a target origin
      worklet?.port.postMessage("start");
      durationTimer = setTimeout(input.onDurationLimit, forDuration * 1_000);
    },
    stop: async () => {
      if (!worklet) return;
      if (signal?.aborted) {
        cleanupCapture();
        return;
      }
      const pending = new Promise<void>((resolve, reject) => {
        stopped = { resolve, reject };
      });
      const timeout = setTimeout(
        () => stopped?.reject(new Error(m(msg("Microphone capture did not stop.")))),
        5_000,
      );
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- AudioWorklet MessagePorts do not accept a target origin
      worklet.port.postMessage("stop");
      try {
        await pending;
        if (!feed && chunks.length) {
          const blob = new Blob(chunks, { type: "application/octet-stream" });
          recordingUri = URL.createObjectURL(blob);
        }
      } finally {
        clearTimeout(timeout);
        cleanupCapture();
      }
    },
  };

  return {
    recorder,
    cancelRecording: cleanupCapture,
    deleteRecording: (uri: string) => {
      URL.revokeObjectURL(uri);
      if (recordingUri === uri) recordingUri = null;
    },
    transcriber: {
      prepare: async (options: VoiceTranscriptionOptions) => {
        const prepared = await prepare(options);
        options.signal.throwIfAborted();
        signal = options.signal;
        feed = prepared.streaming?.feed;
        return prepared;
      },
    },
  };
}
