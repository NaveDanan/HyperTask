// Copied from t3code (apps/server/src/speech/platform.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
const SUPPORTED_PLATFORMS = new Set([
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "linux-x64",
  "linux-arm64",
]);

export function isSpeechPlatformSupported(
  platform: string,
  architecture: string,
  libc: "gnu" | "musl" | undefined,
): boolean {
  return (
    (platform !== "linux" || libc === "gnu") &&
    SUPPORTED_PLATFORMS.has(`${platform}-${architecture}`)
  );
}
