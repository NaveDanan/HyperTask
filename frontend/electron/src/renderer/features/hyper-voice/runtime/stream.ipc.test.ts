// HyperTask's IPC stand-in for t3code's /ws/voice socket, driven by openSpeechStream as the socket would be.
import { DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS } from "@shared/hyper-voice/speech";
import { afterEach, expect, it, vi } from "vitest";
import { openSpeechStream } from "./stream";

function installVoice(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let revision = 0;
  const voice = {
    streamStart: vi.fn(async () => {
      calls.push("start");
      return { ok: true, value: { streamId: "s1" } };
    }),
    streamFeed: vi.fn(async (_id: string, pcm: Uint8Array) => {
      calls.push(`feed:${pcm.byteLength}`);
      revision += 1;
      return { ok: true, value: { revision, text: { committed: `r${revision}`, tentative: "" } } };
    }),
    streamFinish: vi.fn(async () => {
      calls.push("finish");
      return { ok: true, value: { text: "hello world" } };
    }),
    streamCancel: vi.fn(),
    ...overrides,
  };
  vi.stubGlobal("window", { hypertask: { hyperVoice: voice } });
  return { voice, calls };
}

afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it("starts, feeds audio in order and returns the final transcript", async () => {
  const { voice, calls } = installVoice();
  const onText = vi.fn();
  const stream = openSpeechStream({
    options: DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS,
    signal: new AbortController().signal,
    canSend: () => true,
    onText,
    onError: vi.fn(),
  });
  stream.feed(new Float32Array(4));
  await flush();
  stream.feed(new Float32Array(2));
  const final = await stream.finish();
  expect(final).toBe("hello world");
  expect(calls[0]).toBe("start");
  expect(calls.at(-1)).toBe("finish");
  expect(calls.filter((call) => call.startsWith("feed")).length).toBeGreaterThan(0);
  expect(onText).toHaveBeenCalledWith({ committed: "r1", tentative: "" });
  expect(voice.streamCancel).not.toHaveBeenCalled();
});

it("reports a main-process error and cancels the stream on abort", async () => {
  const { voice } = installVoice({
    streamFeed: vi.fn(async () => ({ ok: false, kind: "other", message: "Live transcription failed." })),
  });
  const onError = vi.fn();
  const abort = new AbortController();
  const stream = openSpeechStream({
    options: DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS,
    signal: abort.signal,
    canSend: () => true,
    onText: vi.fn(),
    onError,
  });
  await flush();
  stream.feed(new Float32Array(4));
  await flush();
  await flush();
  expect(onError).toHaveBeenCalledWith(new Error("Live transcription failed."));
  expect(voice.streamCancel).toHaveBeenCalledWith("s1");
});
