// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask by NaveDanan. See REUSE.md.
/** Normalized realtime controls shared by provider transports. Audio never goes through AG-UI. */
export type VoiceEvent = Record<string, unknown> & { type: string };

export interface VoiceConnection {
  stream: MediaStream;
  send(event: VoiceEvent): void;
  mute(muted: boolean): void;
  close(): void;
}

export type ConnectVoice = (options: {
  channelId: string;
  signal: AbortSignal;
  onEvent(event: VoiceEvent): void;
  onError(error: Error): void;
  onOutput(stream: MediaStream): void;
}) => Promise<VoiceConnection>;
