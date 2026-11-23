import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HyperPerson } from '@shared/api';
import {
  buildHyperBotMentionOptions,
  hyperBotComposerMentionQuery,
  HyperBotMentionPopover,
  HyperBotRichText,
  insertHyperBotMention,
} from './HyperBotMentionPopover';

const BOTS = [
  { id: 'abby', name: 'Abby' },
  { id: 'bot', name: 'משה' },
  { id: 'bot-2', name: 'אבי' },
];

const PEOPLE: HyperPerson[] = [
  {
    name: 'Aaron Mitchel',
    email: 'aaron.mitchel@company.com',
    title: 'Engineer',
    department: 'Core',
    phone: '',
    office: '',
    company: '',
    source: 'ad',
  },
  {
    name: 'ישראל ישראלי',
    email: 'israel@company.co.il',
    title: 'מנהל מוצר',
    department: 'פיתוח',
    phone: '',
    office: '',
    company: '',
    source: 'outlook',
  },
];

describe('HyperBotMentionPopover helpers & rendering', () => {
  it('detects active @ queries in English and Hebrew while ignoring emails', () => {
    expect(hyperBotComposerMentionQuery('@', 1)).toEqual({ query: '', start: 0, end: 1 });
    expect(hyperBotComposerMentionQuery('Ask @ab', 7)).toEqual({ query: 'ab', start: 4, end: 7 });
    expect(hyperBotComposerMentionQuery('תגיד @מש', 8)).toEqual({ query: 'מש', start: 5, end: 8 });
    expect(hyperBotComposerMentionQuery('פגישה עם @ישראל יש', 18)).toEqual({
      query: 'ישראל יש',
      start: 9,
      end: 18,
    });
    expect(hyperBotComposerMentionQuery('email aaron@company.com', 23)).toBeNull();
  });

  it('inserts bot handles and serialized employee mentions cleanly', () => {
    const botRes = insertHyperBotMention('תגיד @מש מחר', { query: 'מש', start: 5, end: 8 }, {
      kind: 'bot',
      bot: BOTS[1]!,
      handle: '@משה',
    });
    expect(botRes.nextValue).toBe('תגיד @משה  מחר');

    const personRes = insertHyperBotMention('Meet @Aaron', { query: 'Aaron', start: 5, end: 11 }, {
      kind: 'person',
      person: PEOPLE[0]!,
    });
    expect(personRes.nextValue).toBe('Meet @[Aaron Mitchel](mailto:aaron.mitchel@company.com) ');
  });

  it('builds unified options and renders popover with Bots and Outlook People sections', () => {
    const options = buildHyperBotMentionOptions('מש', BOTS, PEOPLE);
    expect(options.map((o) => o.kind)).toEqual(['bot', 'person', 'person']);

    const html = renderToStaticMarkup(
      <HyperBotMentionPopover
        id="mention-list"
        query="ישראל"
        options={buildHyperBotMentionOptions('', BOTS, PEOPLE)}
        peopleLoading={false}
        peopleError={null}
        activeIndex={0}
        onActiveChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain('role="listbox"');
    expect(html).toContain('@abby');
    expect(html).toContain('@משה');
    expect(html).toContain('@אבי');
    expect(html).toContain('Aaron Mitchel');
    expect(html).toContain('ישראל ישראלי');
  });

  it('renders HyperBotRichText with both @bot chips and @[Name](mailto:...) employee chips, preserving plain text', () => {
    expect(renderToStaticMarkup(<HyperBotRichText text="Plan my day" bots={BOTS} />)).toBe('Plan my day');

    const mixedHtml = renderToStaticMarkup(
      <HyperBotRichText
        text="@משה תקבע פגישה עם @[ישראל ישראלי](mailto:israel@company.co.il) ועם @abby"
        bots={BOTS}
      />,
    );
    expect(mixedHtml).toContain('hb-mention-chip--bot');
    expect(mixedHtml).toContain('@משה');
    expect(mixedHtml).toContain('@abby');
    expect(mixedHtml).toContain('hb-mention-chip--person');
    expect(mixedHtml).toContain('@ישראל ישראלי');
    expect(mixedHtml).not.toContain('mailto:israel@company.co.il');
  });
});
