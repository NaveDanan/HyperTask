// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask by NaveDanan. See LICENSE.copilotkit.
export { HYPER_BOT_AUDIO_BYTES as MAX_DICTATION_BYTES } from '@shared/HyperBots';
export const MAX_DICTATION_SECONDS = 120;

export function dictationMediaType(type: string): string {
  const base = type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  // Bun's multipart parser can infer the container MIME from the filename.
  if (base === "video/webm") return "audio/webm";
  if (base === "video/mp4") return "audio/mp4";
  if (base === "audio/x-wav") return "audio/wav";
  return base;
}
