// Copied from t3code (packages/client-runtime/src/voice-input/stream.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: the environment's /ws/voice socket is the main process's IPC stream
// (window.hypertask.hyperVoice.stream*); createIpcSpeechSocket gives it the WebSocket shape this file drives.
// @effect-diagnostics globalTimers:off - imperative WebSocket callbacks own and clear their response deadline.
import { msg } from "gt-i18n";
import { translatableError } from "../translatable";
import {
  SPEECH_STREAM_MAX_CHUNK_BYTES,
  SPEECH_STREAM_MAX_QUEUED_BYTES,
  SpeechStreamEvent,
  type SpeechStreamText,
  type SpeechTranscriptionOptions,
} from "@shared/hyper-voice/speech";
import * as Schema from "effect/Schema";

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(SpeechStreamEvent));

/** Audio stays bounded while the environment acknowledges a small send window. */
export function openSpeechStream(input: {
  /** Unused in HyperTask: the stream always runs in the main process. */
  readonly url?: string;
  readonly options: SpeechTranscriptionOptions;
  readonly signal: AbortSignal;
  readonly canSend: () => boolean;
  readonly onText: (text: SpeechStreamText) => void;
  readonly onError: (error: Error) => void;
  readonly createSocket?: (url: string) => WebSocket;
}) {
  input.signal.throwIfAborted();
  const socket = (input.createSocket ?? createIpcSpeechSocket)(input.url ?? "");
  let resolveFinal!: (text: string) => void;
  let rejectFinal!: (error: Error) => void;
  const final = new Promise<string>((resolve, reject) => {
    resolveFinal = resolve;
    rejectFinal = reject;
  });
  // A capture failure can precede stop(), when nobody is awaiting the final result yet.
  void final.catch(() => undefined);
  let queue: Uint8Array<ArrayBuffer>[] = [];
  let queuedBytes = 0;
  const inFlight: number[] = [];
  let inFlightBytes = 0;
  let finishing = false;
  let finishSent = false;
  let closed = false;
  let isReady = false;
  let revision = -1;
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", abort);
    queue = [];
    queuedBytes = 0;
  };
  const fail = (error: Error, notify = true) => {
    if (closed) return;
    closed = true;
    cleanup();
    rejectFinal(error);
    socket.close();
    if (notify) input.onError(error);
  };
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => fail(translatableError(msg("Live transcription stopped responding."))),
      120_000,
    );
  };
  const abort = () => fail(translatableError(msg("Voice transcription was cancelled.")), false);
  const pump = () => {
    if (!isReady || closed || finishSent) return;
    if (!input.canSend()) return fail(translatableError(msg("Voice consent was revoked.")));
    while (inFlight.length < 2 && queue.length) {
      const chunk = queue.shift()!;
      inFlight.push(chunk.byteLength);
      inFlightBytes += chunk.byteLength;
      queuedBytes -= chunk.byteLength;
      socket.send(chunk);
      armTimeout();
    }
    if (finishing && !queue.length && !inFlight.length) {
      finishSent = true;
      socket.send(JSON.stringify({ type: "finish" }));
      armTimeout();
    }
  };
  socket.addEventListener("open", () => {
    if (!input.canSend()) return fail(translatableError(msg("Voice consent was revoked.")));
    if (!closed) socket.send(JSON.stringify({ type: "start", options: input.options }));
  });
  socket.addEventListener("message", (event) => {
    if (closed) return;
    if (!input.canSend()) return fail(translatableError(msg("Voice consent was revoked.")));
    try {
      const message = decodeEvent(event.data);
      switch (message.type) {
        case "ready":
          if (isReady) throw translatableError(msg("Unexpected speech stream response."));
          isReady = true;
          clearTimeout(timer);
          pump();
          break;
        case "update":
          if (!inFlight.length || message.revision < revision)
            throw translatableError(msg("Unexpected speech stream response."));
          revision = message.revision;
          inFlightBytes -= inFlight.shift()!;
          clearTimeout(timer);
          if (message.text) input.onText(message.text);
          pump();
          if (inFlight.length) armTimeout();
          break;
        case "finished":
          if (!finishSent) throw translatableError(msg("Unexpected speech stream response."));
          closed = true;
          cleanup();
          resolveFinal(message.text);
          socket.close();
          break;
        case "error":
          fail(new Error(message.message));
      }
    } catch (error) {
      fail(
        error instanceof Error ? error : translatableError(msg("Invalid speech stream response.")),
      );
    }
  });
  socket.addEventListener("close", () =>
    fail(translatableError(msg("The voice connection closed. Please record again."))),
  );
  socket.addEventListener("error", () =>
    fail(translatableError(msg("Could not connect to live transcription."))),
  );
  input.signal.addEventListener("abort", abort, { once: true });
  armTimeout();
  if (input.signal.aborted) abort();
  return {
    feed: (pcm: Float32Array) => {
      if (closed || finishing) return;
      const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      if (queuedBytes + inFlightBytes + bytes.byteLength > SPEECH_STREAM_MAX_QUEUED_BYTES) {
        fail(translatableError(msg("Voice recordings are limited to five minutes.")));
        return;
      }
      let offset = 0;
      while (offset < bytes.length) {
        const tail = queue.at(-1);
        const available = tail ? SPEECH_STREAM_MAX_CHUNK_BYTES - tail.byteLength : 0;
        if (tail && available > 0) {
          const appended = Math.min(available, bytes.length - offset);
          const merged = new Uint8Array(tail.byteLength + appended);
          merged.set(tail);
          merged.set(bytes.subarray(offset, offset + appended), tail.byteLength);
          queue[queue.length - 1] = merged;
          queuedBytes += appended;
          offset += appended;
          continue;
        }
        const chunk = bytes.slice(offset, offset + SPEECH_STREAM_MAX_CHUNK_BYTES);
        queue.push(chunk);
        queuedBytes += chunk.byteLength;
        offset += chunk.byteLength;
      }
      try {
        pump();
      } catch {
        fail(translatableError(msg("Could not send microphone audio.")));
      }
    },
    finish: () => {
      finishing = true;
      try {
        pump();
      } catch {
        fail(translatableError(msg("Could not finish live transcription.")));
      }
      return final;
    },
    cancel: abort,
  };
}

type SocketCommand = { readonly type: "start"; readonly options: SpeechTranscriptionOptions } | { readonly type: "finish" };

/**
 * A WebSocket stand-in over the main process's speech stream. Sends run strictly in order, one IPC call at a time,
 * and each reply arrives as the event the environment socket would have sent.
 */
export function createIpcSpeechSocket(): WebSocket {
  const voice = window.hypertask.hyperVoice;
  const target = new EventTarget();
  let streamId: string | null = null;
  let closed = false;
  let finished = false;
  let chain: Promise<void> = Promise.resolve();
  const emit = (event: SpeechStreamEvent) => {
    if (!closed) target.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  };
  const run = (work: () => Promise<void>) => {
    chain = chain.then(work).catch((error: unknown) => {
      emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
  };
  const socket = Object.assign(target, {
    send(data: string | Uint8Array) {
      if (closed) return;
      if (typeof data === "string") {
        const command = JSON.parse(data) as SocketCommand;
        run(async () => {
          if (command.type === "start") {
            const result = await voice.streamStart(command.options);
            if (!result.ok) return emit({ type: "error", message: result.message });
            streamId = result.value.streamId;
            if (closed) {
              voice.streamCancel(streamId);
              return;
            }
            emit({ type: "ready" });
          } else {
            if (!streamId) return emit({ type: "error", message: "Start speech transcription before finishing." });
            const result = await voice.streamFinish(streamId);
            finished = true;
            if (!result.ok) return emit({ type: "error", message: result.message });
            emit({ type: "finished", text: result.value.text });
          }
        });
        return;
      }
      // Copy the view: IPC serializes the bytes, and the caller may reuse its buffer.
      const chunk = data.slice();
      run(async () => {
        if (!streamId) return emit({ type: "error", message: "Start speech transcription before sending audio." });
        const result = await voice.streamFeed(streamId, chunk);
        if (!result.ok) return emit({ type: "error", message: result.message });
        emit({ type: "update", revision: result.value.revision, text: result.value.text });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      // A start still in flight cancels its stream once main answers (see send).
      if (streamId && !finished) voice.streamCancel(streamId);
      queueMicrotask(() => target.dispatchEvent(new Event("close")));
    },
  });
  queueMicrotask(() => {
    if (!closed) target.dispatchEvent(new Event("open"));
  });
  return socket as unknown as WebSocket;
}
