import { describe, expect, it } from 'vitest';
import {
  extractBotMentions,
  extractExplicitBotMentions,
  extractSpokenBotTrigger,
  extractVoiceBotMention,
  filterBotsByQuery,
  hyperBotDisplayHandle,
  hyperStripHebrewPrefixes,
  matchBotName,
  type HyperBotLike,
} from './HyperBotResolver';

const BOTS: HyperBotLike[] = [
  { id: 'abby', name: 'Abby' },
  { id: 'scout', name: 'Scout' },
  { id: 'sales-bot', name: 'Sales Bot' },
  { id: 'bot', name: 'משה' },
  { id: 'bot-2', name: 'אבי' },
  { id: 'bot-3', name: 'בוט מכירות' },
];

describe('hyperBotDisplayHandle', () => {
  it('formats ASCII bots as @<lowercase-id> and Hebrew bots as @<Unicode name>', () => {
    expect(hyperBotDisplayHandle({ id: 'abby', name: 'Abby' })).toBe('@abby');
    expect(hyperBotDisplayHandle({ id: 'sales-bot', name: 'Sales Bot' })).toBe('@sales-bot');
    expect(hyperBotDisplayHandle({ id: 'bot', name: 'משה' })).toBe('@משה');
    expect(hyperBotDisplayHandle({ id: 'bot-2', name: 'אבי' })).toBe('@אבי');
    expect(hyperBotDisplayHandle({ id: 'bot-3', name: 'בוט מכירות' })).toBe('@בוט מכירות');
  });
});

describe('hyperStripHebrewPrefixes', () => {
  it('strips attached and hyphenated Hebrew proclitic prefixes without breaking short names', () => {
    expect(hyperStripHebrewPrefixes('למשה')).toEqual(expect.arrayContaining(['למשה', 'משה']));
    expect(hyperStripHebrewPrefixes('לאבי')).toEqual(expect.arrayContaining(['לאבי', 'אבי']));
    expect(hyperStripHebrewPrefixes('ממשה')).toEqual(expect.arrayContaining(['ממשה', 'משה']));
    expect(hyperStripHebrewPrefixes('ולאבי')).toEqual(expect.arrayContaining(['ולאבי', 'לאבי', 'אבי']));
    expect(hyperStripHebrewPrefixes('ל-Abby')).toEqual(expect.arrayContaining(['ל-Abby', 'Abby']));
  });
});

describe('extractExplicitBotMentions', () => {
  it('matches case-insensitive English, Hebrew, multi-word, and fuzzy bot @mentions', () => {
    expect(extractExplicitBotMentions('@Abby set a meeting', BOTS)).toMatchObject([{ botId: 'abby', handle: '@abby', confidence: 'exact' }]);
    expect(extractExplicitBotMentions('@abby check calendar', BOTS)).toMatchObject([{ botId: 'abby', handle: '@abby', confidence: 'exact' }]);
    expect(extractExplicitBotMentions('@משה תקבע פגישה מחר', BOTS)).toMatchObject([{ botId: 'bot', handle: '@משה', confidence: 'exact' }]);
    expect(extractExplicitBotMentions('@אבי שלח מייל', BOTS)).toMatchObject([{ botId: 'bot-2', handle: '@אבי', confidence: 'exact' }]);
    expect(extractExplicitBotMentions('@Sales Bot check leads', BOTS)).toMatchObject([{ botId: 'sales-bot', handle: '@sales-bot', confidence: 'exact' }]);
    expect(extractExplicitBotMentions('@בוט מכירות מה המצב', BOTS)).toMatchObject([{ botId: 'bot-3', handle: '@בוט מכירות', confidence: 'exact' }]);
    // Fuzzy STT spelling
    expect(extractExplicitBotMentions('@Abbey check mail', BOTS)).toMatchObject([{ botId: 'abby', confidence: 'fuzzy' }]);
    expect(extractExplicitBotMentions('@אביי שלח מייל', BOTS)).toMatchObject([{ botId: 'bot-2', confidence: 'fuzzy' }]);
  });

  it('ignores email addresses and serialized employee @[Name](mailto:...) mentions', () => {
    expect(extractExplicitBotMentions('Email aaron@abby.example today', BOTS)).toEqual([]);
    expect(extractExplicitBotMentions('Meet @[Abby](mailto:abby@corp.example) at 6', BOTS)).toEqual([]);
  });
});

describe('extractSpokenBotTrigger & extractBotMentions', () => {
  it('resolves English conversational voice triggers and isolates commandText', () => {
    const m1 = extractSpokenBotTrigger('Tell Abby to set meeting with Aaron Mitchel tomorrow at six PM', BOTS);
    expect(m1).toMatchObject({
      botId: 'abby',
      handle: '@abby',
      confidence: 'exact',
      commandText: 'set meeting with Aaron Mitchel tomorrow at six PM',
    });

    expect(extractSpokenBotTrigger('Ask Abbey to email Dana', BOTS)).toMatchObject({
      botId: 'abby',
      confidence: 'fuzzy',
      commandText: 'email Dana',
    });

    expect(extractSpokenBotTrigger('Hey Scout, what meetings do I have?', BOTS)).toMatchObject({
      botId: 'scout',
      commandText: 'what meetings do I have?',
    });

    expect(extractSpokenBotTrigger('Abby, schedule a sync with Aaron', BOTS)).toMatchObject({
      botId: 'abby',
      commandText: 'schedule a sync with Aaron',
    });

    expect(extractSpokenBotTrigger('Have Sales Bot check Q4 numbers', BOTS)).toMatchObject({
      botId: 'sales-bot',
      commandText: 'check Q4 numbers',
    });
  });

  it('resolves Hebrew conversational triggers with attached prefixes (למשה, לאבי, מאבי, ממשה) and fuzzy spelling', () => {
    expect(extractSpokenBotTrigger('תגיד למשה לקבוע פגישה עם ישראל ישראלי מחר בשש בערב', BOTS)).toMatchObject({
      botId: 'bot',
      handle: '@משה',
      confidence: 'exact',
      commandText: 'לקבוע פגישה עם ישראל ישראלי מחר בשש בערב',
    });

    expect(extractSpokenBotTrigger('תגידי לאבי לשלוח מייל לישראל ישראלי', BOTS)).toMatchObject({
      botId: 'bot-2',
      handle: '@אבי',
      confidence: 'exact',
      commandText: 'לשלוח מייל לישראל ישראלי',
    });

    expect(extractSpokenBotTrigger('בקש מאבי לבדוק יומן', BOTS)).toMatchObject({
      botId: 'bot-2',
      handle: '@אבי',
      commandText: 'לבדוק יומן',
    });

    expect(extractSpokenBotTrigger('תבקש ממושה לשלוח מייל', BOTS)).toMatchObject({
      botId: 'bot',
      handle: '@משה',
      confidence: 'fuzzy',
      commandText: 'לשלוח מייל',
    });

    expect(extractSpokenBotTrigger('היי משה, תבדוק את המיילים שלי', BOTS)).toMatchObject({
      botId: 'bot',
      commandText: 'תבדוק את המיילים שלי',
    });

    expect(extractSpokenBotTrigger('משה, תקבע פגישה עם ישראל ישראלי', BOTS)).toMatchObject({
      botId: 'bot',
      commandText: 'תקבע פגישה עם ישראל ישראלי',
    });

    expect(extractSpokenBotTrigger('שלח דרך אבי מייל לדנה', BOTS)).toMatchObject({
      botId: 'bot-2',
      commandText: 'מייל לדנה',
    });

    // Hebrew niqqud & double-yod fuzzy match
    expect(extractSpokenBotTrigger('תגיד לאָבִיי לבדוק פגישות', BOTS)).toMatchObject({
      botId: 'bot-2',
      confidence: 'fuzzy',
    });
  });

  it('resolves mixed English+Hebrew voice triggers', () => {
    expect(extractSpokenBotTrigger('תגיד ל-Abby לקבוע פגישה עם Aaron Mitchel', BOTS)).toMatchObject({
      botId: 'abby',
      handle: '@abby',
      commandText: 'לקבוע פגישה עם Aaron Mitchel',
    });

    expect(extractSpokenBotTrigger('Tell אבי to send email to Aaron Mitchel', BOTS)).toMatchObject({
      botId: 'bot-2',
      handle: '@אבי',
      commandText: 'send email to Aaron Mitchel',
    });
  });

  it('gives explicit @mentions precedence over spoken triggers', () => {
    expect(extractBotMentions('@Sales Bot find prospects', [
    { id: 'sales', name: 'Sales' }, { id: 'prospects', name: 'Sales Bot' },
  ])[0]?.botId).toBe('prospects');
  expect(extractBotMentions('Tell Abby to ping @משה', BOTS)).toMatchObject([
      { botId: 'bot', source: 'at-mention', handle: '@משה' },
    ]);
  });

  it('filters bots for @ autocomplete in both English and Hebrew', () => {
    expect(filterBotsByQuery('ab', BOTS).map((b) => b.bot.id)).toEqual(['abby']);
    expect(filterBotsByQuery('מש', BOTS).map((b) => b.handle)).toEqual(['@משה']);
    expect(filterBotsByQuery('אבי', BOTS).map((b) => b.handle)).toEqual(['@אבי']);
    expect(matchBotName('Abbey', BOTS)?.bot.id).toBe('abby');
  });
});

it('prioritizes explicit IDs and shorter exact spoken bot names', () => {
  expect(extractBotMentions('@scout check mail', [
    { id: 'helper', name: 'Scout' }, { id: 'scout', name: 'Research' },
  ])[0]?.botId).toBe('scout');
  expect(extractBotMentions('@Sales Bot find prospects', [
    { id: 'sales', name: 'Sales' }, { id: 'prospects', name: 'Sales Bot' },
  ])[0]?.botId).toBe('prospects');
  expect(extractBotMentions('Tell Abby to send email', [
    { id: 'abby', name: 'Abby' }, { id: 'abby-b', name: 'Abby B' },
  ])[0]).toMatchObject({ botId: 'abby', commandText: 'send email' });
});

describe('extractVoiceBotMention', () => {
  const bots = [...BOTS, { id: 'dana', name: 'Dana' }];

  it.each([
    ['I needed to use dana and then with her check my emails', 'dana', 'exact', 'check my emails'],
    ['I need you to use Dana, and then check my emails', 'dana', 'exact', 'check my emails'],
    ['I’d like Danna to check my emails', 'dana', 'fuzzy', 'check my emails'],
    ['I want Sales Bot to check Q4 numbers', 'sales-bot', 'exact', 'check Q4 numbers'],
    ['אני צריך להשתמש במשה ואז איתו לבדוק את המיילים שלי', 'bot', 'exact', 'לבדוק את המיילים שלי'],
    ['אני רוצה שמשה יסכם את המיילים שלי', 'bot', 'exact', 'יסכם את המיילים שלי'],
    ['דנה תבדקי את המיילים שלי', 'dana', 'fuzzy', 'תבדקי את המיילים שלי'],
    ['אני צריך לבדוק עם דנה מה יש במיילים שלי', 'dana', 'fuzzy', 'לבדוק מה יש במיילים שלי'],
    ['תגיד לסקאוט לבדוק את המיילים שלי', 'scout', 'fuzzy', 'לבדוק את המיילים שלי'],
    ['Ask Moshe to check my emails', 'bot', 'fuzzy', 'check my emails'],
  ])('resolves the bot and task in %s', (text, botId, confidence, commandText) => {
    expect(extractVoiceBotMention(text, bots)).toMatchObject({ botId, confidence, commandText });
  });

  it.each([
    'Check my emails from Dana',
    'I need Dana’s email address',
    'I need to ask Dana Cohen to check her emails',
    'I need data to check my emails',
    'I do not want Dana to check my emails',
    'שלח מייל לדנה כהן על הדוח',
  ])('does not infer a bot target from %s', (text) => {
    expect(extractVoiceBotMention(text, bots)).toBeNull();
  });

  it('gives an explicit bot mention precedence', () => {
    expect(extractVoiceBotMention('I need Dana to check my emails, @scout', bots))
      .toMatchObject({ botId: 'scout', source: 'at-mention' });
  });

  it('prefers the configured Hebrew spelling and only uses an unambiguous transliteration', () => {
    const dina = { id: 'dina', name: 'Dina' };
    const hebrewDana = { id: 'dana-he', name: 'דנה' };
    expect(extractVoiceBotMention('תגידי לדנה לבדוק את המיילים שלי', [...bots, dina])).toBeNull();
    expect(extractVoiceBotMention('תגידי לדנה לבדוק את המיילים שלי', [...bots, dina, hebrewDana]))
      .toMatchObject({ botId: 'dana-he', handle: '@דנה', confidence: 'exact' });
  });
});
