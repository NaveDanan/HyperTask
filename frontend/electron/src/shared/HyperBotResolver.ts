import type { HyperBotConfig } from './HyperBots';

// Bilingual (English + Hebrew + mixed) bot mention and spoken-command trigger resolver.
// Preserves ASCII `bot.id` slugs in stored state while treating Unicode display names
// (such as "משה" or "אבי") and case-insensitive English names as first-class handles.

export type HyperBotLike = Pick<HyperBotConfig, 'id' | 'name'>;

export interface HyperBotMatch<T extends HyperBotLike = HyperBotLike> {
  bot: T;
  confidence: 'exact' | 'fuzzy';
  score: number;
}

export interface HyperBotMentionMatch<T extends HyperBotLike = HyperBotLike> {
  bot: T;
  botId: string;
  handle: string;
  confidence: 'exact' | 'fuzzy';
  source: 'at-mention' | 'spoken-trigger';
  matchedText: string;
  start: number;
  end: number;
  /** Present for spoken triggers: the remaining command text after the trigger phrase. */
  commandText?: string;
}

const HEBREW_CHAR = /[\u0590-\u05FF]/;
const LATIN_CHAR = /[A-Za-z]/;
const NON_ASCII = /[^\x00-\x7F]/;
const NIQQUD_AND_MARKS = /[\u0591-\u05C7\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const HEBREW_FINAL_MAP: Record<string, string> = {
  '\u05DA': '\u05DB', // ך -> כ
  '\u05DD': '\u05DE', // ם -> מ
  '\u05DF': '\u05E0', // ן -> נ
  '\u05E3': '\u05E4', // ף -> פ
  '\u05E5': '\u05E6', // ץ -> צ
};

/** Strips Hebrew niqqud, cantillation, bidi control chars and normalizes Unicode/quotes. */
export function hyperStripDiacritics(text: string): string {
  return text
    .normalize('NFC')
    .replace(NIQQUD_AND_MARKS, '')
    .replace(/[\u05F3\u2018\u2019]/g, "'")
    .replace(/[\u05F4\u201C\u201D]/g, '"');
}

/** Canonical comparison key for a bot id/name or spoken token. */
export function hyperNormalizeBotToken(text: string): string {
  return hyperStripDiacritics(text)
    .toLowerCase()
    .replace(/['"`.,!?;:()[\]{}<>]+/g, ' ')
    .replace(/[-_–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Phonetic / orthography folding for English & Hebrew STT variations (e.g., Abbey->Abby, אביי->אבי, מושה->משה). */
export function hyperPhoneticFold(text: string): string {
  const norm = hyperNormalizeBotToken(text);
  if (!norm) return '';
  return norm
    .split(' ')
    .map((word) => {
      if (HEBREW_CHAR.test(word)) {
        let w = word.replace(/[\u05DA\u05DD\u05DF\u05E3\u05E5]/g, (ch) => HEBREW_FINAL_MAP[ch] ?? ch);
        w = w.replace(/\u05D9{2,}/g, '\u05D9').replace(/\u05D5{2,}/g, '\u05D5');
        return w;
      }
      if (LATIN_CHAR.test(word)) {
        let w = word
          .replace(/ph/g, 'f')
          .replace(/ck/g, 'k')
          .replace(/c(?=[eiy])/g, 's')
          .replace(/([a-z])\1+/g, '$1');
        if (w.length >= 3) w = w.replace(/(?:ey|ie|y)$/, 'i');
        return w;
      }
      return word;
    })
    .join(' ');
}

/** Secondary Hebrew mater-lectionis folding (strips internal vav/yod vowel letters on 4+ char words, e.g. מושה -> משה). */
function hebrewConsonantSkeleton(text: string): string {
  const folded = hyperPhoneticFold(text);
  if (!HEBREW_CHAR.test(folded)) return folded;
  return folded
    .split(' ')
    .map((w) => {
      if (!HEBREW_CHAR.test(w) || w.length < 4) return w;
      return w[0] + w.slice(1, -1).replace(/[\u05D5\u05D9]/g, '') + w[w.length - 1];
    })
    .join(' ');
}

export function hyperLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/**
 * Generates candidate token forms after stripping Hebrew proclitic prepositions/prefixes:
 * e.g. "למשה" -> ["למשה", "משה"], "ל-Abby" -> ["ל-Abby", "Abby"], "ולאבי" -> ["ולאבי", "לאבי", "אבי"].
 */
export function hyperStripHebrewPrefixes(raw: string): string[] {
  const cleaned = hyperStripDiacritics(raw).trim();
  if (!cleaned) return [];
  const out = new Set<string>([cleaned]);

  // Leading standalone preposition word: "את משה", "אל אבי", "עם אבי", "ל אבי", "מ משה"
  const standalone = /^(?:את|אל|עם|דרך|ל|מ|ב|ש|ו)\s+(.+)$/u.exec(cleaned);
  if (standalone?.[1] && standalone[1].trim().length >= 2) {
    out.add(standalone[1].trim());
  }

  // Hyphenated Hebrew prefix before Hebrew or English name: "ל-Abby", "מ-משה", "ב-Scout"
  const hyphenated = /^[למבהושכ][-–—](.+)$/u.exec(cleaned);
  if (hyphenated?.[1] && hyphenated[1].trim().length >= 2) {
    out.add(hyphenated[1].trim());
  }

  // Attached Hebrew proclitic prefixes (1 or 2 letters, e.g. ל, מ, ב, ה, ו, ש, כ, ול, ומ, וב, לה, מה, בה, של, כש)
  if (HEBREW_CHAR.test(cleaned[0] ?? '')) {
    if (/^[למבהושכ]/u.test(cleaned) && cleaned.length >= 3) {
      const one = cleaned.slice(1);
      out.add(one);
      // Compound prefix like "ולמשה", "שלאבי", "מהאבי", "להאבי"
      if (/^[למבה]/u.test(one) && one.length >= 3) {
        out.add(one.slice(1));
      }
    }
  }

  return [...out];
}

/**
 * Display handle for a bot: `@<lowercase-ascii-id>` for ASCII bots (e.g. `@abby`, `@scout`),
 * and `@<Unicode name>` for non-ASCII bots (e.g. `@משה`, `@אבי`).
 */
export function hyperBotDisplayHandle(bot: HyperBotLike): string {
  const name = bot.name.trim();
  if (NON_ASCII.test(name)) return '@' + name;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug && bot.id.toLowerCase() === slug) return '@' + bot.id;
  if (/^bot(?:-\d+)?$/i.test(bot.id) && slug) return '@' + slug;
  return '@' + bot.id;
}

const ROMAN_VOWELS = ['a', 'e', 'i', 'o', 'u'];
const HEBREW_ROMAN_SPELLINGS: Record<string, readonly string[]> = {
  א: ['', ...ROMAN_VOWELS], ב: ['b', 'v'], ג: ['g'], ד: ['d'], ה: ['h'],
  ו: ['ou', 'oo', 'o', 'u', 'v', 'w'], ז: ['z'], ח: ['ch', 'kh', 'h'], ט: ['t'],
  י: ['ee', 'i', 'y', 'e'], כ: ['ch', 'kh', 'k', 'c'], ל: ['l'], מ: ['m'],
  נ: ['n'], ס: ['s'], ע: ['', ...ROMAN_VOWELS], פ: ['p', 'f'], צ: ['ts', 'tz'],
  ק: ['k', 'c', 'q'], ר: ['r'], ש: ['sh', 's'], ת: ['t'],
};
const HEBREW_VOWEL_LETTERS = /[אהויע]/u;

/** Tests common unpointed Hebrew spellings against a Latin name word by word. */
function matchesHebrewRomanization(hebrew: string, latin: string): boolean {
  if (!/^[א-ת]+(?: [א-ת]+)*$/u.test(hebrew) || !/^[a-z]+(?: [a-z]+)*$/u.test(latin)) return false;
  const words = hebrew.split(' ');
  const roman = latin.split(' ');
  if (words.length !== roman.length) return false;
  return words.every((word, index) => {
    const target = roman[index]!;
    if (word.length < 2 || word.length > 40 || target.length < 3 || target.length > 40) return false;
    let positions = new Set([0]);
    for (let position = 0; position < word.length; position++) {
      const letter = word[position]!;
      const next = word[position + 1];
      const spellings = letter === 'ה' && !next ? ['h', 'a', 'e'] : HEBREW_ROMAN_SPELLINGS[letter]!;
      const allowVowel = next && !HEBREW_VOWEL_LETTERS.test(letter) && !HEBREW_VOWEL_LETTERS.test(next);
      const matched = new Set<number>();
      for (const start of positions) {
        for (const spelling of spellings) {
          if (!target.startsWith(spelling, start)) continue;
          const end = start + spelling.length;
          matched.add(end);
          if (allowVowel && ROMAN_VOWELS.includes(target[end] ?? '')) matched.add(end + 1);
        }
      }
      if (!matched.size) return false;
      positions = matched;
    }
    return positions.has(target.length);
  });
}

/** Scores a candidate string against a single bot's id and name. Returns null if not a plausible match. */
function scoreBotCandidate<T extends HyperBotLike>(
  rawCandidate: string,
  bot: T,
  transliterate: boolean,
): HyperBotMatch<T> | null {
  const variants = hyperStripHebrewPrefixes(rawCandidate);
  if (!variants.length) return null;

  const idNorm = hyperNormalizeBotToken(bot.id);
  const nameNorm = hyperNormalizeBotToken(bot.name);
  const targets = [...new Set([nameNorm, idNorm].filter(Boolean))];
  const foldedTargets = [...new Set(targets.map(hyperPhoneticFold).filter(Boolean))];
  const skeletonTargets = [...new Set(targets.map(hebrewConsonantSkeleton).filter(Boolean))];

  let best: HyperBotMatch<T> | null = null;
  const consider = (confidence: 'exact' | 'fuzzy', score: number) => {
    if (!best || score > best.score) best = { bot, confidence, score };
  };

  for (let vi = 0; vi < variants.length; vi++) {
    const variant = variants[vi]!;
    const norm = hyperNormalizeBotToken(variant);
    if (!norm) continue;
    const prefixPenalty = vi === 0 ? 0 : 0.01;

    // 1. Exact normalized match on bot.name or bot.id
    if (targets.includes(norm)) {
      consider('exact', 1 - prefixPenalty);
      continue;
    }

    // 2. Phonetic-folded exact match (e.g., Abbey -> Abby, אביי -> אבי)
    const folded = hyperPhoneticFold(norm);
    if (folded && foldedTargets.includes(folded)) {
      consider('fuzzy', 0.93 - prefixPenalty);
      continue;
    }

    // 3. Hebrew mater-lectionis skeleton match (e.g., מושה -> משה)
    if (HEBREW_CHAR.test(norm)) {
      const skel = hebrewConsonantSkeleton(norm);
      if (skel.length >= 2 && skeletonTargets.includes(skel)) {
        consider('fuzzy', 0.9 - prefixPenalty);
        continue;
      }
    }

    if (transliterate && foldedTargets.some(target =>
      HEBREW_CHAR.test(folded) ? matchesHebrewRomanization(folded, target) : matchesHebrewRomanization(target, folded),
    )) {
      consider('fuzzy', 0.91 - prefixPenalty);
      continue;
    }

    // 4. Bounded Levenshtein distance on single or multi-word tokens
    for (const target of targets) {
      if (Math.abs(norm.length - target.length) > 2) continue;
      // Avoid matching Latin candidate against Hebrew target (or vice versa) via tiny edit distance
      if (HEBREW_CHAR.test(norm) !== HEBREW_CHAR.test(target)) continue;
      const minLen = Math.min(norm.length, target.length);
      if (minLen < 3) continue;
      const maxDist = minLen >= 6 ? 2 : 1;
      const dist = hyperLevenshtein(norm, target);
      if (dist <= maxDist) {
        consider('fuzzy', 0.86 - dist * 0.08 - prefixPenalty);
      } else if (folded) {
        const fTarget = hyperPhoneticFold(target);
        if (Math.min(folded.length, fTarget.length) >= 3) {
          const fDist = hyperLevenshtein(folded, fTarget);
          if (fDist <= 1) consider('fuzzy', 0.82 - prefixPenalty);
        }
      }
    }
  }

  return best;
}

/** Matches a raw candidate bot name/handle against all configured bots. */
export function matchBotName<T extends HyperBotLike>(
  rawCandidate: string,
  bots: readonly T[],
  transliterate = false,
): HyperBotMatch<T> | null {
  let best: HyperBotMatch<T> | null = null;
  let tied = false;
  for (const bot of bots) {
    const match = scoreBotCandidate(rawCandidate, bot, transliterate);
    if (!match) continue;
    if (!best || match.score > best.score + 0.001) {
      best = match;
      tied = false;
    } else if (Math.abs(match.score - best.score) <= 0.001) {
      // Exact matches beat fuzzy ones at the same score.
      if (match.confidence === 'exact' && best.confidence !== 'exact') {
        best = match;
        tied = false;
      } else if (match.confidence === best.confidence) {
        tied = true;
      }
    }
  }
  if (!best) return null;
  if (tied && best.confidence === 'fuzzy') return null;
  return best;
}

function matchVoiceBotName<T extends HyperBotLike>(name: string, bots: readonly T[]) {
  return matchBotName(name, bots, true);
}

const PERSON_MAILTO_TOKEN = /^@\[(?:\\.|[^\]\\\r\n])*\]\(mailto:[^\s()]+\)/u;
const MENTION_PREFIX_BOUNDARY = /[\s([{"'׳״,;:]/;

/**
 * Extracts explicit `@...` bot mentions in English (case-insensitive), Hebrew (`@משה`, `@אבי`),
 * and multi-word bot names (`@Sales Bot`, `@בוט מכירות`). Skips emails (`a@b.com`) and
 * serialized employee mentions (`@[Name](mailto:...)`).
 */
export function extractExplicitBotMentions<T extends HyperBotLike>(
  text: string,
  bots: readonly T[],
  matchName: typeof matchBotName = matchBotName,
): HyperBotMentionMatch<T>[] {
  if (!text || !bots.length) return [];
  const maxWords = Math.max(1, ...bots.map((b) => hyperNormalizeBotToken(b.name).split(' ').filter(Boolean).length));
  const results: HyperBotMentionMatch<T>[] = [];
  const byId = new Map(bots.map((bot) => [bot.id.toLowerCase(), bot]));
  const seen = new Set<string>();

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    if (i > 0 && !MENTION_PREFIX_BOUNDARY.test(text[i - 1]!)) continue;
    const tail = text.slice(i);
    if (PERSON_MAILTO_TOKEN.test(tail)) continue;

    // Collect up to maxWords consecutive word-like tokens after '@'
    const afterAt = tail.slice(1);
    const wordMatch = /^([A-Za-z0-9\u0590-\u05FF_-]+(?:[ \t]+[A-Za-z0-9\u0590-\u05FF_-]+)*)/u.exec(afterAt);
    const spanText = wordMatch?.[1];
    if (!spanText) continue;

    // Tokenize with offsets to try longest N-gram down to 1 word
    const tokens: Array<{ end: number }> = [];
    for (const m of spanText.matchAll(/[A-Za-z0-9\u0590-\u05FF_-]+/gu)) {
      tokens.push({ end: (m.index ?? 0) + m[0].length });
      if (tokens.length >= maxWords) break;
    }

    let picked: { match: HyperBotMatch<T>; endOffset: number } | null = null;
    for (let count = tokens.length; count >= 1; count--) {
      const endOffset = tokens[count - 1]!.end;
      const candidate = spanText.slice(0, endOffset);
      const bot = byId.get(candidate.toLowerCase());
      const match: HyperBotMatch<T> | null = bot ? { bot, confidence: 'exact', score: 1 } : matchName(candidate, bots);
      if (match) {
        // Prefer exact multi-word match over partial fuzzy match
        if (!picked || match.score > picked.match.score || (match.score === picked.match.score && endOffset > picked.endOffset)) {
          picked = { match, endOffset };
        }
        if (match.confidence === 'exact') break;
      }
    }

    if (picked && !seen.has(picked.match.bot.id)) {
      seen.add(picked.match.bot.id);
      const end = i + 1 + picked.endOffset;
      results.push({
        bot: picked.match.bot,
        botId: picked.match.bot.id,
        handle: hyperBotDisplayHandle(picked.match.bot),
        confidence: picked.match.confidence,
        source: 'at-mention',
        matchedText: text.slice(i, end),
        start: i,
        end,
      });
      i = end - 1;
    }
  }

  return results;
}

// Conversational trigger prefixes in English, Hebrew, and mixed EN+HE.
const EN_TRIGGER_PREFIX =
  /^(?:(?:hey|hi|hello|ok|okay|yo|please|can\s+you|could\s+you|would\s+you)\s+)*(?:tell|ask|have|get|ping|message|use|contact|talk\s+to|speak\s+to|via|through)\s+(?:the\s+bot\s+|bot\s+)?/iu;
const EN_VOCATIVE_PREFIX = /^(?:hey|hi|hello|ok|okay|yo)\s+/iu;

const HE_TRIGGER_PREFIX =
  /^(?:(?:היי|הי|שלום|בבקשה|אפשר|תוכל|תוכלי)\s+)*(?:תגיד|תגידי|תאמר|תאמרי|אמור|אמרי|תבקש|תבקשי|בקש|בקשי|דבר|דברי|תפנה|תפני|פנה|פני|שלח|שלחי|תשלח|תשלחי|תשתמש|השתמש)\s+(?:דרך\s+|באמצעות\s+|ב[-–—]\s*|אל\s+|עם\s+|את\s+|ל[-–—]\s*|מ[-–—]\s*)?/u;
const HE_VOCATIVE_PREFIX = /^(?:היי|הי|שלום)\s+/u;

const TRIGGER_JOINER = /^(?:\s*[,:\-–—]\s*|\s+(?:to|that)\s+|\s+)/iu;
const VOCATIVE_JOINER = /^\s*[,:\-–—]\s*(?=\S)/u;

const EN_VOICE_REQUEST =
  /^(?:please\s+)?(?:(?:i|we)\s+(?:need(?:ed)?|want(?:ed)?|would\s+like)|(?:i|we)['’]d\s+like)\s+(?:(?:you\s+)?to\s+(use|ask|tell|have|get)\s+)?(?:the\s+bot\s+|bot\s+)?/iu;
const EN_VOICE_REQUEST_JOINER =
  /^(?:\s*,?\s+(?:to\s+|(?:and\s+then|then)\s+(?:with\s+(?:her|him|them|it)\s+)?)|\s*:\s*)(?=\S)/iu;
const EN_VOICE_USING = /^(?:please\s+)?using\s+(?:the\s+bot\s+|bot\s+)?/iu;
const EN_VOICE_USING_JOINER = /^\s*[,:]\s*(?=\S)/u;
const EN_VOICE_USE_AND = /^\s*,?\s+and\s+(?=\S)/iu;
const HE_VOICE_REQUEST =
  /^(?:אני\s+)?(?:צריך|צריכה|רוצה|רציתי|הייתי\s+(?:צריך|צריכה))\s+(?:להשתמש\s+(?=ב)|לבקש\s+(?=מ)|(?:להגיד|לומר)\s+(?=ל))/u;
const HE_VOICE_REQUEST_JOINER =
  /^(?:\s*,?\s+(?:כדי|ואז|ואחר\s+כך)\s+(?:(?:איתה|איתו|איתם|איתן)\s+)?|\s*:\s*)(?=\S)/u;
const HE_VOICE_DESIRE = /(?:אני\s+)?(?:צריך|צריכה|רוצה|רציתי|הייתי\s+(?:צריך|צריכה))/u;
const HE_VOICE_WANT = new RegExp('^' + HE_VOICE_DESIRE.source + '\\s+(?=ש)', 'u');
const HE_VOICE_ACTION =
  /[תי](?:בדו?ק|וודא|סקו?ר|סכ[מם]|קבע|שלח|כתו?ב|מצא|פתח|חפש|ענ[הו]?|ארגנ?|תא[מם])(?:[יוה])?(?=\s|$)/u;
const HE_VOICE_ACTION_JOINER = new RegExp('^\\s*,?\\s*(?=' + HE_VOICE_ACTION.source + ')', 'u');
// For indirect requests, accept exact or phonetic matches but skip edit-distance guesses such as "data" for Dana.
const MIN_VOICE_REQUEST_SCORE = 0.89;

function tryMatchLeadingBot<T extends HyperBotLike>(
  fullText: string,
  candidateStart: number,
  bots: readonly T[],
  requiredJoiner?: RegExp,
  minimumScore = 0,
  matchName: typeof matchBotName = matchBotName,
): HyperBotMentionMatch<T> | null {
  const rest = fullText.slice(candidateStart);
  if (!rest) return null;
  const maxWords = Math.max(1, ...bots.map((b) => hyperNormalizeBotToken(b.name).split(' ').filter(Boolean).length));

  const tokens: Array<{ start: number; end: number }> = [];
  const tokenRe = /[A-Za-z0-9\u0590-\u05FF'׳"-]+/gu;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rest)) !== null) {
    // Stop scanning candidate tokens if there's punctuation other than hyphen/apostrophe between words
    if (tokens.length > 0) {
      const gap = rest.slice(tokens[tokens.length - 1]!.end, m.index);
      if (/[^\s]/.test(gap)) break;
    }
    tokens.push({ start: m.index, end: m.index + m[0].length });
    if (tokens.length >= maxWords) break;
  }
  if (!tokens.length || tokens[0]!.start > 0) return null;

  let picked: { match: HyperBotMatch<T>; end: number; commandStart: number } | undefined;
  for (let count = tokens.length; count >= 1; count--) {
    const end = tokens[count - 1]!.end;
    const joiner = (requiredJoiner ?? TRIGGER_JOINER).exec(rest.slice(end));
    if (requiredJoiner && !joiner) continue;
    const match = matchName(rest.slice(0, end), bots);
    if (!match || match.score < minimumScore) continue;
    const candidate = { match, end, commandStart: end + (joiner?.[0].length ?? 0) };
    if (match.confidence === 'exact') {
      picked = candidate;
      break;
    }
    if (!picked || match.score > picked.match.score) picked = candidate;
  }
  if (!picked) return null;
  const { match, end: endInRest, commandStart } = picked;

  return {
    bot: match.bot,
    botId: match.bot.id,
    handle: hyperBotDisplayHandle(match.bot),
    confidence: match.confidence,
    source: 'spoken-trigger',
    matchedText: fullText.slice(0, candidateStart + endInRest),
    start: 0,
    end: candidateStart + endInRest,
    commandText: rest.slice(commandStart).trim(),
  };
}

/**
 * Extracts a conversational spoken bot trigger from English, Hebrew, or mixed EN+HE commands:
 * - EN: "Tell Abby to set meeting...", "Ask Abby to...", "Hey Abby, ...", "Abby, ..."
 * - HE: "תגיד למשה...", "תגידי לאבי...", "בקש מאבי...", "היי משה...", "משה, ...", "שלח דרך משה..."
 * - Mixed: "תגיד ל-Abby...", "Tell אבי to..."
 */
export function extractSpokenBotTrigger<T extends HyperBotLike>(
  text: string,
  bots: readonly T[],
  matchName: typeof matchBotName = matchBotName,
): HyperBotMentionMatch<T> | null {
  if (!text || !bots.length) return null;
  const leadingWs = /^\s*/.exec(text)?.[0].length ?? 0;
  const trimmed = text.slice(leadingWs);
  if (!trimmed) return null;

  // 1. Verb-based triggers (English & Hebrew)
  for (const re of [EN_TRIGGER_PREFIX, HE_TRIGGER_PREFIX]) {
    const prefix = re.exec(trimmed);
    if (prefix) {
      const hit = tryMatchLeadingBot(text, leadingWs + prefix[0].length, bots, undefined, 0, matchName);
      if (hit) return hit;
    }
  }

  // 2. Greeting vocatives ("Hey Abby ...", "היי משה ...")
  for (const re of [EN_VOCATIVE_PREFIX, HE_VOCATIVE_PREFIX]) {
    const prefix = re.exec(trimmed);
    if (prefix) {
      const hit = tryMatchLeadingBot(text, leadingWs + prefix[0].length, bots, undefined, 0, matchName);
      if (hit) return hit;
    }
  }

  // 3. Direct punctuated vocative at start ("Abby, set a meeting...", "משה, תקבע פגישה...")
  const direct = tryMatchLeadingBot(text, leadingWs, bots, VOCATIVE_JOINER, 0, matchName);
  if (direct) return direct;

  return null;
}

/** Resolves the voice assistant's target, including first-person delegation before the task. */
export function extractVoiceBotMention<T extends HyperBotLike>(
  text: string,
  bots: readonly T[],
): HyperBotMentionMatch<T> | null {
  if (!text || !bots.length) return null;
  const explicit = extractExplicitBotMentions(text, bots, matchVoiceBotName)[0];
  if (explicit) return explicit;

  const command = text.trimStart();
  const leadingWhitespace = text.length - command.length;
  const check = HE_VOICE_CHECK_WITH.exec(command);
  if (check) {
    const hit = matchVoiceBotName(check[2]!, bots);
    if (hit && hit.score >= MIN_VOICE_REQUEST_SCORE) {
      const end = text.length - check[3]!.length;
      return {
        bot: hit.bot,
        botId: hit.bot.id,
        handle: hyperBotDisplayHandle(hit.bot),
        confidence: hit.confidence,
        source: 'spoken-trigger',
        matchedText: text.slice(0, end).trimEnd(),
        start: 0,
        end,
        commandText: check[1] + ' ' + check[3],
      };
    }
  }

  for (const [request, joiner] of [
    [EN_VOICE_REQUEST, EN_VOICE_REQUEST_JOINER],
    [EN_VOICE_USING, EN_VOICE_USING_JOINER],
    [HE_VOICE_REQUEST, HE_VOICE_REQUEST_JOINER],
    [HE_VOICE_WANT, HE_VOICE_ACTION_JOINER],
  ] as const) {
    const prefix = request.exec(command);
    if (!prefix) continue;
    const start = leadingWhitespace + prefix[0].length;
    const match = tryMatchLeadingBot(text, start, bots, joiner, MIN_VOICE_REQUEST_SCORE, matchVoiceBotName);
    if (match) return match;
    if (prefix[1]?.toLowerCase() === 'use') {
      const joined = tryMatchLeadingBot(text, start, bots, EN_VOICE_USE_AND, MIN_VOICE_REQUEST_SCORE, matchVoiceBotName);
      if (joined?.commandText && !tryMatchLeadingBot(joined.commandText, 0, bots, undefined, MIN_VOICE_REQUEST_SCORE, matchVoiceBotName)) {
        return joined;
      }
    }
  }

  return extractSpokenBotTrigger(text, bots, matchVoiceBotName) ??
    tryMatchLeadingBot(text, leadingWhitespace, bots, HE_VOICE_ACTION_JOINER, MIN_VOICE_REQUEST_SCORE, matchVoiceBotName);
}

const EN_VOICE_GROUP_MEMBERS =
  /^((?:please\s+)?(?:make\s+sure|ensure)\s+(?:that\s+)?)(.+?)(\s+are\s+(?:both\s+)?in\s+(?:(?:this|the|a)\s+)?(?:same\s+)?(?:group\s+)?(?:chat|conversation)[.!?]*)$/iu;
const EN_VOICE_OPEN_GROUP =
  /^((?:please\s+)?(?:open|start|create)\s+(?:(?:the|a)\s+)?(?:group\s+)?(?:chat|conversation)\s+with\s+)(.+?)([.!?]*)$/iu;
const EN_VOICE_CHECK_WITH =
  /^(?:please\s+)?(?:(?:i|we)\s+(?:need(?:ed)?|want(?:ed)?)\s+(?:you\s+)?to\s+)?(verify|check|confirm|review|double-check)\s+with\s+(.+?)\s*,?\s+((?:that|whether|if)\s+\S[\s\S]*)$/iu;
const EN_VOICE_DELEGATE_GROUP =
  /^(?:please\s+)?(?:(?:i|we)\s+(?:need(?:ed)?|want(?:ed)?)\s+(?:you\s+)?to\s+|(?:can|could|would)\s+you\s+)?(?:ask|tell|use|get|have)\s+(.+?)\s+to\s+(\S[\s\S]*)$/iu;
const EN_VOICE_USING_GROUP = /^(?:please\s+)?using\s+(.+?)[,:]\s*(\S[\s\S]*)$/iu;
const HE_VOICE_OPEN_GROUP =
  /^((?:בבקשה\s+)?(?:ת?פתח[יו]?|צור|צרי|תיצור|תיצרי|התחל|התחילי)\s+(?:שיח[הת]|צ['׳]?אט)(?:\s+(?:קבוצתי|קבוצתית))?\s+עם\s+)(.+?)([.!?]*)$/u;
const HE_VOICE_GROUP_MEMBERS =
  /^((?:בבקשה\s+)?(?:ודא|ודאי|תוודא|תוודאי)\s+ש)(.+?)(\s+(?:(?:שניהם|שתיהן|נמצאים|נמצאות)\s+)*ב(?:שיחה|צ['׳]?אט|אותה\s+שיחה)[.!?]*)$/u;
const HE_VOICE_CHECK_WITH = new RegExp(
  '^(?:בבקשה\\s+)?(?:' + HE_VOICE_DESIRE.source + '\\s+)?' +
  '(לבדוק|לוודא|בדוק|בדקי|תבדוק|תבדקי|ודא|ודאי|תוודא|תוודאי)\\s+עם\\s+(.+?)\\s*,?\\s+((?:ש|(?:אם|מה|מתי|איזה|אילו|מי)\\s+)\\S[\\s\\S]*)$',
  'u',
);
const HE_VOICE_WANT_GROUP = new RegExp(
  '^' + HE_VOICE_DESIRE.source + '\\s+ש\\s*(.+?)\\s*,?\\s+(' + HE_VOICE_ACTION.source + '(?:\\s+\\S[\\s\\S]*)?)$',
  'u',
);
const HE_VOICE_ADDRESS_GROUP = new RegExp(
  HE_VOCATIVE_PREFIX.source + '(.+?)(?:\\s*[:,]\\s*|\\s+(?=' + HE_VOICE_ACTION.source + '))(\\S[\\s\\S]*)$',
  'u',
);
const HE_VOICE_DELEGATE_TASK =
  /^(.+?)\s+(?:כדי\s+)?((?:ל[א-ת]{2,}|ש[תי][א-ת]{2,})\s+\S[\s\S]*)$/u;

function matchVoiceBotList(text: string, bots: readonly HyperBotLike[]) {
  const parts = text.split(/(\s*,\s*(?:and\s+|ו\s*)?|\s+(?:and|&|ו)\s+|\s+ו(?=[\p{L}@]))/iu);
  if (parts.length < 3) return null;
  const wholeName = matchVoiceBotName(text, bots);
  if (wholeName && wholeName.score >= MIN_VOICE_REQUEST_SCORE) return null;

  const botIds = new Set<string>();
  const unresolved: string[] = [];
  const handles = parts.map((name, index) => {
    if (index % 2) return name.endsWith('ו') ? name + ' ' : name;
    const trimmed = name.trim();
    const query = trimmed.replace(/^@/, '');
    const idMatch = trimmed.startsWith('@') ? bots.find((bot) => bot.id === query.toLowerCase()) : undefined;
    const nameMatch = idMatch ? null : matchVoiceBotName(query, bots);
    const bot = idMatch ?? (nameMatch && nameMatch.score >= MIN_VOICE_REQUEST_SCORE ? nameMatch.bot : null);
    if (!bot) {
      unresolved.push(trimmed);
      return name;
    }
    botIds.add(bot.id);
    return hyperBotDisplayHandle(bot);
  });
  return { botIds: [...botIds], taggedNames: handles.join(''), unresolved };
}

/** Recognizes a request to open a conversation with a named list of bots. */
export function extractVoiceBotConversation(text: string, bots: readonly HyperBotLike[]) {
  const match = EN_VOICE_GROUP_MEMBERS.exec(text) ?? EN_VOICE_OPEN_GROUP.exec(text) ??
    HE_VOICE_GROUP_MEMBERS.exec(text) ?? HE_VOICE_OPEN_GROUP.exec(text);
  if (!match) return null;
  const [, prefix, memberText, suffix] = match;
  const members = matchVoiceBotList(memberText!, bots);
  return members && { ...members, normalizedText: (prefix!.endsWith('ש') ? prefix + ' ' : prefix) + members.taggedNames + suffix };
}

/** Separates the addressed bots from the action they should perform together. */
export function extractVoiceBotGroupTask(text: string, bots: readonly HyperBotLike[]) {
  const explicit = extractExplicitBotMentions(text, bots, matchVoiceBotName);
  if (explicit.length >= 2 && !text.slice(0, explicit[0]!.start).trim() &&
      explicit.every((match, index) => index === 0 || /^[\s,]*(?:(?:and|ו)\s+)?$/iu.test(text.slice(explicit[index - 1]!.end, match.start)))) {
    const commandText = text.slice(explicit.at(-1)!.end).replace(/^[\s,:-]+/, '').trim();
    if (commandText) return { botIds: explicit.map(match => match.botId), unresolved: [], commandText };
  }

  const check = EN_VOICE_CHECK_WITH.exec(text) ?? HE_VOICE_CHECK_WITH.exec(text);
  const hebrewPrefix = check ? null : HE_VOICE_REQUEST.exec(text) ?? HE_TRIGGER_PREFIX.exec(text);
  const delegate = check ? null : EN_VOICE_DELEGATE_GROUP.exec(text) ?? EN_VOICE_USING_GROUP.exec(text);
  const request = delegate ?? HE_VOICE_WANT_GROUP.exec(text) ?? HE_VOICE_ADDRESS_GROUP.exec(text) ??
    (hebrewPrefix ? HE_VOICE_DELEGATE_TASK.exec(text.slice(hebrewPrefix[0].length)) : null);
  if (!check && !request) return null;
  const names = check?.[2] ?? request![1]!;
  const members = matchVoiceBotList(names, bots);
  if (!members?.botIds.length) return null;
  const commandText = check ? check[1]!.toLowerCase() + ' ' + check[3] : request![2]!;
  return { ...members, commandText };
}

/**
 * Resolves bot mentions from text: explicit `@` mentions take precedence; falls back to
 * conversational English/Hebrew spoken triggers when no explicit `@` bot mention is present.
 */
export function extractBotMentions<T extends HyperBotLike>(
  text: string,
  bots: readonly T[],
): HyperBotMentionMatch<T>[] {
  const explicit = extractExplicitBotMentions(text, bots);
  if (explicit.length) return explicit;
  const spoken = extractSpokenBotTrigger(text, bots);
  return spoken ? [spoken] : [];
}

/** Filters bots for `@` autocomplete popovers in English and Hebrew. */
export function filterBotsByQuery<T extends HyperBotLike>(
  query: string,
  bots: readonly T[],
): Array<{ bot: T; handle: string }> {
  const clean = hyperNormalizeBotToken(query.replace(/^@/, ''));
  const mapped = bots.map((bot) => ({ bot, handle: hyperBotDisplayHandle(bot) }));
  if (!clean) return mapped;
  return mapped.filter(({ bot, handle }) => {
    const idNorm = hyperNormalizeBotToken(bot.id);
    const nameNorm = hyperNormalizeBotToken(bot.name);
    const handleNorm = hyperNormalizeBotToken(handle.replace(/^@/, ''));
    return (
      idNorm.includes(clean) ||
      nameNorm.includes(clean) ||
      handleNorm.includes(clean) ||
      hyperPhoneticFold(nameNorm).includes(hyperPhoneticFold(clean))
    );
  });
}
