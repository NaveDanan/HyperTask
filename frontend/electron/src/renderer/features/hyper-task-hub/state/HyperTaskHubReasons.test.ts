import { describe, expect, it } from 'vitest';
import type { HyperHubAgendaItem, HyperHubPlacementReason, HyperHubRanked } from '@shared/HyperTaskHub';
import { HyperHubM1Fixture, HyperHubM2Fixture } from '@shared/HyperTaskHub.fixtures';
import {
  hyperBuildWhyRows, hyperFormatBlocker, hyperFormatBriefReason, hyperFormatCapacity, hyperFormatOverflow, hyperFormatPlacementReason,
  hyperFormatRankReason, hyperFormatRecommendation,
} from './HyperTaskHubReasons';
import { hyperSelectToday } from './HyperTaskHubSelectors';

describe('HyperTaskHub reason strings', () => {
  it('formats a scoped Jira mention and verified series history in English and Hebrew', () => {
    const jira = { code: 'jira-key', points: 60, facts: { instanceId: 'jira', key: 'ENG-317' } } as const;
    const history = { code: 'series-history', points: 35, facts: { start: '2026-11-15T09:00:00Z', ageDays: 14 } } as const;
    expect(hyperFormatBriefReason(jira, 'en')).toBe('Mentions ENG-317');
    expect(hyperFormatBriefReason(jira, 'he')).toBe('כולל אזכור של ENG-317');
    expect(hyperFormatBriefReason(history, 'en-US')).toBe('Same series, 2 weeks ago');
    expect(hyperFormatBriefReason(history, 'he-IL')).toBe('מאותה סדרת פגישות, לפני שבועיים');
  });

  it('formats Jira rank provenance, meeting placement and blockers using the chosen language', () => {
    const importance = HyperHubM1Fixture.ranking[0].reasons.find(reason => reason.signal === 'importance')!;
    expect(hyperFormatRankReason(importance, 'en')).toBe('Importance from Jira priority (high)');
    expect(hyperFormatRankReason(importance, 'he')).toBe('חשיבות לפי העדיפות ב-Jira (גבוהה)');
    const meeting = {
      code: 'fits-before-meeting', facts: { minutes: 30, gapEnd: '2026-11-29T08:00:00Z', meetingId: 'opaque' },
    } as const;
    expect(hyperFormatPlacementReason(meeting, 'en-US', 'Asia/Jerusalem')).toBe('Fits before the 10:00 meeting (30 min)');
    expect(hyperFormatPlacementReason(meeting, 'he-IL', 'Asia/Jerusalem')).toBe('אפשר לבצע לפני הפגישה בשעה 10:00 (30 דק׳)');
    expect(hyperFormatBlocker('waiting', { missingPredecessorIds: 'gone' }, 'en')).toBe('A required predecessor is missing');
    expect(hyperFormatBlocker('cycle', {}, 'he')).toBe('תלות מעגלית בין משימות');
    expect(hyperFormatPlacementReason({ code: 'earliest-fit', facts: { estimateMinutes: 45 } }, 'en')).toContain('~45 min (estimate)');
    expect(hyperFormatBlocker('no-window', { effortMinutes: 45, estimateMinutes: 45 }, 'en')).toContain('~45 min (estimate)');
  });

  it('shows signed rows, unknowns and a display-only rounding adjustment in both locales', () => {
    const rank: HyperHubRanked = {
      taskId: 'task', score: 2.01, scoreCents: 201, urgency: 0, importance: 0.33, pinned: false, feasibility: { ready: true },
      reasons: [{ signal: 'importance', points: 1.006, facts: { priority: 1 } }, { signal: 'age', points: 1.006, facts: { ageDays: 3 } }],
      unknown: ['slack'],
    };
    const options = { movedByOwner: true, placement: [{ code: 'owner-availability', facts: {} }] } as const;
    for (const locale of ['en', 'he'] as const) {
      const rows = hyperBuildWhyRows(rank, locale, options);
      expect(rows.map(row => row.kind)).toEqual(['contribution', 'contribution', 'unknown', 'rounding', 'override', 'placement']);
      expect(rows[0]).toMatchObject({ pointsCents: 101, signedPoints: '+1.01' });
      expect(rows[3]).toMatchObject({
        text: locale === 'he' ? 'התאמת עיגול' : 'Rounding adjustment', pointsCents: -1, signedPoints: '-0.01',
      });
      expect(rows.reduce((sum, row) => sum + ('pointsCents' in row ? row.pointsCents : 0), 0)).toBe(rank.scoreCents);
      expect(rows[2].text).toBe(locale === 'he' ? 'מרווח הזמן עד המועד אינו ידוע' : 'Slack is unknown');
      expect(rows[4].text).toBe(locale === 'he' ? 'שינית את הסדר' : 'Moved by you');
      expect(rows.every(row => !/[<>\u2066-\u2069]/u.test(row.text))).toBe(true);
    }
    expect(rank.reasons.map(reason => reason.points)).toEqual([1.006, 1.006]);
    const positive = hyperBuildWhyRows({ ...rank, scoreCents: 203 }, 'en');
    expect(positive[3]).toMatchObject({ kind: 'rounding', pointsCents: 1, signedPoints: '+0.01' });
  });

  it('names the next task, slot, duration and related meeting in English and Hebrew', () => {
    const fixture = HyperHubM2Fixture;
    const today = hyperSelectToday(fixture);
    const rec = today.recommendation!;
    const zone = fixture.settings.zone;
    expect(hyperFormatRecommendation(rec, 'en', { zone, agenda: today.agenda })).toContain('now');
    const time = (hhmm: string) => ({ kind: 'instant', iso: `2026-11-29T${hhmm}:00+02:00` } as const);
    const agenda: HyperHubAgendaItem[] = [{
      id: 'qa', interval: { start: time('11:00'), end: time('11:30') }, title: 'QA',
      availability: 'busy', sourceKind: 'outlook-calendar', allDay: false, private: false, isMeeting: true,
    }];
    const reasons: HyperHubPlacementReason[] = [{
      code: 'earliest-fit', facts: { minutes: 25, gapStart: time('10:15').iso, gapEnd: time('10:45').iso },
    }];
    const suggestion = {
      ...rec, kind: 'start-later' as const, start: time('10:15'), reasons,
      task: { ...rec.task, title: 'Review the release notes', meetingIds: ['qa'] },
      block: { ...rec.block, start: time('10:15'), end: time('10:40'), provisional: false, reasons },
    };
    expect(hyperFormatRecommendation(suggestion, 'en', { zone, agenda })).toBe(
      'Start with "Review the release notes" at 10:15, since this block takes 25 min, the next free slot is 10:15–10:45, and QA starts at 11:00.',
    );
    const he = hyperFormatRecommendation(suggestion, 'he-IL', { zone, agenda, provisional: true });
    expect(he).toContain('לפי התכנון הזמני');
    expect(he).toContain('בשעה 10:15');
    expect(he).toContain('25 דק׳');
    expect(he).toContain('10:15–10:45');
    expect(he).toContain('QA מתחילה בשעה 11:00');
    const estimated = {
      ...suggestion, reasons: [{ code: 'earliest-fit' as const, facts: { minutes: 25, estimateMinutes: 45 } }],
      block: { ...suggestion.block, provisional: true },
    };
    expect(hyperFormatRecommendation(estimated, 'en', { zone })).toMatch(/^In this provisional plan, .*~45 min \(estimate\)\.$/);
    const privateAgenda: HyperHubAgendaItem[] = [{
      id: 'qa', interval: agenda[0].interval, availability: 'busy',
      sourceKind: 'outlook-calendar', allDay: false, private: true, isMeeting: false,
    }];
    expect(hyperFormatRecommendation(suggestion, 'en', { zone, agenda: privateAgenda })).not.toContain('QA');
  });

  it('formats capacity in hours and minutes and labels provisional figures', () => {
    const capacity = { plannedMinutes: 240, freeMinutes: 330, unplacedMinutes: 45, provisional: false };
    expect(hyperFormatCapacity(capacity, 'en')).toBe('4 h planned of 5 h 30 min free');
    expect(hyperFormatCapacity({ ...capacity, provisional: true }, 'en')).toBe('4 h planned of 5 h 30 min free (provisional)');
    expect(hyperFormatCapacity({ ...capacity, provisional: true }, 'he')).toBe('4 שע׳ מתוכננות מתוך 5 שע׳ 30 דק׳ פנויות (תכנון זמני)');
  });

  it.each([
    ['waiting', { missingPredecessorIds: 'outside' }, 'A required predecessor is missing', 'חסרה משימה שצריכה להסתיים קודם'],
    ['cycle', {}, 'Circular task dependency', 'תלות מעגלית בין משימות'],
    ['no-window', { effortMinutes: 45 }, 'No slot today fits 45 min of work', 'אין היום חלון שמתאים ל-45 דקות עבודה'],
    ['fixed-conflict', { fixedStart: '2026-11-29T09:00:00+02:00' }, 'Fixed block at 09:00 conflicts with the plan', 'התנגשות בשריון הזמן בשעה 09:00'],
    ['no-coverage', {}, 'No availability data for a slot that fits', 'אין נתוני זמינות לחלון מתאים'],
  ] as const)('formats an overflow line for %s in each language', (code, facts, en, he) => {
    expect(hyperFormatOverflow({ code, facts }, 'en', 'Asia/Jerusalem')).toBe(en);
    expect(hyperFormatOverflow({ code, facts }, 'he', 'Asia/Jerusalem')).toBe(he);
  });
});
