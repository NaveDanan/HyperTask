import { z } from 'zod';
import { HYPER_ASSISTANT_MAX_PEOPLE, type HyperAssistantBotCandidate,
  type HyperAssistantIntent,
  type HyperAssistantLanguage,
  type HyperAssistantPersonSlot,
  type HyperVoiceCommandPlan,
} from '@shared/HyperAssistant';
import type { HyperBotConfig, HyperBotsRoom, HyperBotsSettings, HyperBotsToolName } from '@shared/HyperBots';
import {
  extractBotMentions,
  hyperBotDisplayHandle,
  hyperStripDiacritics,
} from '@shared/HyperBotResolver';
import { hyperFindPlainPersonSpan, hyperParseMentions, hyperSerializeMention } from '@shared/HyperPeopleMentions';
import { SettingsError } from './settings-error';
import { hyperCleanPersonQuery, type HyperPeopleResolver } from './HyperPeopleResolver';

// Hybrid bilingual (English + Hebrew + mixed) voice command parser.
// Deterministic-first extraction of bot triggers, intent, and co-worker spans,
// backed by HyperPeopleResolver (AD + Outlook Contacts/GAL/recent correspondents),
// with optional bounded LLM structured refinement when deterministic extraction is incomplete.

export interface HyperCommandParserOptions {
  peopleResolver: HyperPeopleResolver;
  /** Optional fast LLM refinement callback (must honor AbortSignal). Never blocks if absent or failing. */
  refineWithLlm?: (prompt: string, signal: AbortSignal) => Promise<string | null>;
  llmTimeoutMs?: number;
}

interface ExtractedSpan {
  rawName: string;
  query: string;
  start: number;
  end: number;
  role: HyperAssistantPersonSlot['role'];
  /** Present when the user already supplied a verified @[Name](mailto:email) token. */
  presetEmail?: string;
  /** True when a Hebrew proclitic like `ל` was glued to the start of rawName (e.g. `לישראל ישראלי`). */
  hadGluedPrefix?: string;
}

const HEBREW_RE = /[\u0590-\u05FF]/g;
const LATIN_RE = /[A-Za-z]/g;
const EMAIL_RE = /^[^\s@<>()[\]\\]+@[^\s@<>()[\]\\]+\.[^\s@<>()[\]\\]+$/u;

export function detectCommandLanguage(text: string): HyperAssistantLanguage {
  const heCount = (text.match(HEBREW_RE) ?? []).length;
  const enCount = (text.match(LATIN_RE) ?? []).length;
  if (heCount > 0 && enCount > 0) {
    // Require meaningful presence of both scripts (not just a single "PM" or "CC")
    if (heCount >= 2 && enCount >= 3) return 'mixed';
    return heCount >= enCount ? 'he' : 'en';
  }
  return heCount > 0 ? 'he' : 'en';
}

const EN_MEETING_CREATE =
  /\b(?:(?:set(?:\s+up)?|schedule|book|create|arrange|organize|plan|add|put)\b[^.!?\n]*\b(?:meeting|event|call|sync|appointment|session|catch[\s-]?up|1:1|invite|invitation|calendar)\b|invite\s+\S+|meet(?:ing)?\s+with\b)/iu;
const HE_MEETING_CREATE =
  /(?:(?:תקבע|תקבעי|לקבוע|קבע|קבעי|תזמן|תזמני|לזמן|זמן|זמני|תתאם|תתאמי|לתאם|תאם|תאמי|תוסיף|להוסיף|צור|ליצור|תארגן|לארגן|שיקבע|שתקבע|שיתאם|שיזמן)[^.!?\n]*(?:פגישה|ישיבה|שיחה|אירוע|זימון|יומן)|(?:פגישה|ישיבה|שיחה)\s+עם\b|(?:תזמין|להזמין|הזמן)\s+(?:את\s+)?\S+)/u;

const EN_EMAIL_SEND =
  /\b(?:(?:send|write|compose|draft|shoot)\s+(?:an?\s+)?(?:e-?mail|mail|message|note)|e-?mail\s+(?!list|inbox|unread|messages\b)\S+|mail\s+(?:to\s+)?\S+|reply(?:\s+all)?\s+to\b|forward\s+(?:this|that|the|an?\s+\w+)?\s*(?:e-?mail|mail|message|invite)?\s*to\b)/iu;
const HE_EMAIL_SEND =
  /(?:(?:תשלח|תשלחי|לשלוח|שלח|שלחי|תכתוב|תכתבי|לכתוב|כתוב|תנסח|לנסח|שישלח|שתשלח|תעביר|להעביר|העבר|תענה|לענות|תשיב|להשיב)[^.!?\n]*(?:מייל|אימייל|דוא"ל|דואל|דואר|הודעה)|(?:מייל|אימייל|דוא"ל|דואל)\s+(?:ל|אל\s))/u;

export function detectCommandIntent(text: string): HyperAssistantIntent {
  const clean = hyperStripDiacritics(text);
  if (EN_MEETING_CREATE.test(clean) || HE_MEETING_CREATE.test(clean)) return 'meeting';
  if (EN_EMAIL_SEND.test(clean) || HE_EMAIL_SEND.test(clean)) return 'email';
  return 'general';
}

const EN_STOP_WORDS = new Set([
  'tomorrow', 'today', 'tonight', 'yesterday', 'morning', 'afternoon', 'evening', 'night',
  'next', 'this', 'last', 'on', 'at', 'in', 'by', 'until', 'till', 'from', 'for', 'around',
  'between', 'about', 'regarding', 'concerning', 're', 'subject', 'title', 'titled', 'called',
  'named', 'saying', 'asking', 'telling', 'that', 'which', 'because', 'please', 'thanks',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'am', 'pm', 'noon', 'midnight', 'hour', 'hours', 'minutes', 'mins',
  'teams', 'skype', 'zoom', 'online', 'link', 'room', 'location', 'office',
  'cc', 'bcc', 'to', 'with', 'send', 'set', 'schedule', 'create', 'book', 'email', 'mail', 'meeting',
]);

const HE_STOP_WORDS = new Set([
  'מחר', 'היום', 'מחרתיים', 'אתמול', 'הערב', 'הבוקר', 'השבוע', 'בשבוע', 'בחודש',
  'ביום', 'יום', 'בשעה', 'שעה', 'בבוקר', 'בצהריים', 'אחר', 'בערב', 'בלילה',
  'על', 'לגבי', 'בנושא', 'אודות', 'בנוגע', 'בשם', 'שכותרתו', 'שכותרתה', 'שיאמר', 'שאומר',
  'כדי', 'בבקשה', 'תודה', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
  'בזום', 'בטימס', 'אונליין', 'במשרד', 'בחדר', 'עותק', 'עם', 'אל', 'את', 'עבור', 'בשביל',
  'לקבוע', 'לשלוח', 'לכתוב', 'לדבר', 'לתאם', 'לזמן', 'להזמין', 'לבדוק', 'לעבור', 'להעביר',
  'מייל', 'אימייל', 'דואל', 'פגישה', 'ישיבה', 'שיחה', 'אירוע', 'יומן', 'הודעה',
  'בשש', 'בשבע', 'בשמונה', 'בתשע', 'בעשר', 'באחת', 'בשתיים', 'בשלוש', 'בארבע', 'בחמש',
  'שש', 'שבע', 'שמונה', 'תשע', 'עשר', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'וחצי', 'ורבע',
]);

const NON_PERSON_SINGLE = new Set([
  'me', 'myself', 'us', 'him', 'her', 'them', 'you', 'everyone', 'everybody', 'anyone', 'someone',
  'team', 'group', 'all', 'staff', 'company', 'my', 'the', 'a', 'an', 'it', 'this', 'that',
  'calendar', 'inbox', 'draft', 'drafts', 'mail', 'email', 'meeting', 'event', 'call', 'note', 'message',
  'איתי', 'אותי', 'איתנו', 'אותנו', 'כולם', 'מישהו', 'משהו', 'הצוות', 'צוות', 'הקבוצה', 'עצמי',
  'פגישה', 'מייל', 'אימייל', 'הודעה', 'יומן', 'טיוטה', 'שיחה', 'ישיבה', 'דוח', 'הדוח',
]);

function isStopToken(token: string): boolean {
  const clean = hyperStripDiacritics(token).toLowerCase().replace(/^['".,!?;:()[\]-]+|['".,!?;:()[\]-]+$/g, '');
  if (!clean) return true;
  if (/\d/.test(clean)) return true;
  if (EN_STOP_WORDS.has(clean) || HE_STOP_WORDS.has(clean)) return true;
  if (/^ב[-–—]?\d/.test(clean)) return true;
  if (/^(?:ב|ל)(?:יום|שעה|בוקר|ערב|צהריים|שבוע|חודש|זום|טימס)/.test(clean)) return true;
  return false;
}

function isValidPersonCandidate(phrase: string): boolean {
  const q = hyperCleanPersonQuery(phrase);
  if (q.length < 2) return false;
  if (EMAIL_RE.test(q)) return true;
  const words = q.split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  if (words.length === 1 && NON_PERSON_SINGLE.has(words[0]!.toLowerCase())) return false;
  if (words.every((w) => isStopToken(w) || NON_PERSON_SINGLE.has(w.toLowerCase()))) return false;
  return true;
}

/**
 * Given a slice starting right after a cue preposition/verb, extracts 1+ person spans up to
 * the first temporal/topic/clause stop word, splitting multi-person lists on `,`, `and`, `&`, or Hebrew `ו`.
 */
function extractPeopleFromPhrase(
  fullText: string,
  phraseStart: number,
  role: HyperAssistantPersonSlot['role'],
  gluedPrefixChar?: string,
): ExtractedSpan[] {
  const tail = fullText.slice(phraseStart);
  // Match a complete email first so its dots and digits stay inside the recipient.
  const tokenRe = /[A-Za-z0-9_+%'!-]+(?:\.[A-Za-z0-9_+%'!-]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|[.!?\n\r;:]|[^\s,.!?;:]+|,/gu;
  const rawTokens: Array<{ text: string; start: number; end: number }> = [];
  for (const m of tail.matchAll(tokenRe)) {
    if (/^[.!?\n\r;:]$/u.test(m[0])) break;
    rawTokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }

  // Group into segments separated by commas, "and", "&", or Hebrew "ו"
  const segments: Array<{ tokens: Array<{ text: string; start: number; end: number }>; gluedPrefix?: string }> = [];
  let current: Array<{ text: string; start: number; end: number }> = [];
  let currentGlued = gluedPrefixChar;

  const flush = () => {
    if (current.length) {
      segments.push({ tokens: current, gluedPrefix: currentGlued });
      current = [];
      currentGlued = undefined;
    }
  };

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i]!;
    const stripped = hyperStripDiacritics(tok.text);
    const lower = stripped.toLowerCase();

    // Comma / conjunction separators between multiple people
    if (tok.text === ',' || lower === 'and' || tok.text === '&' || stripped === 'ו') {
      flush();
      continue;
    }

    // Hebrew attached conjunction "ו" starting a second person (e.g. "ישראל ישראלי ודנה כהן" or "ישראל ישראלי ולדנה כהן")
    if (
      current.length >= 1 &&
      /^ו[\u0590-\u05FF]{2,}$/u.test(stripped) &&
      !isStopToken(stripped.slice(1))
    ) {
      // Split if we already have a full 2-word name OR if next token is also a Hebrew name word (making a 2-word second name)
      const nextTok = rawTokens[i + 1];
      const nextLooksLikeName = nextTok && /^[\u0590-\u05FF]{2,}$/u.test(hyperStripDiacritics(nextTok.text)) && !isStopToken(nextTok.text);
      if (current.length >= 2 || nextLooksLikeName) {
        flush();
        // Strip leading "ו" (or "ול") from the token's offset when constructing the new span
        const dropLen = /^ו[למב][\u0590-\u05FF]{2,}$/u.test(stripped) ? 2 : 1;
        const glue = tok.text.slice(0, dropLen);
        currentGlued = glue;
        current.push({ text: tok.text.slice(dropLen), start: tok.start + dropLen, end: tok.end });
        continue;
      }
    }

    // Check stop word (e.g. "tomorrow", "at", "about", "מחר", "בשש", "על", "לגבי")
    if (!EMAIL_RE.test(tok.text) && isStopToken(tok.text)) {
      break;
    }

    // Also stop if a single person segment already has 3 name words
    if (current.length >= 3) {
      break;
    }

    // Skip filler article "the" / "a" only at start of a person phrase — if first word is article + non-person, abort
    if (current.length === 0 && (lower === 'the' || lower === 'a' || lower === 'an' || lower === 'my' || lower === 'our')) {
      break;
    }

    current.push(tok);
  }
  flush();

  const spans: ExtractedSpan[] = [];
  for (const seg of segments) {
    if (!seg.tokens.length) continue;
    const first = seg.tokens[0]!;
    const last = seg.tokens[seg.tokens.length - 1]!;
    const start = phraseStart + first.start;
    const end = phraseStart + last.end;
    const rawName = fullText.slice(start, end);
    const query = hyperCleanPersonQuery(rawName);
    if (!isValidPersonCandidate(rawName)) continue;
    spans.push({
      rawName,
      query,
      start,
      end,
      role,
      ...(seg.gluedPrefix ? { hadGluedPrefix: seg.gluedPrefix } : {}),
    });
  }
  return spans;
}

interface CueRule {
  pattern: RegExp;
  role: HyperAssistantPersonSlot['role'];
  /** When true, the cue regex captured a glued Hebrew prefix like `ל` in group 1 right before the name. */
  gluedPrefixGroup?: number;
  intentOnly?: HyperAssistantIntent;
}

const CUE_RULES: CueRule[] = [
  // English meeting & invite cues
  { pattern: /\b(?:meeting|meet|sync|call|chat|appointment|session|catch[\s-]?up|1:1|one[\s-]on[\s-]one)\s+with\s+/giu, role: 'attendee' },
  { pattern: /\b(?:invite|inviting)\s+/giu, role: 'attendee' },
  // English email cues
  { pattern: /\b(?:send(?:\s+an?)?\s+(?:e-?mail|mail|message|note|invite|invitation)|write(?:\s+an?)?\s+(?:e-?mail|mail|message|note)|reply(?:\s+all)?|forward(?:\s+(?:this|that|the|it|an?\s+\w+))?)\s+to\s+/giu, role: 'to' },
  { pattern: /\b(?:e-?mail|mail)\s+(?:to\s+)?/giu, role: 'to' },
  { pattern: /\b(?:cc|bcc|copy)\s+/giu, role: 'cc' },
  // Generic English "with" when intent is meeting
  { pattern: /\bwith\s+/giu, role: 'attendee', intentOnly: 'meeting' },

  // Hebrew meeting & invite cues
  { pattern: /(?:פגישה|ישיבה|שיחה|אירוע|זימון|להיפגש|ניפגש)\s+עם\s+/gu, role: 'attendee' },
  { pattern: /(?:להזמין|תזמין|תזמיני|הזמן|הזמיני|לזמן|תזמן|תזמני|זמן)\s+(?:את\s+)?/gu, role: 'attendee' },
  // Hebrew email cues: standalone "אל " / "ל- " / attached "ל" (e.g. "מייל לישראל ישראלי" or "מייל ל-Aaron")
  { pattern: /(?:מייל|אימייל|דוא"ל|דואל|הודעה|דואר)\s+(?:אל\s+|ל[-–—]\s*)/gu, role: 'to' },
  { pattern: /(?:מייל|אימייל|דוא"ל|דואל|הודעה|דואר)\s+(ל)(?=[\u0590-\u05FFA-Za-z]{2,})/gu, role: 'to', gluedPrefixGroup: 1 },
  // Hebrew send/forward/reply cues with "אל " / "ל- " / attached "ל"
  { pattern: /(?:להעביר|תעביר|תעבירי|העבר|לענות|תענה|תעני|ענה|להשיב|תשיב)\s+(?:אל\s+|ל[-–—]\s*)/gu, role: 'to' },
  { pattern: /(?:להעביר|תעביר|תעבירי|העבר|לענות|תענה|תעני|ענה|להשיב|תשיב)\s+(ל)(?=[\u0590-\u05FFA-Za-z]{2,})/gu, role: 'to', gluedPrefixGroup: 1 },
  // Hebrew CC
  { pattern: /(?:בעותק|עותק)\s+(?:אל\s+|ל[-–—]\s*)?/gu, role: 'cc' },
  // Generic Hebrew "עם" when intent is meeting
  { pattern: /(?:^|\s)עם\s+/gu, role: 'attendee', intentOnly: 'meeting' },
];

/** Extracts deterministic person spans (already-serialized mentions, explicit `@Name`, and EN/HE preposition cues). */
export function extractPersonSpans(
  commandText: string,
  intent: HyperAssistantIntent,
  excludeBotHandles: ReadonlySet<string>,
): ExtractedSpan[] {
  const spans: ExtractedSpan[] = [];
  const overlaps = (start: number, end: number) => spans.some((s) => start < s.end && end > s.start);

  // 1. Existing serialized @[Name](mailto:email) tokens
  for (const part of hyperParseMentions(commandText)) {
    if (part.kind !== 'mention') continue;
    const { name, email } = part.person;
    spans.push({ rawName: name, query: name, start: part.start, end: part.end, role: intent === 'email' ? 'to' : 'attendee', presetEmail: email });
    if (spans.length > HYPER_ASSISTANT_MAX_PEOPLE) return spans;
  }

  // 2. Explicit `@Name` mentions in commandText (skipping emails and bot handles)
  for (let i = 0; i < commandText.length; i++) {
    if (commandText[i] !== '@') continue;
    if (i > 0 && !/[\s([{"'׳״,;:]/.test(commandText[i - 1]!)) continue;
    if (overlaps(i, i + 1)) continue;
    const extracted = extractPeopleFromPhrase(commandText, i + 1, intent === 'email' ? 'to' : 'attendee');
    const first = extracted[0];
    if (!first) continue;
    const fullStart = i;
    const fullEnd = first.end;
    const handleLower = ('@' + first.query).toLowerCase();
    if (excludeBotHandles.has(handleLower)) continue;
    if (!overlaps(fullStart, fullEnd)) {
      spans.push({ ...first, start: fullStart, end: fullEnd });
      if (spans.length > HYPER_ASSISTANT_MAX_PEOPLE) return spans;
    }
  }

  // 3. Conversational EN & HE preposition / verb cues
  for (const rule of CUE_RULES) {
    if (rule.intentOnly && rule.intentOnly !== intent) continue;
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(commandText)) !== null) {
      const phraseStart = m.index + m[0].length;
      if (overlaps(phraseStart, phraseStart + 1)) continue;
      const glued = rule.gluedPrefixGroup ? m[rule.gluedPrefixGroup] : undefined;
      const found = extractPeopleFromPhrase(commandText, phraseStart, rule.role, glued);
      for (const span of found) {
        // Avoid re-extracting a bot handle or overlapping span
        if (excludeBotHandles.has(('@' + span.query).toLowerCase())) continue;
        if (!overlaps(span.start, span.end)) {
          spans.push(span);
          if (spans.length > HYPER_ASSISTANT_MAX_PEOPLE) return spans;
        }
      }
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

const LlmRefinementSchema = z.object({
  intent: z.enum(['meeting', 'email', 'general']).optional(),
  people: z.array(z.string().trim().min(2).max(80)).max(10).optional(),
});

function buildLlmRefinementPrompt(commandText: string): string {
  return [
    'Extract the communication intent and any person/co-worker names mentioned in this voice command (English or Hebrew).',
    'Strip Hebrew grammatical prefixes (ל/מ/ב/את/ו) from person names. Do NOT include bot names, dates, times, or topics.',
    'Return ONLY valid JSON: {"intent":"meeting"|"email"|"general","people":["Full Name"]}',
    `Command: ${JSON.stringify(commandText)}`,
  ].join('\n');
}

function findSpanForLlmName(commandText: string, name: string): { start: number; end: number; rawName: string } | null {
  const clean = hyperCleanPersonQuery(name);
  if (!clean) return null;
  const span = hyperFindPlainPersonSpan(commandText, clean);
  return span ? { start: span.start, end: span.end, rawName: span.text } : null;
}

export function buildBotCandidate(
  bot: HyperBotConfig,
  rooms: readonly HyperBotsRoom[],
  extra?: { confidence?: 'exact' | 'fuzzy' | 'default'; matchedText?: string },
): HyperAssistantBotCandidate {
  const direct = rooms.find((r) => r.kind === 'direct' && r.botIds.length === 1 && r.botIds[0] === bot.id);
  const fallbackRoom = rooms.find((r) => r.botIds.includes(bot.id));
  return {
    id: bot.id,
    name: bot.name,
    handle: hyperBotDisplayHandle(bot),
    roomId: direct?.id ?? fallbackRoom?.id ?? null,
    mode: bot.mode ?? 'personal',
    avatar: bot.avatar,
    tools: [...bot.tools],
    ...(extra?.confidence ? { confidence: extra.confidence } : {}),
    ...(extra?.matchedText ? { matchedText: extra.matchedText } : {}),
  };
}

export function computeMissingTools(
  bot: Pick<HyperBotConfig, 'tools'> | null,
  intent: HyperAssistantIntent,
  hasPeople: boolean,
): HyperBotsToolName[] {
  if (!bot) return [];
  const needed: HyperBotsToolName[] = [];
  if (intent === 'meeting') needed.push('outlook_create_event');
  if (intent === 'email') needed.push('outlook_send_message');
  if ((intent === 'meeting' || intent === 'email' || hasPeople) && !bot.tools.includes('outlook_search_people')) {
    needed.push('outlook_search_people');
  }
  return [...new Set(needed)].filter((t) => !bot.tools.includes(t));
}

export class HyperVoiceCommandParser {
  private readonly peopleResolver: HyperPeopleResolver;
  private readonly refineWithLlm?: (prompt: string, signal: AbortSignal) => Promise<string | null>;
  private readonly llmTimeoutMs: number;

  constructor(options: HyperCommandParserOptions) {
    this.peopleResolver = options.peopleResolver;
    this.refineWithLlm = options.refineWithLlm;
    this.llmTimeoutMs = options.llmTimeoutMs ?? 2500;
  }

  async parse(input: {
    text: string;
    settings: HyperBotsSettings | null;
    activeRoomId?: string | null;
    signedIn: boolean;
  }): Promise<HyperVoiceCommandPlan> {
    const rawText = input.text.trim();
    const language = detectCommandLanguage(rawText);
    const warnings: string[] = [];

    if (!input.signedIn || !input.settings) {
      warnings.push('Sign in to HyperTask to send commands to Hyper-Bot.');
    }

    const bots = input.settings?.bots ?? [];
    const rooms = input.settings?.rooms ?? [];
    const availableBots = bots.map((b) => buildBotCandidate(b, rooms));

    // 1. Resolve target bot (explicit @mention or spoken EN/HE trigger; fallback to active room bot or first personal bot)
    const botMentions = extractBotMentions(rawText, bots);
    const matched = botMentions[0] ?? null;

    let resolvedBot: HyperAssistantBotCandidate | null = null;
    let cleanedCommand = rawText;

    if (matched) {
      resolvedBot = buildBotCandidate(matched.bot, rooms, {
        confidence: matched.confidence,
        matchedText: matched.matchedText,
      });
      if (matched.source === 'spoken-trigger' && matched.commandText !== undefined) {
        cleanedCommand = matched.commandText;
      } else if (matched.source === 'at-mention') {
        // Remove the leading @bot mention from cleanedCommand so normalizedText prepends the canonical handle once
        const before = rawText.slice(0, matched.start).trim();
        const after = rawText.slice(matched.end).replace(/^[\s,:-]+/, '').trim();
        cleanedCommand = [before, after].filter(Boolean).join(' ');
      }
    } else if (bots.length) {
      const activeRoom = input.activeRoomId ? rooms.find((r) => r.id === input.activeRoomId) : undefined;
      const activeBot = activeRoom?.kind === 'direct' ? bots.find((b) => b.id === activeRoom.botIds[0]) : undefined;
      const defaultBot = activeBot ?? bots.find((b) => (b.mode ?? 'personal') === 'personal') ?? bots[0]!;
      resolvedBot = buildBotCandidate(defaultBot, rooms, { confidence: 'default' });
    }

    const targetRoomId = resolvedBot?.roomId ?? input.activeRoomId ?? rooms[0]?.id ?? null;

    // 2. Detect intent on the cleaned command (fallback to rawText if cleanedCommand is empty)
    let intent = detectCommandIntent(cleanedCommand || rawText);

    // 3. Deterministic person extraction
    const botHandleSet = new Set<string>();
    for (const b of bots) {
      botHandleSet.add('@' + b.id.toLowerCase());
      botHandleSet.add('@' + b.name.trim().toLowerCase());
      botHandleSet.add(hyperBotDisplayHandle(b).toLowerCase());
    }

    let spans = extractPersonSpans(cleanedCommand, intent, botHandleSet);

    // 4. Optional fast LLM refinement when deterministic extraction found no people on an action command
    //    or when the phrasing is complex and non-standard. Strictly bounded & failure-isolated.
    if (
      this.refineWithLlm &&
      cleanedCommand.length >= 6 &&
      spans.length === 0 &&
      (intent === 'meeting' || intent === 'email' || cleanedCommand.split(/\s+/u).length >= 5)
    ) {
      try {
        const rawJson = await this.refineWithLlm(buildLlmRefinementPrompt(cleanedCommand), AbortSignal.timeout(this.llmTimeoutMs));
        if (rawJson) {
          const jsonText = rawJson.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
          const parsed = LlmRefinementSchema.safeParse(JSON.parse(jsonText));
          if (parsed.success) {
            if (intent === 'general' && parsed.data.intent && parsed.data.intent !== 'general') {
              intent = parsed.data.intent;
            }
            for (const llmName of parsed.data.people ?? []) {
              if (botHandleSet.has(('@' + llmName).toLowerCase())) continue;
              const loc = findSpanForLlmName(cleanedCommand, llmName);
              const query = hyperCleanPersonQuery(llmName);
              if (!query || !isValidPersonCandidate(query)) continue;
              const start = loc?.start ?? -1;
              const end = loc?.end ?? -1;
              if (start >= 0 && spans.some((s) => start < s.end && end > s.start)) continue;
              spans.push({
                rawName: loc?.rawName ?? llmName,
                query,
                start,
                end,
                role: intent === 'email' ? 'to' : 'attendee',
              });
            }
            spans = spans.sort((a, b) => a.start - b.start);
          }
        }
      } catch {
        // LLM refinement is strictly optional; deterministic results remain authoritative.
      }
    }

    // 5. Resolve each extracted person against AD + Outlook directory via HyperPeopleResolver
    if (spans.length > HYPER_ASSISTANT_MAX_PEOPLE) {
      throw new SettingsError('format', 'A voice command can contain at most ' + HYPER_ASSISTANT_MAX_PEOPLE + ' recipients.');
    }
    const people: HyperAssistantPersonSlot[] = await Promise.all(
      spans.map(async (span, idx): Promise<HyperAssistantPersonSlot> => {
        const slotId = `person-${idx + 1}`;
        const sourceSpan = span.start < 0 ? undefined : {
          start: span.start,
          end: span.end,
          text: cleanedCommand.slice(span.start, span.end),
        };
        if (span.presetEmail) {
          const lookedUp = await this.peopleResolver.lookupEmail(span.presetEmail);
          const person = lookedUp ?? {
            name: span.rawName,
            email: span.presetEmail,
            title: '',
            department: '',
            phone: '',
            office: '',
            company: '',
            source: 'ad' as const,
          };
          return {
            id: slotId,
            sourceSpan,
            rawName: span.rawName,
            query: span.query,
            role: span.role,
            status: 'exact',
            selected: person,
            candidates: [person],
          };
        }
        return { ...await this.peopleResolver.resolveSlot(slotId, span.rawName, span.role), sourceSpan };
      }),
    );

    const directoryErrors = [...new Set(people.map((p) => p.error).filter((e): e is string => Boolean(e)))];
    warnings.push(...directoryErrors);

    // 6. Construct normalizedText (human-readable @bot + @Person) and canonicalText (@[Name](mailto:email))
    let normalizedBody = cleanedCommand;
    let canonicalBody = cleanedCommand;
    const positioned = spans
      .map((span, idx) => ({ span, slot: people[idx]! }))
      .filter(({ span }) => span.start >= 0 && span.end > span.start)
      .sort((a, b) => b.span.start - a.span.start);

    for (const { span, slot } of positioned) {
      const displayName = slot.selected?.name ?? slot.query;
      const needsLeadingSpace = Boolean(span.hadGluedPrefix) && span.start > 0 && !/\s/.test(cleanedCommand[span.start - 1]!);
      const pad = needsLeadingSpace ? ' ' : '';
      const normReplacement = `${pad}@${displayName}`;
      const canonReplacement = slot.selected
        ? `${pad}${hyperSerializeMention(slot.selected)}`
        : normReplacement;
      normalizedBody = normalizedBody.slice(0, span.start) + normReplacement + normalizedBody.slice(span.end);
      canonicalBody = canonicalBody.slice(0, span.start) + canonReplacement + canonicalBody.slice(span.end);
    }

    // Append any LLM-extracted people whose span wasn't located verbatim in cleanedCommand
    const unpositioned = spans
      .map((span, idx) => ({ span, slot: people[idx]! }))
      .filter(({ span }) => span.start < 0);
    if (unpositioned.length) {
      const normExtras = unpositioned.map(({ slot }) => `@${slot.selected?.name ?? slot.query}`).join(', ');
      const canonExtras = unpositioned
        .map(({ slot }) => (slot.selected ? hyperSerializeMention(slot.selected) : `@${slot.query}`))
        .join(', ');
      normalizedBody = `${normalizedBody} (${normExtras})`.trim();
      canonicalBody = `${canonicalBody} (${canonExtras})`.trim();
    }

    const prefix = resolvedBot ? `${resolvedBot.handle} ` : '';
    const normalizedText = (prefix + normalizedBody).trim();
    const canonicalText = (prefix + canonicalBody).trim();

    // 7. Missing tools & confirmation requirement (User Decision A1: confirm people/bot/tools before dispatching)
    const missingTools = computeMissingTools(resolvedBot, intent, people.length > 0);
    const requiresConfirmation =
      people.length > 0 ||
      resolvedBot !== null ||
      missingTools.length > 0 ||
      intent !== 'general';

    return {
      rawText,
      cleanedCommand,
      normalizedText,
      canonicalText,
      language,
      intent,
      resolvedBot,
      targetRoomId,
      availableBots,
      people,
      missingTools,
      requiresConfirmation,
      warnings,
      signedIn: input.signedIn,
    };
  }
}
