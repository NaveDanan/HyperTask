// Copied from t3code (apps/server/src/speech/fillerWords.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
const UNIVERSAL_FILLER_WORDS = [
  "uh",
  "uhm",
  "umm",
  "uhh",
  "uhhh",
  "ehh",
  "ehm",
  "ahm",
  "hmm",
  "hm",
  "mmm",
  "хм",
  "ммм",
] as const;

const LANGUAGE_FILLER_WORDS: Readonly<Record<string, readonly string[]>> = {
  en: ["um", "ah", "eh"],
  de: ["äh", "ähm"],
  fr: ["euh"],
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function removeSpeechFillerWords(
  text: string,
  language?: string,
  correctionCue?: string,
): string {
  const baseLanguage = language?.split(/[-_]/, 1)[0]?.toLowerCase();
  const words = [
    ...UNIVERSAL_FILLER_WORDS,
    ...(baseLanguage ? (LANGUAGE_FILLER_WORDS[baseLanguage] ?? []) : []),
  ];
  const cuePattern = correctionCue?.trim().split(/\s+/).map(escapeRegex).join("\\s+");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:(${cuePattern || "(?!)"})(?![\\p{L}\\p{N}_])|(?:${words.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])[,.]?)`,
    "giu",
  );
  const filtered = text.replace(pattern, (_match, cue: string | undefined) => cue ?? "");
  return filtered
    .replace(/[^\S\r\n]{2,}/g, " ")
    .replace(/[^\S\r\n]*([\r\n])[^\S\r\n]*/g, "$1")
    .trim();
}
