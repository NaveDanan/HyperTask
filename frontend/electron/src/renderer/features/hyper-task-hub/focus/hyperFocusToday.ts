// Adapts Sol's hyperSelectToday + formatters to what the Focus view renders.
import type { HyperHubSnapshot } from '@shared/HyperTaskHub';
import { hyperFormatCapacity, hyperFormatRecommendation, type HyperHubReasonLocale } from '../state/HyperTaskHubReasons';
import { hyperSelectToday, type HyperHubFilters } from '../state/HyperTaskHubSelectors';
import type { HyperFocusToday } from './HyperFocusView';

const hyperFocusEmptyReasons: Record<'no-ready-task' | 'no-coverage' | 'nothing-fits', { en: string; he: string }> = {
  'no-ready-task': { en: 'Nothing is ready to start. Blocked, snoozed and waiting tasks are not recommended.', he: 'אין משימה מוכנה להתחלה. משימות חסומות, מושהות או ממתינות אינן מומלצות.' },
  'no-coverage': { en: 'Add a free window or connect your calendar so Task Hub can find a time.', he: 'הוסיפו חלון פנוי או חברו את היומן כדי ש-Task Hub ימצא זמן.' },
  'nothing-fits': { en: 'Nothing fits in the time left today. See what did not fit below.', he: 'שום משימה לא נכנסת בזמן שנותר היום. ראו למטה מה לא נכנס.' },
};

export function hyperFocusToday(snapshot: HyperHubSnapshot, filters: HyperHubFilters | undefined, locale: HyperHubReasonLocale): HyperFocusToday {
  const today = hyperSelectToday(snapshot, filters);
  const zone = snapshot.settings.zone;
  const language = locale.startsWith('he') ? 'he' : 'en';
  const recommendation = today.recommendation && {
    ...today.recommendation,
    text: hyperFormatRecommendation(today.recommendation, locale, { zone, agenda: today.agenda, provisional: today.coverage === 'provisional' }),
  };
  return {
    recommendation,
    emptyReason: today.recommendationReason ? hyperFocusEmptyReasons[today.recommendationReason][language] : undefined,
    blocks: today.blocks,
    agenda: today.agenda,
    capacity: { ...today.capacity, text: hyperFormatCapacity(today.capacity, locale) },
    unscheduled: today.unscheduled,
    coverage: today.coverage,
    needsOwnerWindow: today.needsOwnerWindow,
  };
}
