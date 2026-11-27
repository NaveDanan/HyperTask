import type { HyperHubCivilDate, HyperHubLanguageCohort } from './HyperTaskHub';

export interface HyperHubAuthoredMail {
  body: string; folder: 'inbox' | 'sent'; aliases: string[]; to: string[];
  distributionList: boolean | null; authoredAt: string; zone: string;
  /** Supplied only after a complete, store-bound Sent inventory covering this message. */
  unanswered?: boolean;
  truncated?: boolean;
}
export interface HyperHubCandidate {
  start: number; end: number; excerpt: string; inferredOwner: string;
  rule: string; confidence: number; cohort: HyperHubLanguageCohort;
  resolvedDate?: HyperHubCivilDate;
  /** Main hashes this scoped identity before persisting a ledger key. */
  fingerprint: string;
}

const fold = (s: string) => s.normalize('NFC').toLowerCase().replace(/[\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7]/gu, '');
const escape = (s: string) => s.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
const boundary = /^\s*(?:>|(?:from|sent|to|subject|מאת|נשלח|אל|נושא):|on .+ wrote:|בתאריך .+(?:כתב|כתבה)|[-_]{2,}|begin forwarded message|forwarded message|הודעה שהועברה|sent from my|נשלח מ|thanks[,!]?\s*$|regards[,!]?\s*$|(?:best|kind|warm) regards|best[,!]?\s*$|thank you[,!]?\s*$|unsubscribe\b|this (?:message|email) is confidential|תודה[,!]?\s*$|בברכה|confidentiality notice|הודעת סודיות|להסרה מרשימת התפוצה|הודעה זו מיועדת)/imu;
const suppressed = /(?:\bfyi\b|for your information|no (?:action|need)|(?:do|will|can)(?:n['’]t| not)|won['’]t|don['’]t|please ignore|accepted:|i accept|לידיעה|אין צורך|אל ת|לא צריך|לא נדרש|קיבלתי|אישרתי|התקבל:|לא א(?:שלח|בדוק|עדכן|אשר)|לא לשלוח)/iu;
const request = /(?:\b(?:please|kindly|can you|could you|would you)\s+(?:you\s+)?[\p{L}]+|בבקשה\s+\S|(?:נא|אנא)\s+ל|תוכל(?:י|ו)?\s+ל|אפשר\s+(?:שת|ל)|(?<!\p{L})(?:שלח|בדוק|אשר|עדכן)(?:י|ו)?\s)/iu;
const imperative = /^(?:(?:send|review|prepare|confirm|update|check|finish|approve|submit|deliver|schedule|publish|share|provide|complete)\b|(?:תשלח[יו]?|תבדק[יו]?|תאשר[יו]?|תכינ[יו]?|תעדכנ[יו]?))\s+\S/iu;
const promise = /(?:\bi(?:['’]ll| will| promise to)\s+\w+|(?:^|\s)(?:אני\s+)?(?:אשלח|אבדוק|אעדכן|אכין|אאשר|אטפל|אסיים|אעביר|אבצע)\s)/iu;
const question = /(?:\b(?:what|when|where|who|which|how|did you|are you|have you|is the)|(?:^|\s)(?:מתי|מה|איפה|כיצד|איך|האם|מי)\s)/iu;
const weekdays = [
  ['sunday', 'ראשון'], ['monday', 'שני'], ['tuesday', 'שלישי'], ['wednesday', 'רביעי'],
  ['thursday', 'חמישי'], ['friday', 'שישי'], ['saturday', 'שבת'],
];

function deadline(text: string, { authoredAt, zone }: HyperHubAuthoredMail): HyperHubCivilDate | undefined {
  if (/\d{1,2}\/\d{1,2}/.test(text) || !Number.isFinite(Date.parse(authoredAt))) return;
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(authoredAt));
  const day = new Date(local + 'T00:00:00Z');
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) {
    const value = Date.parse(iso);
    return Number.isFinite(value) && new Date(value).toISOString().startsWith(iso) ? { kind: 'civil-date', date: iso, zone } : undefined;
  }
  let delta: number;
  if (text.includes('מחרתיים') || text.includes('day after tomorrow')) delta = 2;
  else if (/\btomorrow\b|מחר/.test(text)) delta = 1;
  else if (/\btoday\b|\btonight\b|היום|הערב/.test(text)) delta = 0;
  else {
    const weekday = weekdays.findIndex(([en, he]) => new RegExp('\\b' + en + '\\b|(?:ב?יום|עד)\\s+' + he + '(?!\\p{L})', 'u').test(text));
    if (weekday < 0) return;
    delta = (weekday - day.getUTCDay() + 7) % 7;
  }
  day.setUTCDate(day.getUTCDate() + delta);
  return { kind: 'civil-date', date: day.toISOString().slice(0, 10), zone };
}

function* authoredSpans(body: string, truncated: boolean) {
  let start = 0;
  // Keep URLs, email addresses and decimal dates intact inside an assignment.
  const delimiters = /(?:[.!?]+(?=\s|$)|[;\r\n]+|,\s+(?=(?:and\s+)?[\p{L}\p{M}]+\s*[:,])|\s+and\s+(?=(?:please|kindly|could you|i will|i'll)\b|[\p{L}\p{M}]+(?:\s*[:,]|\s+(?:please|kindly)\b))|\s+ו(?=[\p{Script=Hebrew}\p{M}]+\s*[:,]))/giu;
  for (const delimiter of body.matchAll(delimiters)) {
    const punctuation = /^[.!?]/.test(delimiter[0]) ? delimiter[0].length : 0;
    yield { text: body.slice(start, delimiter.index + punctuation), start };
    start = delimiter.index + delimiter[0].length;
  }
  if (!truncated && start < body.length) yield { text: body.slice(start), start };
}

export function hyperHubExtract(mail: HyperHubAuthoredMail): HyperHubCandidate[] {
  if (mail.distributionList !== false) return [];
  const aliases = mail.aliases.map(fold).filter(Boolean);
  if (!aliases.length) return [];
  const direct = mail.to.some(person => aliases.includes(fold(person)));
  const quote = mail.body.search(boundary);
  const passage = mail.body.slice(0, quote < 0 ? undefined : quote);
  if (/^\s*(?:fyi\b|for your information\b|לידיעה|accepted:|התקבל:)/iu.test(fold(passage))) return [];
  const candidates: HyperHubCandidate[] = [];
  const counts = new Map<string, number>();
  const namedOwner = new RegExp('^(?:hi |dear |היי |שלום )?(' + aliases.map(escape).join('|') + ')(?=[,:!\\s]|$)', 'u');
  // Segment the original UTF-16 text first. Folding can change its length, but never changes these source offsets.
  let addressed: boolean | undefined;
  for (const part of authoredSpans(passage, !!mail.truncated && quote < 0)) {
    const excerpt = part.text.trim();
    const start = part.start + part.text.indexOf(excerpt);
    const canonical = fold(excerpt).replace(/\s+/gu, ' ').trim();
    const line = canonical.replace(/["“«][^"”»]*["”»]|(?:^|\s)'[^']+'/gu, ' ').trim();
    const named = namedOwner.exec(line);
    const vocative = /^(?:(?:hi|dear|שלום|היי)\s+)?([\p{L}]+(?:\s+[\p{L}]+)?)(?:\s*[:,]|\s+(?=please\b|kindly\b|נא\s))/u.exec(line);
    if (named) addressed = true;
    else if (vocative && !/^please|בבקשה/.test(vocative[1])) addressed = false;
    if (!excerpt || suppressed.test(line) || /^(?:["“„]|(?:you wrote|כתבת)\s*[:"])/u.test(line)) continue;
    const toOwner = addressed ?? direct;
    const instruction = (named ? line.slice(named[0].length) : line).replace(/^[\s,:-]+/, '');
    const rule = mail.folder === 'sent' ? promise.test(line) && 'Promise in Sent'
      : toOwner && (request.test(line) || imperative.test(instruction)) ? 'Request addressed to you'
      : toOwner && mail.unanswered && line.endsWith('?') && question.test(line) && 'Unanswered direct question';
    if (!rule) continue;
    const repeat = counts.get(canonical) ?? 0;
    counts.set(canonical, repeat + 1);
    const he = /\p{Script=Hebrew}/u.test(excerpt), en = /[a-z]/i.test(excerpt);
    candidates.push({ excerpt, start, end: start + excerpt.length, inferredOwner: mail.aliases[0], rule,
      confidence: rule === 'Unanswered direct question' ? 0.8 : 0.95, cohort: he ? en ? 'mixed' : 'he' : 'en',
      resolvedDate: deadline(line, mail), fingerprint: JSON.stringify([mail.folder, canonical, repeat]) });
  }
  return candidates;
}

/** Labelled authored passages used to measure the fixture side of the preview gate. */
export const HyperHubPrecisionExamples = [
  { cohort: 'en', body: 'Please review the report tomorrow.', expected: true },
  { cohort: 'en', body: 'FYI, please review the old thread.', expected: false },
  { cohort: 'he', body: 'נא לשלוח את הדוח מחר.', expected: true },
  { cohort: 'he', body: 'אין צורך לשלוח את הדוח.', expected: false },
  { cohort: 'mixed', body: 'יעל, please send the report מחר.', expected: true },
  { cohort: 'mixed', body: 'לידיעה, please archive the report.', expected: false },
] as const;
export const hyperHubFixturePrecision = Object.fromEntries((['en', 'he', 'mixed'] as const).map(cohort => {
  const predicted = HyperHubPrecisionExamples.filter(e => e.cohort === cohort && hyperHubExtract({
    body: e.body, folder: 'inbox', aliases: ['Yael', 'יעל'], to: ['Yael'], distributionList: false,
    zone: 'Asia/Jerusalem', authoredAt: '2026-11-29T12:00:00Z',
  }).length);
  return [cohort, predicted.length ? predicted.filter(e => e.expected).length / predicted.length : 0];
})) as Record<HyperHubLanguageCohort, number>;
