// The host facts t3code's speech code reads, copied from t3code (packages/shared/src/HostProcess.ts),
// Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: only Platform, Architecture, LinuxLibc and HomeDirectory.
import * as Context from "effect/Context";
import * as NodeOS from "node:os";

export const Platform = Context.Reference<NodeJS.Platform>("@hypertask/hyper-voice/HostProcess/Platform", {
  defaultValue: () => process.platform,
});

export const Architecture = Context.Reference<NodeJS.Architecture>(
  "@hypertask/hyper-voice/HostProcess/Architecture",
  {
    defaultValue: () => process.arch,
  },
);

export const LinuxLibc = Context.Reference<"gnu" | "musl">(
  "@hypertask/hyper-voice/HostProcess/LinuxLibc",
  {
    defaultValue: () => {
      try {
        const report = process.report?.getReport() as
          | { header?: { glibcVersionRuntime?: unknown } }
          | undefined;
        return typeof report?.header?.glibcVersionRuntime === "string" ? "gnu" : "musl";
      } catch {
        return "musl";
      }
    },
  },
);

export const HomeDirectory = Context.Reference<string>(
  "@hypertask/hyper-voice/HostProcess/HomeDirectory",
  {
    defaultValue: () => NodeOS.homedir(),
  },
);
