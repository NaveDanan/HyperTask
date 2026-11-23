import { describe, expect, it } from 'vitest';
import { cloudSpeechLanguages, effectiveSpeechLanguage } from '@shared/hyper-voice/speechShared';
import { makeSpeechTextCorrector } from './customWords';

describe('customWords bilingual EN+HE support', () => {
  it('corrects English phonetic/fuzzy bot & product terms', () => {
    const correct = makeSpeechTextCorrector(['Abby', 'HyperTask'], []);
    expect(correct('Tell Abbey to open hyper task')).toBe('Tell Abby to open HyperTask');
  });

  it('corrects Hebrew bot and employee names while preserving proclitic prefixes', () => {
    const correct = makeSpeechTextCorrector(['אבי', 'משה', 'ישראל ישראלי'], []);
    expect(correct('תגיד לאביי לקבוע פגישה עם ישראל ישראלי')).toBe(
      'תגיד לאבי לקבוע פגישה עם ישראל ישראלי',
    );
    expect(correct('תבקש ממושה לשלוח מייל')).toBe('תבקש ממשה לשלוח מייל');
    expect(correct('היי אֲבִי מה שלומך')).toBe('היי אבי מה שלומך');
  });

  it('does not corrupt unrelated short Hebrew words like אני into אבי', () => {
    const correct = makeSpeechTextCorrector(['אבי', 'משה'], []);
    expect(correct('אני רוצה לשלוח הודעה לאביי')).toBe('אני רוצה לשלוח הודעה לאבי');
  });

  it('corrects multi-word Hebrew employee typos of length >= 4', () => {
    const correct = makeSpeechTextCorrector(['ישראל ישראלי'], []);
    expect(correct('קבע פגישה עם ישראל ישרעלי מחר')).toBe('קבע פגישה עם ישראל ישראלי מחר');
  });

  it('includes Hebrew in cloudSpeechLanguages', () => {
    expect(cloudSpeechLanguages.languages).toContain('he');
    expect(effectiveSpeechLanguage(cloudSpeechLanguages, 'he')).toBe('he');
    expect(effectiveSpeechLanguage(cloudSpeechLanguages, 'auto')).toBe('auto');
  });
});
