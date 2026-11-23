import { describe, expect, it, vi } from 'vitest';
import type { HyperAssistantPerson } from '@shared/HyperAssistant';
import {
  HyperPeopleResolver,
  hyperCleanPersonQuery,
  hyperPersonQueryVariants,
  scorePersonAgainstQuery,
} from './HyperPeopleResolver';

const AARON: HyperAssistantPerson = {
  name: 'Aaron Mitchell',
  email: 'aaron.mitchell@corp.example',
  title: 'Staff Engineer',
  department: 'Platform',
  phone: '+1-555-0100',
  office: 'NYC',
  company: 'HyperTask',
  source: 'ad',
};

const AARON_B: HyperAssistantPerson = {
  name: 'Aaron Miller',
  email: 'aaron.miller@corp.example',
  title: 'Product Designer',
  department: 'Design',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

const ISRAEL: HyperAssistantPerson = {
  name: 'ישראל ישראלי',
  email: 'israel.israeli@corp.example',
  title: 'מנהל מוצר',
  department: 'מוצר',
  phone: '050-0000000',
  office: 'תל אביב',
  company: 'HyperTask',
  source: 'outlook',
};

const MOSHE: HyperAssistantPerson = {
  name: 'משה כהן',
  email: 'moshe.cohen@corp.example',
  title: 'ר"צ פיתוח',
  department: 'הנדסה',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

function makeResolver(directory: HyperAssistantPerson[], opts: { fail?: string } = {}) {
  const queries: string[] = [];
  const request = vi.fn(async (op: string, args: any) => {
    if (opts.fail) throw new Error(opts.fail);
    if (op === 'people.lookup') {
      return directory.find((p) => p.email.toLowerCase() === String(args.email).toLowerCase()) ?? null;
    }
    if (op === 'people.search') {
      const q = String(args.query).toLowerCase();
      queries.push(String(args.query));
      // Simulate AD ANR: matches if every token in query is a prefix of some token in displayName or email
      const qTokens = q.split(/\s+/).filter(Boolean);
      return directory.filter((p) => {
        const hay = `${p.name} ${p.email}`.toLowerCase();
        const hayTokens = hay.split(/[\s.@_-]+/).filter(Boolean);
        return qTokens.every((qt) => hayTokens.some((ht) => ht.startsWith(qt)));
      });
    }
    return [];
  });
  return { resolver: new HyperPeopleResolver({ request } as never), request, queries };
}

describe('HyperPeopleResolver helpers', () => {
  it('cleans punctuation and generates Hebrew proclitic variants safely', () => {
    expect(hyperCleanPersonQuery('  @Aaron Mitchel, ')).toBe('Aaron Mitchel');
    expect(hyperCleanPersonQuery('ל-Aaron Mitchel')).toBe('Aaron Mitchel');
    expect(hyperCleanPersonQuery('את ישראל ישראלי')).toBe('ישראל ישראלי');
    expect(hyperPersonQueryVariants('לישראל ישראלי')).toEqual(['לישראל ישראלי', 'ישראל ישראלי']);
  });

  it('scores phonetic English & Hebrew typos accurately', () => {
    expect(scorePersonAgainstQuery('Aaron Mitchell', AARON)).toMatchObject({ exact: true, score: 1 });
    expect(scorePersonAgainstQuery('Aaron Mitchel', AARON).score).toBeGreaterThan(0.9);
    expect(scorePersonAgainstQuery('Aron Mitchell', AARON).score).toBeGreaterThan(0.8);
    expect(scorePersonAgainstQuery('לישראל ישראלי', ISRAEL).score).toBeGreaterThan(0.95);
    expect(scorePersonAgainstQuery('ישראל ישראלי', AARON).score).toBe(0);
  });
});

describe('HyperPeopleResolver.resolveSlot', () => {
  it('resolves exact English and Hebrew names', async () => {
    const { resolver } = makeResolver([AARON, ISRAEL]);
    expect(await resolver.resolveSlot('p1', 'Aaron Mitchell', 'attendee')).toMatchObject({
      status: 'exact',
      selected: AARON,
    });
    expect(await resolver.resolveSlot('p2', 'ישראל ישראלי', 'attendee')).toMatchObject({
      status: 'exact',
      selected: ISRAEL,
    });
  });

  it('resolves STT typos like "Aaron Mitchel" and first-name typos like "Aron Mitchell" via multi-token fallback', async () => {
    const { resolver, queries } = makeResolver([AARON, AARON_B]);
    // "Aaron Mitchel" hits AD ANR prefix directly and ranks Aaron Mitchell far above Aaron Miller
    const singleL = await resolver.resolveSlot('p1', 'Aaron Mitchel', 'attendee');
    expect(singleL).toMatchObject({ status: 'fuzzy', selected: AARON });

    // "Aron Mitchell" misses full ANR ("aron" not prefix of "aaron"), falls back to searching "Mitchell"
    const typo = await resolver.resolveSlot('p2', 'Aron Mitchell', 'attendee');
    expect(typo).toMatchObject({ status: 'fuzzy', selected: AARON });
    expect(queries).toContain('Mitchell');
  });

  it('strips Hebrew prefix "לישראל ישראלי" as fallback while NOT mis-stripping real מ-names like "משה כהן"', async () => {
    const { resolver } = makeResolver([ISRAEL, MOSHE]);
    const prefixed = await resolver.resolveSlot('p1', 'לישראל ישראלי', 'to');
    expect(prefixed).toMatchObject({ status: 'exact', selected: ISRAEL });

    const realMemName = await resolver.resolveSlot('p2', 'משה כהן', 'attendee');
    expect(realMemName).toMatchObject({ status: 'exact', selected: MOSHE });
  });

  it('marks multiple close candidates as ambiguous with selected=null so the user must choose', async () => {
    const { resolver } = makeResolver([AARON, AARON_B]);
    const ambig = await resolver.resolveSlot('p1', 'Aaron', 'attendee');
    expect(ambig.status).toBe('ambiguous');
    expect(ambig.selected).toBeNull();
    expect(ambig.candidates.map((c) => c.email).sort()).toEqual([
      'aaron.miller@corp.example',
      'aaron.mitchell@corp.example',
    ]);
  });

  it('marks 0-match queries as unresolved and surfaces directory errors gracefully', async () => {
    const { resolver } = makeResolver([AARON]);
    expect(await resolver.resolveSlot('p1', 'Nobody Here', 'to')).toMatchObject({
      status: 'unresolved',
      selected: null,
      candidates: [],
    });

    const failing = makeResolver([], { fail: 'Employee directory is unavailable.' });
    expect(await failing.resolver.resolveSlot('p2', 'Aaron Mitchel', 'attendee')).toMatchObject({
      status: 'unresolved',
      selected: null,
      error: 'Employee directory is unavailable.',
    });
  });
});
