import type {
  HyperAssistantPerson,
  HyperAssistantPersonSlot,
  HyperAssistantPersonStatus,
} from '@shared/HyperAssistant';
import {
  hyperLevenshtein,
  hyperNormalizeBotToken,
  hyperPhoneticFold,
  hyperStripDiacritics,
  hyperStripHebrewPrefixes,
} from '@shared/HyperBotResolver';
import type { HyperOutlookBridge } from './HyperOutlookBridge';

// Bilingual (English + Hebrew) employee directory & Outlook people resolver.
// Wraps HyperOutlookBridge's `people.search` / `people.lookup` with Hebrew preposition
// stripping, multi-token fallback for STT typos, and fuzzy/phonetic candidate ranking.

export type HyperPeopleBridge = Pick<HyperOutlookBridge, 'request'>;

export interface HyperRankedPerson {
  person: HyperAssistantPerson;
  score: number;
  exact: boolean;
}

export interface HyperResolvedPersonSlot {
  query: string;
  status: HyperAssistantPersonStatus;
  selected: HyperAssistantPerson | null;
  candidates: HyperAssistantPerson[];
  error?: string;
}

const EMAIL_RE = /^[^\s@<>()[\]\\]+@[^\s@<>()[\]\\]+\.[^\s@<>()[\]\\]+$/u;
const EXPLICIT_PREFIX_RE = /^(?:(?:את|אל|עם|עבור|בשביל|ל|מ|ב)\s+|[למבהושכ][-–—])/u;
const HEBREW_CHAR = /[\u0590-\u05FF]/;

/** Cleans a raw extracted person name into a lookup query while stripping explicit prepositions. */
export function hyperCleanPersonQuery(raw: string): string {
  let q = hyperStripDiacritics(raw)
    .trim()
    .replace(/^@+/, '')
    .replace(/^[\s,.;:!?'"()[\]{}<>–—-]+|[\s,.;:!?'"()[\]{}<>–—-]+$/g, '')
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip explicit standalone Hebrew/English prepositions or hyphenated Hebrew prefixes (e.g. "ל-Aaron", "את ישראל")
  q = q.replace(EXPLICIT_PREFIX_RE, '').replace(/^(?:with|to|for|from|cc)\s+/iu, '').trim();
  return q;
}

/**
 * Generates ordered search queries to try against AD / Outlook directory:
 * 1. Exact cleaned query (e.g. "לישראל ישראלי" or "משה כהן")
 * 2. Hebrew proclitic-stripped first-word variant (e.g. "ישראל ישראלי") for attached ל/מ/ב/ו/ה/ש
 * Note: callers try #1 first so real names starting with מ/ל/ש (e.g. "משה", "ליאור", "שירה") match directly.
 */
export function hyperPersonQueryVariants(raw: string): string[] {
  const base = hyperCleanPersonQuery(raw);
  if (!base) return [];
  const out = new Set<string>([base]);
  const words = base.split(/\s+/u).filter(Boolean);
  if (words.length >= 1 && HEBREW_CHAR.test(words[0]!)) {
    for (const variant of hyperStripHebrewPrefixes(words[0]!)) {
      if (variant !== words[0] && variant.length >= 2) {
        out.add([variant, ...words.slice(1)].join(' '));
      }
    }
  }
  return [...out];
}

function tokenSimilarity(qToken: string, tToken: string): { score: number; exact: boolean } {
  if (!qToken || !tToken) return { score: 0, exact: false };
  if (qToken === tToken) return { score: 1, exact: true };

  // Prefix match (e.g. "mitchel" vs "mitchell" or "dan" vs "danan")
  const shorter = qToken.length <= tToken.length ? qToken : tToken;
  const longer = qToken.length <= tToken.length ? tToken : qToken;
  if (shorter.length >= 3 && longer.startsWith(shorter)) {
    const ratio = shorter.length / longer.length;
    if (ratio >= 0.75) return { score: 0.94, exact: false };
    return { score: 0.78 + ratio * 0.14, exact: false };
  }

  const qFold = hyperPhoneticFold(qToken);
  const tFold = hyperPhoneticFold(tToken);
  if (qFold && qFold === tFold) return { score: 0.96, exact: false };

  // Avoid cross-script edit distance comparisons
  if (HEBREW_CHAR.test(qToken) !== HEBREW_CHAR.test(tToken)) return { score: 0, exact: false };

  const maxLen = Math.max(qToken.length, tToken.length);
  const dist = hyperLevenshtein(qToken, tToken);
  const fDist = qFold && tFold ? hyperLevenshtein(qFold, tFold) : dist;
  const bestDist = Math.min(dist, fDist);
  const maxAllowed = maxLen >= 7 ? 2 : maxLen >= 3 ? 1 : 0;
  if (bestDist <= maxAllowed) {
    const sim = 1 - bestDist / maxLen;
    return { score: Math.max(0.65, 0.93 * sim), exact: false };
  }
  return { score: 0, exact: false };
}

/** Scores a candidate `HyperAssistantPerson` against a normalized query (or its Hebrew-prefix-stripped variant). */
export function scorePersonAgainstQuery(rawQuery: string, person: HyperAssistantPerson): { score: number; exact: boolean } {
  const variants = hyperPersonQueryVariants(rawQuery);
  if (!variants.length) return { score: 0, exact: false };

  const emailLower = person.email.trim().toLowerCase();
  const emailLocal = emailLower.split('@')[0] ?? '';
  const nameNorm = hyperNormalizeBotToken(person.name);
  const nameTokens = nameNorm.split(' ').filter(Boolean);
  const localTokens = emailLocal.split(/[._-]+/).filter((t) => t.length >= 2);
  const allTargetTokens = [...new Set([...nameTokens, ...localTokens])];

  let bestScore = 0;
  let bestExact = false;

  for (let vi = 0; vi < variants.length; vi++) {
    const q = variants[vi]!;
    const qLower = q.toLowerCase();
    const prefixPenalty = vi === 0 ? 0 : 0.015;

    // 1. Exact email match
    if (EMAIL_RE.test(qLower) && qLower === emailLower) {
      return { score: 1, exact: true };
    }

    const qNorm = hyperNormalizeBotToken(q);
    if (!qNorm) continue;

    // 2. Exact full display name match
    if (nameNorm && qNorm === nameNorm) {
      const score = 1 - prefixPenalty;
      if (score > bestScore) { bestScore = score; bestExact = true; }
      continue;
    }

    // 3. Phonetic exact full name match (e.g. "Aaron Mitchel" -> "Aaron Mitchell" or "אביי כהן" -> "אבי כהן")
    if (nameNorm && hyperPhoneticFold(qNorm) === hyperPhoneticFold(nameNorm)) {
      const score = 0.96 - prefixPenalty;
      if (score > bestScore) { bestScore = score; bestExact = false; }
      continue;
    }

    // 4. Multi-token or single-token matching against name tokens + email local-part tokens
    const qTokens = qNorm.split(' ').filter(Boolean);
    if (!qTokens.length || !allTargetTokens.length) continue;

    let sum = 0;
    let matchedCount = 0;
    let allTokensExact = true;
    const usedTargets = new Set<number>();

    for (const qt of qTokens) {
      let tokenBest = 0;
      let tokenBestIdx = -1;
      let tokenExact = false;
      for (let ti = 0; ti < allTargetTokens.length; ti++) {
        if (usedTargets.has(ti)) continue;
        const sim = tokenSimilarity(qt, allTargetTokens[ti]!);
        if (sim.score > tokenBest) {
          tokenBest = sim.score;
          tokenBestIdx = ti;
          tokenExact = sim.exact;
        }
      }
      if (tokenBest >= 0.65 && tokenBestIdx >= 0) {
        usedTargets.add(tokenBestIdx);
        sum += tokenBest;
        matchedCount++;
        if (!tokenExact) allTokensExact = false;
      } else {
        allTokensExact = false;
      }
    }

    if (matchedCount === 0) continue;

    // Coverage of query tokens is primary; coverage of full name breaks ties (prefer "Aaron Mitchell" over "Aaron Mitchell Jr." or single-name match)
    const queryCoverage = matchedCount / qTokens.length;
    const avgMatched = sum / matchedCount;
    let score = avgMatched * (0.45 + 0.55 * queryCoverage);

    // If user typed 2+ words and only 1 matched, penalize so full-name matches strongly win
    if (qTokens.length >= 2 && matchedCount < qTokens.length) {
      score *= 0.72;
    }

    // Single-token query matching one of 2+ name tokens (e.g. "Aaron" -> "Aaron Mitchell") is good but not full-name exact
    const exactTokenSet =
      allTokensExact &&
      matchedCount === qTokens.length &&
      nameTokens.length > 0 &&
      qTokens.length === nameTokens.length;

    if (exactTokenSet) {
      score = Math.max(score, 0.98);
    } else if (qTokens.length === 1 && matchedCount === 1 && nameTokens.length > 1) {
      score = Math.min(score, 0.89);
    }

    score = Math.max(0, score - prefixPenalty);
    if (score > bestScore) {
      bestScore = score;
      bestExact = exactTokenSet;
    }
  }

  return { score: bestScore, exact: bestExact };
}

export class HyperPeopleResolver {
  constructor(private readonly bridge: HyperPeopleBridge) {}

  private async safeSearch(query: string, limit: number): Promise<{ people: HyperAssistantPerson[]; error?: string }> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { people: [] };
    try {
      const result = await this.bridge.request('people.search', { query: trimmed.slice(0, 128), limit: Math.min(20, Math.max(1, limit)) });
      return { people: result };
    } catch (error) {
      return { people: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async safeLookup(email: string): Promise<HyperAssistantPerson | null> {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) return null;
    try {
      return await this.bridge.request('people.lookup', { email: trimmed });
    } catch {
      return null;
    }
  }

  /**
   * Searches AD + Outlook directory with Hebrew proclitic fallback and multi-token STT typo fallback,
   * returning deduplicated, relevance-ranked people.
   */
  async search(rawQuery: string, limit = 10): Promise<{ ranked: HyperRankedPerson[]; error?: string }> {
    const variants = hyperPersonQueryVariants(rawQuery);
    if (!variants.length) return { ranked: [] };

    const byEmail = new Map<string, HyperAssistantPerson>();
    let lastError: string | undefined;
    let hadSuccess = false;

    const ingest = (items: HyperAssistantPerson[]) => {
      for (const p of items) {
        const key = p.email.trim().toLowerCase();
        if (!key) continue;
        const prev = byEmail.get(key);
        // Prefer richer AD record or record with title/department
        if (!prev || (prev.source === 'outlook' && p.source === 'ad') || (!prev.title && p.title)) {
          byEmail.set(key, p);
        }
      }
    };

    const primary = variants[0]!;

    // Direct email lookup fast path
    if (EMAIL_RE.test(primary)) {
      const hit = await this.safeLookup(primary);
      if (hit) {
        ingest([hit]);
        hadSuccess = true;
      }
    }

    // 1. Primary query
    if (!byEmail.size) {
      const res = await this.safeSearch(primary, Math.max(limit, 15));
      if (res.error) lastError = res.error;
      else hadSuccess = true;
      ingest(res.people);
    }

    // 2. Hebrew proclitic-stripped fallback (e.g. "לישראל ישראלי" -> "ישראל ישראלי") if primary missed or had no strong match
    const topPrimaryScore = [...byEmail.values()].reduce(
      (max, p) => Math.max(max, scorePersonAgainstQuery(primary, p).score),
      0,
    );
    if (variants.length > 1 && topPrimaryScore < 0.85) {
      for (const variant of variants.slice(1)) {
        const res = await this.safeSearch(variant, Math.max(limit, 15));
        if (res.error) lastError = res.error;
        else hadSuccess = true;
        ingest(res.people);
      }
    }

    // 3. Multi-token fallback for STT typos when full-name query yielded no strong hit
    //    e.g. "Aron Mitchell" -> search "Mitchell" and "Aron" individually, then fuzzy-rank combined pool
    const bestSoFar = [...byEmail.values()].reduce(
      (max, p) => Math.max(max, scorePersonAgainstQuery(rawQuery, p).score),
      0,
    );
    if (bestSoFar < 0.82) {
      const tokenSource = variants[variants.length - 1] ?? primary;
      const tokens = [...new Set(tokenSource.split(/\s+/u).filter((t) => t.length >= 2))];
      if (tokens.length >= 2) {
        // Search longest tokens first (surnames are usually most selective)
        const ordered = [...tokens].sort((a, b) => b.length - a.length).slice(0, 3);
        for (const token of ordered) {
          const res = await this.safeSearch(token, 15);
          if (res.error) lastError = res.error;
          else hadSuccess = true;
          ingest(res.people);
        }
      }
    }

    const ranked: HyperRankedPerson[] = [...byEmail.values()]
      .map((person) => {
        const { score, exact } = scorePersonAgainstQuery(rawQuery, person);
        return { person, score, exact };
      })
      .filter((entry) => entry.score >= 0.55)
      .sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.005) return b.score - a.score;
        if (a.person.source !== b.person.source) return a.person.source === 'ad' ? -1 : 1;
        return a.person.name.localeCompare(b.person.name);
      })
      .slice(0, limit);

    return { ranked, ...(hadSuccess ? {} : lastError ? { error: lastError } : {}) };
  }

  /** Convenience helper returning ranked `HyperAssistantPerson[]` (for IPC & tool search). */
  async searchPeople(rawQuery: string, limit = 10): Promise<HyperAssistantPerson[]> {
    const { ranked } = await this.search(rawQuery, limit);
    return ranked.map((r) => r.person);
  }

  /** Resolves a single extracted person name into a confirmation slot (`exact | fuzzy | ambiguous | unresolved`). */
  async resolveSlot(
    id: string,
    rawName: string,
    role: HyperAssistantPersonSlot['role'] = 'person',
  ): Promise<HyperAssistantPersonSlot> {
    const query = hyperCleanPersonQuery(rawName);
    const { ranked, error } = await this.search(rawName, 8);
    const candidates = ranked.map((r) => r.person);

    if (!ranked.length) {
      return { id, rawName, query, role, status: 'unresolved', selected: null, candidates: [], ...(error ? { error } : {}) };
    }

    const top = ranked[0]!;
    const second = ranked[1];
    const closeRunnerUp =
      second !== undefined &&
      (top.score - second.score < 0.1 || (second.score >= 0.88 && top.score - second.score < 0.14));

    if (closeRunnerUp) {
      // Ambiguous: do NOT auto-select so the user explicitly picks the right co-worker in confirmation UI.
      return { id, rawName, query, role, status: 'ambiguous', selected: null, candidates };
    }

    if (top.exact && top.score >= 0.96) {
      return { id, rawName, query, role, status: 'exact', selected: top.person, candidates };
    }

    if (top.score >= 0.65) {
      return { id, rawName, query, role, status: 'fuzzy', selected: top.person, candidates };
    }

    return { id, rawName, query, role, status: 'unresolved', selected: null, candidates };
  }

  /** Enriches an email address with cached AD/Outlook display details (best effort, never throws). */
  async lookupEmail(email: string): Promise<HyperAssistantPerson | null> {
    return this.safeLookup(email);
  }
}
