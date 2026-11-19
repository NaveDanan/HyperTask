// Copied from t3code (apps/web/src/speech/preferredSpeechLanguages.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: navigator.languages only (no desktop bridge).
// t3code puts the OS's own list first through its desktop bridge; HyperTask's Chromium reports the system languages
// in `navigator.languages` itself.
export function preferredSpeechLanguages() {
  return [...navigator.languages].map((tag) => tag.toLowerCase().split(/[-_]/)[0]!);
}
