import { describe, expect, it } from 'vitest';
import { hyperHubExtract, hyperHubFixturePrecision, type HyperHubAuthoredMail } from './HyperHubExtraction';

const mail: HyperHubAuthoredMail = { aliases: ['Yael', 'יעל', 'José'], to: ['Yael'], authoredAt: '2026-11-29T23:00:00Z',
  zone: 'Asia/Jerusalem', folder: 'inbox', body: '', distributionList: false };
const extract = (body: string, overrides: Partial<HyperHubAuthoredMail> = {}) => hyperHubExtract({ ...mail, ...overrides, body });
describe('authored mail', () => {
  it.each([
    ['FYI, please review the deck.', 'לידיעה, נא לשלוח מחר.'],
    ["Please don't send the invoice.", 'אין צורך, נא לשלוח רק בשבוע הבא.'],
    ['Accepted: please review.', 'קיבלתי, נא לבדוק.'],
    ['Hello\nOn Monday Amit wrote:\nPlease send the file.', 'שלום\nמאת: עמית\nנא לשלוח את הקובץ.'],
    ['Thanks,\nPlease call my office.', 'בברכה,\nנא להתקשר למשרד.'],
    ['Hello\nConfidentiality notice: please delete.', 'שלום\nהודעת סודיות: נא למחוק.'],
    ['> Please reply today.', '> נא להשיב היום.'],
    ['She wrote “please send the file”.', 'הוא כתב "נא לשלוח מחר".'],
    ['Looks good?', 'מעניין?'],
  ])('suppresses %s and its Hebrew counterpart', (en, he) => {
    expect(extract(en)).toEqual([]); expect(extract(he)).toEqual([]);
  });
  it.each(['Please send the file.', 'נא לשלוח את הקובץ.'])('suppresses Cc-only, lists and unknown distribution for %s', body => {
    expect(extract(body, { to: ['Bob'] })).toEqual([]);
    expect(extract(body, { distributionList: true })).toEqual([]);
    expect(extract(body, { distributionList: null })).toEqual([]);
  });
  it('preserves decomposed Latin, pointed Hebrew, ownership boundaries and original UTF-16 offsets', () => {
    const body = '🙂 Hello\nJose\u0301, please review ENG-9 tomorrow, Dan: please archive it.\r\nיָעֵל, נָא לִשְׁלוֹחַ מחר.';
    const result = extract(body);
    expect(result.map(r => r.excerpt)).toEqual(['Jose\u0301, please review ENG-9 tomorrow', 'יָעֵל, נָא לִשְׁלוֹחַ מחר.']);
    for (const r of result) {
      expect(body.slice(r.start, r.end)).toBe(r.excerpt);
      expect(r.resolvedDate?.date).toBe('2026-12-01');
    }
    expect(new Set(result.map(r => r.fingerprint)).size).toBe(2);
  });
  it('uses Sent promises and never guesses the order in a numeric date', () => {
    for (const body of ["I'll send the file on 03/04.", 'אשלח את הקובץ ב-03/04.']) {
      expect(extract(body)).toEqual([]);
      const [promise] = extract(body, { folder: 'sent' });
      expect(promise.rule).toBe('Promise in Sent'); expect(promise.resolvedDate).toBeUndefined();
    }
  });
  it.each(['When is the release?', 'מתי מועד המסירה?'])('requires explicit reply coverage for %s', body => {
    expect(extract(body)).toEqual([]);
    expect(extract(body, { unanswered: true })[0].rule).toBe('Unanswered direct question');
  });
  it('extracts a direct imperative and drops an incomplete trailing request', () => {
    const [task] = extract('Yael: review the budget. Please send the', { truncated: true });
    expect(task.excerpt).toBe('Yael: review the budget.');
    expect(extract('Yael: review the budget. Please send the', { truncated: true })).toHaveLength(1);
  });
  it('preserves configured URL text and measures labelled cohort fixtures', () => {
    const text = 'Please review https://jira.example/context/browse/ENG-9.';
    expect(extract(text)[0].excerpt).toBe(text);
    expect(hyperHubFixturePrecision).toEqual({ en: 1, he: 1, mixed: 1 });
  });
});
