export type VoiceTranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type SaveHyperVoiceSessionInput = {
  id: string;
  channelId: string;
  anchorMessageId: string | null;
  startedAt: string;
  endedAt: string;
  transcript: VoiceTranscriptEntry[];
};

export type HyperVoiceSessionRecord = SaveHyperVoiceSessionInput & {
  durationSeconds: number;
  summary: string | null;
  summaryStatus: "ready" | "failed";
};

export type HyperVoiceSessionPage = {
  sessions: HyperVoiceSessionRecord[];
  nextCursor: string | null;
};
