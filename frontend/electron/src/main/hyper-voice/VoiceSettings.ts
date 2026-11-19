// The voice part of t3code's ServerSettingsService (apps/server/src/serverSettings.ts): the machine's speech model,
// acceleration, unload timeout, cleanup model and cloud speech credentials.
// Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: one JSON file under <userData>/hyper-voice, and cloud keys protected the way the
// Settings → AI key is (Windows DPAPI; Electron safeStorage elsewhere). Plaintext keys never leave main.
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HyperVoiceMachineSettings } from "@shared/hyper-voice/settings";
import type { CloudSpeechProvider } from "@shared/hyper-voice/speech";

export class HyperVoiceSettingsError extends Schema.TaggedError<HyperVoiceSettingsError>()(
  "HyperVoiceSettingsError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not ${this.operation} the voice settings.`;
  }
}

/** A protected key as stored on disk, "" when none is saved. */
export type CloudSpeechCredentials = Record<CloudSpeechProvider, string>;

const StoredSettings = Schema.Struct({
  ...HyperVoiceMachineSettings.fields,
  cloudSpeechCredentials: Schema.Struct({
    openai: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
    xai: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
    openrouter: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type VoiceSettings = typeof StoredSettings.Type;
export type VoiceSettingsPatch = Partial<Omit<VoiceSettings, "cloudSpeechCredentials">> & {
  readonly cloudSpeechCredentials?: Partial<CloudSpeechCredentials>;
};

const decode = Schema.decodeUnknownSync(StoredSettings);
const encode = Schema.encodeSync(StoredSettings);

export class VoiceSettingsService extends Context.Service<
  VoiceSettingsService,
  {
    readonly getSettings: Effect.Effect<VoiceSettings, HyperVoiceSettingsError>;
    readonly updateSettings: (
      patch: VoiceSettingsPatch,
    ) => Effect.Effect<VoiceSettings, HyperVoiceSettingsError>;
  }
>()("hypertask/hyper-voice/VoiceSettingsService") {}

/** Keeps the settings in `file`. Writes are serialized and atomic (temp file, then rename). */
export const layer = (file: string) =>
  Layer.sync(VoiceSettingsService, () => {
    let cached: VoiceSettings | undefined;
    let queue: Promise<unknown> = Promise.resolve();
    const read = async () => {
      if (cached) return cached;
      try {
        cached = decode(JSON.parse(await NodeFs.readFile(file, "utf8")));
      } catch (error) {
        // A missing file is a fresh install; a damaged one falls back to defaults instead of breaking voice.
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT")
          console.warn("[hyper-voice] voice settings unreadable; using defaults", error);
        cached = decode({});
      }
      return cached;
    };
    const write = (patch: VoiceSettingsPatch) => {
      const next = queue.then(async () => {
        const current = await read();
        const merged = decode(
          encode({
            ...current,
            ...patch,
            cloudSpeechCredentials: {
              ...current.cloudSpeechCredentials,
              ...patch.cloudSpeechCredentials,
            },
          } as VoiceSettings),
        );
        await NodeFs.mkdir(NodePath.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await NodeFs.writeFile(temporary, JSON.stringify(encode(merged), null, 2), { mode: 0o600 });
        await NodeFs.rename(temporary, file);
        cached = merged;
        return merged;
      });
      queue = next.catch(() => undefined);
      return next;
    };
    return VoiceSettingsService.of({
      getSettings: Effect.tryPromise({
        try: read,
        catch: (cause) => new HyperVoiceSettingsError({ operation: "read", cause }),
      }),
      updateSettings: (patch) =>
        Effect.tryPromise({
          try: () => write(patch),
          catch: (cause) => new HyperVoiceSettingsError({ operation: "save", cause }),
        }),
    });
  });
