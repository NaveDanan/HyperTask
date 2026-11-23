import { describe, expect, it, vi } from 'vitest';
import type { HyperAssistantPerson } from '@shared/HyperAssistant';
import { hyperBotsWithDirectRooms, type HyperBotsSettings } from '@shared/HyperBots';
import { HyperPeopleResolver } from './HyperPeopleResolver';
import { HyperVoiceCommandParser } from './HyperVoiceCommandParser';

const AARON: HyperAssistantPerson = {
  name: 'Aaron Mitchell',
  email: 'aaron.mitchell@corp.example',
  title: 'Staff Engineer',
  department: 'Platform',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

const AARON_B: HyperAssistantPerson = {
  name: 'Aaron Miller',
  email: 'aaron.miller@corp.example',
  title: 'Designer',
  department: 'Design',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

const DANA: HyperAssistantPerson = {
  name: 'Dana Cohen',
  email: 'dana.cohen@corp.example',
  title: 'PM',
  department: 'Product',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

const LEE: HyperAssistantPerson = {
  name: 'Lee Levi',
  email: 'lee.levi@corp.example',
  title: 'Finance Lead',
  department: 'Finance',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

const ISRAEL: HyperAssistantPerson = {
  name: 'ישראל ישראלי',
  email: 'israel.israeli@corp.example',
  title: 'מהנדס תוכנה',
  department: 'פיתוח',
  phone: '',
  office: 'תל אביב',
  company: 'HyperTask',
  source: 'outlook',
};

const DANA_HE: HyperAssistantPerson = {
  name: 'דנה כהן',
  email: 'dana.he@corp.example',
  title: 'מנהלת מוצר',
  department: 'מוצר',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

const DIRECTORY = [AARON, AARON_B, DANA, LEE, ISRAEL, DANA_HE];

const SETTINGS: HyperBotsSettings = hyperBotsWithDirectRooms({
  version: 1,
  bots: [
    {
      id: 'abby',
      name: 'Abby',
      mode: 'personal',
      instructions: 'You are Abby.',
      model: '',
      tools: ['outlook_list_events', 'outlook_get_event', 'outlook_list_messages', 'outlook_read_message'],
    },
    {
      id: 'bot',
      name: 'משה',
      mode: 'personal',
      instructions: 'אתה משה.',
      model: '',
      tools: ['outlook_list_events', 'outlook_get_event', 'outlook_create_event', 'outlook_list_messages', 'outlook_read_message', 'outlook_search_people', 'outlook_send_message'],
    },
    {
      id: 'bot-2',
      name: 'אבי',
      mode: 'personal',
      instructions: 'אתה אבי.',
      model: '',
      tools: ['outlook_list_events', 'outlook_list_messages', 'outlook_search_people'],
    },
  ],
  rooms: [{ id: 'ops', name: 'Ops', kind: 'group', botIds: ['abby', 'bot', 'bot-2'] }],
  policy: { outlook_list_events: 'ask', outlook_get_event: 'ask', outlook_list_messages: 'ask', outlook_read_message: 'ask', outlook_search_people: 'allow' },
});

function makeParser(opts: { directory?: HyperAssistantPerson[]; refineWithLlm?: (prompt: string, signal: AbortSignal) => Promise<string | null> } = {}) {
  const dir = opts.directory ?? DIRECTORY;
  const bridge = {
    request: vi.fn(async (op: string, args: any) => {
      if (op === 'people.lookup') {
        return dir.find((p) => p.email.toLowerCase() === String(args.email).toLowerCase()) ?? null;
      }
      if (op === 'people.search') {
        const qTokens = String(args.query).toLowerCase().split(/\s+/).filter(Boolean);
        return dir.filter((p) => {
          const hayTokens = `${p.name} ${p.email}`.toLowerCase().split(/[\s.@_-]+/).filter(Boolean);
          return qTokens.every((qt) => hayTokens.some((ht) => ht.startsWith(qt)));
        });
      }
      return [];
    }),
  };
  return new HyperVoiceCommandParser({
    peopleResolver: new HyperPeopleResolver(bridge as never),
    refineWithLlm: opts.refineWithLlm,
  });
}

describe('HyperVoiceCommandParser', () => {
  it('parses the signature English meeting command, resolves Abby + Aaron Mitchel, and flags missing write tools', async () => {
    const parser = makeParser();
    const plan = await parser.parse({
      text: 'Tell Abby to set meeting with Aaron Mitchel tomorrow at six PM',
      settings: SETTINGS,
      signedIn: true,
    });

    expect(plan.language).toBe('en');
    expect(plan.intent).toBe('meeting');
    expect(plan.resolvedBot).toMatchObject({ id: 'abby', handle: '@abby', confidence: 'exact' });
    expect(plan.targetRoomId).toBe('dm-abby');
    expect(plan.people).toHaveLength(1);
    expect(plan.people[0]).toMatchObject({
      rawName: 'Aaron Mitchel',
      query: 'Aaron Mitchel',
      role: 'attendee',
      status: 'fuzzy',
      selected: AARON,
    });
    expect(plan.normalizedText).toBe('@abby set meeting with @Aaron Mitchell tomorrow at six PM');
    expect(plan.canonicalText).toBe('@abby set meeting with @[Aaron Mitchell](mailto:aaron.mitchell@corp.example) tomorrow at six PM');
    expect(plan.missingTools).toEqual(['outlook_create_event', 'outlook_search_people']);
    expect(plan.requiresConfirmation).toBe(true);
  });

  it('extracts multiple people and CC recipients in English email commands without capturing topic words', async () => {
    const parser = makeParser();
    const plan = await parser.parse({
      text: 'Ask Abby to send an email to Aaron Mitchell and Dana Cohen cc Lee Levi about the budget',
      settings: SETTINGS,
      signedIn: true,
    });

    expect(plan.intent).toBe('email');
    expect(plan.resolvedBot?.id).toBe('abby');
    expect(plan.people.map((p) => [p.selected?.email, p.role])).toEqual([
      ['aaron.mitchell@corp.example', 'to'],
      ['dana.cohen@corp.example', 'to'],
      ['lee.levi@corp.example', 'cc'],
    ]);
    expect(plan.normalizedText).toContain('@Aaron Mitchell');
    expect(plan.normalizedText).toContain('@Dana Cohen');
    expect(plan.normalizedText).toContain('@Lee Levi');
    expect(plan.normalizedText).toContain('about the budget');
    expect(plan.missingTools).toContain('outlook_send_message');
  });

  it('parses Hebrew meeting command with Hebrew bot (@משה) and Hebrew employee (@ישראל ישראלי)', async () => {
    const parser = makeParser();
    const plan = await parser.parse({
      text: 'תגיד למשה לקבוע פגישה עם ישראל ישראלי מחר בשש בערב',
      settings: SETTINGS,
      signedIn: true,
    });

    expect(plan.language).toBe('he');
    expect(plan.intent).toBe('meeting');
    expect(plan.resolvedBot).toMatchObject({ id: 'bot', name: 'משה', handle: '@משה', confidence: 'exact' });
    expect(plan.targetRoomId).toBe('dm-bot');
    expect(plan.people).toHaveLength(1);
    expect(plan.people[0]).toMatchObject({
      query: 'ישראל ישראלי',
      status: 'exact',
      selected: ISRAEL,
    });
    expect(plan.normalizedText).toBe('@משה לקבוע פגישה עם @ישראל ישראלי מחר בשש בערב');
    expect(plan.canonicalText).toBe('@משה לקבוע פגישה עם @[ישראל ישראלי](mailto:israel.israeli@corp.example) מחר בשש בערב');
    expect(plan.missingTools).toEqual([]);
  });

  it('parses Hebrew email command with glued ל prefix on both bot (לאבי) and employee (לישראל ישראלי)', async () => {
    const parser = makeParser();
    const plan = await parser.parse({
      text: 'תגידי לאבי לשלוח מייל לישראל ישראלי על הדוח השבועי',
      settings: SETTINGS,
      signedIn: true,
    });

    expect(plan.language).toBe('he');
    expect(plan.intent).toBe('email');
    expect(plan.resolvedBot).toMatchObject({ id: 'bot-2', name: 'אבי', handle: '@אבי' });
    expect(plan.people).toHaveLength(1);
    expect(plan.people[0]).toMatchObject({
      query: 'ישראל ישראלי',
      role: 'to',
      status: 'exact',
      selected: ISRAEL,
    });
    expect(plan.canonicalText).toContain('@אבי');
    expect(plan.canonicalText).toContain('@[ישראל ישראלי](mailto:israel.israeli@corp.example)');
    expect(plan.canonicalText).toContain('על הדוח השבועי');
    expect(plan.missingTools).toEqual(['outlook_send_message']);
  });

  it('splits multiple Hebrew co-workers joined by attached ו (ישראל ישראלי ודנה כהן)', async () => {
    const parser = makeParser();
    const plan = await parser.parse({
      text: 'תגיד למשה לקבוע פגישה עם ישראל ישראלי ודנה כהן מחר',
      settings: SETTINGS,
      signedIn: true,
    });

    expect(plan.people.map((p) => p.selected?.email)).toEqual([
      'israel.israeli@corp.example',
      'dana.he@corp.example',
    ]);
  });

  it('parses mixed English+Hebrew voice commands in both directions', async () => {
    const parser = makeParser();

    const heBotEnPerson = await parser.parse({
      text: 'תגיד ל-Abby לקבוע פגישה עם Aaron Mitchel מחר ב-10',
      settings: SETTINGS,
      signedIn: true,
    });
    expect(heBotEnPerson.language).toBe('mixed');
    expect(heBotEnPerson.intent).toBe('meeting');
    expect(heBotEnPerson.resolvedBot?.id).toBe('abby');
    expect(heBotEnPerson.people[0]?.selected).toEqual(AARON);

    const enBotHePerson = await parser.parse({
      text: 'Tell אבי to email ישראל ישראלי about the Q4 release',
      settings: SETTINGS,
      signedIn: true,
    });
    expect(enBotHePerson.language).toBe('mixed');
    expect(enBotHePerson.intent).toBe('email');
    expect(enBotHePerson.resolvedBot?.id).toBe('bot-2');
    expect(enBotHePerson.people[0]?.selected).toEqual(ISRAEL);
  });

  it('surfaces ambiguous and unresolved person slots cleanly for Step 1 confirmation', async () => {
    const parser = makeParser();

    const ambiguous = await parser.parse({
      text: 'Tell Abby to set meeting with Aaron tomorrow at 5 PM',
      settings: SETTINGS,
      signedIn: true,
    });
    expect(ambiguous.people[0]).toMatchObject({ status: 'ambiguous', selected: null });
    expect(ambiguous.people[0]!.candidates).toHaveLength(2);
    expect(ambiguous.normalizedText).toContain('@Aaron');

    const unresolved = await parser.parse({
      text: 'Tell Abby to email Unknown Person about the roadmap',
      settings: SETTINGS,
      signedIn: true,
    });
    expect(unresolved.people[0]).toMatchObject({ status: 'unresolved', selected: null, candidates: [] });
  });

  it('uses optional LLM refinement for unusual phrasing and never fails when LLM throws', async () => {
    const withLlm = makeParser({
      refineWithLlm: vi.fn(async () => JSON.stringify({ intent: 'meeting', people: ['Aaron Mitchel'] })),
    });
    const plan = await withLlm.parse({
      text: 'Tell Abby Aaron Mitchel needs an invite for 3pm tomorrow',
      settings: SETTINGS,
      signedIn: true,
    });
    expect(plan.intent).toBe('meeting');
    expect(plan.people[0]?.selected).toEqual(AARON);

    const brokenLlm = makeParser({
      refineWithLlm: vi.fn(async () => { throw new Error('endpoint offline'); }),
    });
    const safe = await brokenLlm.parse({
      text: 'Tell Abby what meetings I have tomorrow',
      settings: SETTINGS,
      signedIn: true,
    });
    expect(safe.intent).toBe('general');
    expect(safe.resolvedBot?.id).toBe('abby');
  });

  it('handles unsigned-in state gracefully without throwing', async () => {
    const parser = makeParser();
    const plan = await parser.parse({
      text: 'Set a meeting with Aaron Mitchel tomorrow',
      settings: null,
      signedIn: false,
    });
    expect(plan.signedIn).toBe(false);
    expect(plan.resolvedBot).toBeNull();
    expect(plan.warnings[0]).toMatch(/Sign in/i);
    expect(plan.people[0]?.selected).toEqual(AARON);
  });
});
