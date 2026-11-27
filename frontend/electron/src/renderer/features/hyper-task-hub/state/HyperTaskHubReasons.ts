import type { HyperMeetingBriefReason } from '@shared/HyperMeetingBrief';
import type {
  HyperHubAgendaItem, HyperHubBlockerCode, HyperHubFacts, HyperHubPlacementReason, HyperHubRanked, HyperHubRankReason,
  HyperHubSignal, HyperHubUnscheduled, HyperHubWriteView,
} from '@shared/HyperTaskHub';
import type { HyperHubMatrixReason, HyperHubTodayCapacity, HyperHubTodayRecommendation } from './HyperTaskHubSelectors';

export type HyperHubReasonLocale = 'en' | 'he' | `en-${string}` | `he-${string}`;

export type HyperHubWhyRow =
  | { kind: 'contribution'; signal: HyperHubSignal; text: string; pointsCents: number; signedPoints: string }
  | { kind: 'unknown'; signal: HyperHubSignal; text: string }
  | { kind: 'rounding'; text: string; pointsCents: number; signedPoints: string }
  | { kind: 'override' | 'placement'; text: string };

export interface HyperHubWhyOptions {
  movedByOwner?: boolean;
  placement?: readonly HyperHubPlacementReason[];
  zone?: string;
}

export interface HyperHubRecommendationOptions {
  zone?: string;
  agenda?: readonly HyperHubAgendaItem[];
  provisional?: boolean;
}

const unknownText = {
  en: {
    slack: 'Slack is unknown',
    importance: 'Importance is unknown',
    unblocking: 'The number of tasks this unblocks is unknown',
    age: 'Task age is unknown',
  },
  he: {
    slack: 'מרווח הזמן עד המועד אינו ידוע',
    importance: 'מידת החשיבות אינה ידועה',
    unblocking: 'לא ידוע כמה משימות תלויות במשימה זו',
    age: 'גיל המשימה אינו ידוע',
  },
};

function language(locale: HyperHubReasonLocale): 'en' | 'he' {
  return locale.startsWith('he') ? 'he' : 'en';
}

function numberFact(facts: HyperHubFacts, key: string): number | undefined {
  const value = facts[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatNumber(value: number, locale: HyperHubReasonLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function formatTime(value: string | number | undefined, locale: HyperHubReasonLocale, zone?: string): string | undefined {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone ?? 'UTC',
  }).format(time) : undefined;
}

function formatDuration(minutes: number, locale: HyperHubReasonLocale): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  const he = language(locale) === 'he';
  const hourText = `${formatNumber(hours, locale)} ${he ? 'שע׳' : 'h'}`;
  const minuteText = `${formatNumber(remainder, locale)} ${he ? 'דק׳' : 'min'}`;
  if (!hours) return minuteText;
  return remainder ? `${hourText} ${minuteText}` : hourText;
}

export function hyperFormatRecommendation(
  { task, kind, start, block, reasons }: HyperHubTodayRecommendation,
  locale: HyperHubReasonLocale,
  { zone, agenda = [], provisional = false }: HyperHubRecommendationOptions = {},
): string {
  const he = language(locale) === 'he';
  const time = (value: string | number | undefined) => formatTime(value, locale, zone);
  const placement = reasons.find(reason =>
    reason.code === 'fits-before-meeting' || reason.code === 'earliest-fit' || reason.code === 'fixed-block');
  const facts = placement?.facts ?? {};
  const blockMinutes = (Date.parse(block.end.iso) - Date.parse(start.iso)) / 60_000;
  const minutes = numberFact(facts, 'minutes') ?? blockMinutes;
  const estimate = numberFact(facts, 'estimateMinutes');
  const duration = formatDuration(estimate ?? minutes, locale);
  const timing = kind === 'start-now' ? (he ? ' עכשיו' : ' now') : (he ? ` בשעה ${time(start.iso)}` : ` at ${time(start.iso)}`);
  const detail = [estimate === undefined
    ? (he ? `משך העבודה בחלון הזה הוא ${duration}` : `this block takes ${duration}`)
    : (he ? `זמן העבודה המשוער הוא כ-${duration}` : `the work takes ~${duration} (estimate)`)];

  const gapStart = time(facts.gapStart);
  const gapEnd = time(facts.gapEnd);
  if (gapStart && gapEnd && !block.fixed) {
    detail.push(he ? `החלון הפנוי הוא \u2066${gapStart}–${gapEnd}\u2069` : `the next free slot is ${gapStart}–${gapEnd}`);
  }

  const meeting = agenda.find(event => event.id === facts.meetingId && !event.private && event.isMeeting) ??
    agenda.find(event => !event.private && event.isMeeting && task.meetingIds.includes(event.id) &&
      Date.parse(event.interval.start.iso) >= Date.parse(block.end.iso));
  const meetingTime = time(meeting?.interval.start.iso ?? (placement?.code === 'fits-before-meeting' ? facts.gapEnd : undefined));
  if (meetingTime) {
    const title = meeting?.title?.trim();
    const label = title || (he ? 'הפגישה' : 'the meeting');
    detail.push(he ? `${label} מתחילה בשעה ${meetingTime}` : `${label} starts at ${meetingTime}`);
  }
  const explanation = new Intl.ListFormat(locale).format(detail);
  const tentative = provisional || block.provisional;
  if (he) return `${tentative ? 'לפי התכנון הזמני, ' : ''}כדאי להתחיל ב״${task.title}״${timing}, כי ${explanation}.`;
  return `${tentative ? 'In this provisional plan, start' : 'Start'} with "${task.title}"${timing}, since ${explanation}.`;
}

export function hyperFormatCapacity(
  { plannedMinutes, freeMinutes, provisional }: HyperHubTodayCapacity,
  locale: HyperHubReasonLocale,
): string {
  const planned = formatDuration(plannedMinutes, locale);
  const free = formatDuration(freeMinutes, locale);
  if (language(locale) === 'he') return `${planned} מתוכננות מתוך ${free} פנויות${provisional ? ' (תכנון זמני)' : ''}`;
  return `${planned} planned of ${free} free${provisional ? ' (provisional)' : ''}`;
}

export function hyperFormatOverflow(
  { code, facts }: Pick<HyperHubUnscheduled, 'code' | 'facts'>,
  locale: HyperHubReasonLocale,
  zone?: string,
): string {
  if (code === 'no-coverage') return language(locale) === 'he' ? 'אין נתוני זמינות לחלון מתאים' : 'No availability data for a slot that fits';
  return hyperFormatBlocker(code, facts, locale, zone);
}

export function hyperFormatBriefReason(reason: HyperMeetingBriefReason, locale: HyperHubReasonLocale): string {
  const he = language(locale) === 'he';
  switch (reason.code) {
    case 'accepted-meeting': return he ? 'אישרת השתתפות בפגישה' : 'You accepted this meeting';
    case 'owner-organized': return he ? 'ארגנת את הפגישה' : 'You organized this meeting';
    case 'manual-link': return he ? 'קישרת לפגישה' : 'Linked by you';
    case 'jira-key': return he ? `כולל אזכור של ${reason.facts.key}` : `Mentions ${reason.facts.key}`;
    case 'document-link': return he ? 'קישור למסמך משותף' : 'Links to the same document';
    case 'series-history': {
      const { ageDays } = reason.facts;
      const weeks = ageDays >= 7 && ageDays % 7 === 0;
      const age = he && ageDays === 14 ? 'לפני שבועיים' : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
        .format(weeks ? -ageDays / 7 : -ageDays, weeks ? 'week' : 'day');
      return he ? `מאותה סדרת פגישות, ${age}` : `Same series, ${age}`;
    }
    case 'subject-terms': {
      const terms = new Intl.ListFormat(locale).format(reason.facts.terms);
      return he ? `נושא ההודעה כולל את המונחים ${terms}` : `Matches ${terms} in the subject`;
    }
    case 'meeting-person': return he ? `קשור לפגישה דרך ${reason.facts.name}` : `Involves ${reason.facts.name}`;
    case 'recent': return he ? 'מהשבוע האחרון' : 'From the past 7 days';
    case 'shared-project': return he ? 'מאותו פרויקט' : 'Same project';
  }
}

export function hyperFormatRankReason(reason: HyperHubRankReason, locale: HyperHubReasonLocale, zone?: string): string {
  const { facts } = reason;
  const he = language(locale) === 'he';
  switch (reason.signal) {
    case 'slack': {
      const slack = numberFact(facts, 'slackMinutes');
      const dueIn = numberFact(facts, 'minutesUntilDue');
      if (slack !== undefined) {
        const amount = formatNumber(Math.abs(slack), locale);
        if (slack < 0) return he ? `חסרות ${amount} דקות עבודה עד המועד` : `${amount} working min short of the time needed`;
        return he ? `${amount} דקות פנויות מעבר לזמן הנדרש` : `${amount} working min to spare before the deadline`;
      }
      if (dueIn !== undefined && dueIn <= 0) return he ? 'המועד כבר הגיע' : 'The deadline has been reached';
      const due = formatTime(facts.deadline, locale, zone);
      return due ? (he ? `המועד הוא ${due}` : `Due at ${due}`) : (he ? 'דחיפות לפי המועד' : 'Deadline urgency');
    }
    case 'importance': {
      const jira = facts.source === 'jira-priority' || facts.origin === 'jira';
      const priority = numberFact(facts, 'priority');
      const levels = he ? ['נמוכה', 'רגילה', 'גבוהה', 'גבוהה מאוד'] : ['low', 'normal', 'high', 'highest'];
      const level = priority === undefined ? undefined : levels[priority];
      if (he) return jira ? `חשיבות לפי העדיפות ב-Jira${level ? ` (${level})` : ''}` : `חשיבות שקבעת${level ? ` (${level})` : ''}`;
      return jira ? `Importance from Jira priority${level ? ` (${level})` : ''}` : `Your importance setting${level ? ` (${level})` : ''}`;
    }
    case 'unblocking': {
      const successors = numberFact(facts, 'successors') ?? numberFact(facts, 'verifiedOpenSuccessors');
      if (!successors) return he ? 'אין משימות פתוחות שתלויות בה' : 'No open tasks depend on this';
      const count = formatNumber(successors, locale);
      if (successors === 1) return he ? 'משימה פתוחה אחת תלויה בה' : 'Unblocks 1 open task';
      return he ? `${count} משימות פתוחות תלויות בה` : `Unblocks ${count} open tasks`;
    }
    case 'age': {
      const age = numberFact(facts, 'ageDays') ?? numberFact(facts, 'daysSinceCreatedOrFirstSeen');
      if (age === undefined) return he ? 'גיל המשימה' : 'Task age';
      const days = formatNumber(Math.max(0, age), locale);
      return he ? `גיל המשימה הוא ${days} ימים` : `Task age is ${days} ${age === 1 ? 'day' : 'days'}`;
    }
  }
}

export function hyperFormatBlocker(code: HyperHubBlockerCode, facts: HyperHubFacts, locale: HyperHubReasonLocale, zone?: string): string {
  const he = language(locale) === 'he';
  switch (code) {
    case 'waiting': {
      if (facts.held) return he ? 'ממתינה לאישור מהמקור' : 'Waiting for the source to confirm';
      if (facts.completion === 'complete') return he ? 'המשימה הושלמה במקור' : 'Completed at the source';
      if (facts.missingPredecessorIds) return he ? 'חסרה משימה שצריכה להסתיים קודם' : 'A required predecessor is missing';
      if (facts.predecessorId || facts.predecessorIds) return he ? 'ממתינה להשלמת משימה קודמת' : 'Waiting for a predecessor to finish';
      const until = formatTime(facts.until, locale, zone);
      if (until) return he ? `ממתינה עד ${until}` : `Waiting until ${until}`;
      if (facts.state === 'review') return he ? 'ממתינה למיון' : 'Waiting for triage';
      if (facts.state === 'done') return he ? 'המשימה סומנה כהושלמה' : 'Marked done';
      if (facts.state === 'dismissed') return he ? 'המשימה נדחתה' : 'Dismissed';
      return he ? 'ממתינה' : 'Waiting';
    }
    case 'cycle':
      return he ? 'תלות מעגלית בין משימות' : 'Circular task dependency';
    case 'no-window': {
      const effort = numberFact(facts, 'effortMinutes');
      if (effort === undefined) return he ? 'אין חלון זמן מתאים היום' : 'No available slot today';
      const minutes = formatNumber(effort, locale);
      if (numberFact(facts, 'estimateMinutes') !== undefined) return he
        ? `אין היום חלון שמתאים לכ-${minutes} דק׳ עבודה לפי ההערכה` : `No slot today fits ~${minutes} min (estimate)`;
      return he ? `אין היום חלון שמתאים ל-${minutes} דקות עבודה` : `No slot today fits ${minutes} min of work`;
    }
    case 'fixed-conflict': {
      const start = formatTime(facts.fixedStart, locale, zone);
      return he ? `התנגשות בשריון הזמן${start ? ` בשעה ${start}` : ''}` : `Fixed block${start ? ` at ${start}` : ''} conflicts with the plan`;
    }
    case 'no-coverage':
      return he ? 'אין מידע על הזמינות. אפשר להגדיר חלון פנוי.' : 'Availability is unknown. Add a window when you’re free.';
  }
}

const matrixMissing = {
  en: {
    effort: 'Effort needed to calculate urgency',
    coverage: 'Availability needed to calculate urgency',
    deadline: 'A deadline is needed to calculate urgency',
    priority: 'Priority needed to determine importance',
    unknown: 'Urgency is unknown',
  },
  he: {
    effort: 'נדרשת הערכת מאמץ לחישוב הדחיפות',
    coverage: 'נדרשים נתוני זמינות לחישוב הדחיפות',
    deadline: 'נדרש מועד יעד לחישוב הדחיפות',
    priority: 'נדרשת עדיפות לקביעת החשיבות',
    unknown: 'מידת הדחיפות אינה ידועה',
  },
};

export function hyperFormatMatrixReason(reason: HyperHubMatrixReason, locale: HyperHubReasonLocale): string {
  const lang = language(locale);
  const he = lang === 'he';
  if (reason.kind === 'override') return he ? 'שינית את המיקום' : 'Moved by you';
  if (reason.kind === 'missing') return matrixMissing[lang][reason.detail];
  const axis = reason.axis === 'urgency' ? (he ? 'דחיפות' : 'Urgency') : (he ? 'חשיבות' : 'Importance');
  const value = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(reason.value);
  const explanation = reason.reason && hyperFormatRankReason(reason.reason, locale);
  const provisional = reason.provisional ? (he ? ' (זמני)' : ' (provisional)') : '';
  return `${axis} ${value}${provisional}${explanation ? `. ${explanation}` : ''}`;
}

export function hyperFormatHeld(write: HyperHubWriteView, locale: HyperHubReasonLocale): string | null {
  const source = write.source === 'jira' ? 'Jira' : 'Newsletter';
  const he = language(locale) === 'he';
  if (write.ownerReleasedAt) {
    return he ? `שחררת את המשימה. האישור מ-${source} עדיין בהמתנה` : `Released by you. Confirmation from ${source} is still pending.`;
  }
  if (write.held && write.state === 'pending') return he ? `מתבצע עדכון ב-${source}…` : `Updating ${source}…`;
  if (write.held) return he ? `ממתינה לאישור מ-${source}` : `Waiting for ${source} to confirm`;
  return null;
}

export function hyperFormatPlacementReason(
  { code, facts }: HyperHubPlacementReason,
  locale: HyperHubReasonLocale,
  zone?: string,
): string {
  const he = language(locale) === 'he';
  const minutes = numberFact(facts, 'minutes');
  const estimate = numberFact(facts, 'estimateMinutes');
  switch (code) {
    case 'earliest-fit':
    case 'fits-before-meeting':
    case 'fixed-block': {
      const meetingTime = formatTime(facts.gapEnd, locale, zone);
      let text: string;
      if (code === 'fixed-block') text = he ? 'זמן ששריינת' : 'Time you reserved';
      else if (code === 'fits-before-meeting') text = he
        ? `אפשר לבצע לפני הפגישה${meetingTime ? ` בשעה ${meetingTime}` : ''}`
        : `Fits before ${meetingTime ? `the ${meetingTime} meeting` : 'the meeting'}`;
      else text = he ? 'חלון הזמן הראשון שמתאים' : 'Earliest available slot';
      if (estimate !== undefined) {
        const duration = formatNumber(estimate, locale);
        return he ? `${text}. כ-${duration} דק׳ (הערכה)` : `${text}. ~${duration} min (estimate)`;
      }
      if (minutes === undefined) return text;
      return he ? `${text} (${formatNumber(minutes, locale)} דק׳)` : `${text} (${formatNumber(minutes, locale)} min)`;
    }
    case 'after-predecessor':
      return he ? 'מתוכננת לאחר סיום המשימה הקודמת' : 'Scheduled after the predecessor’s block';
    case 'late': {
      const late = numberFact(facts, 'lateMinutes');
      if (late === undefined) return he ? 'מתוכננת להסתיים אחרי המועד' : 'Scheduled to finish after the deadline';
      const duration = formatNumber(late, locale);
      return he ? `מתוכננת להסתיים ${duration} דקות אחרי המועד` : `Scheduled to finish ${duration} min after the deadline`;
    }
    case 'owner-availability':
      return he ? 'מבוסס על חלון פנוי שהגדרת' : 'Uses a window you marked free';
    case 'stale-coverage':
      return he ? 'מבוסס על מידע מלוח השנה שטרם רוענן' : 'Uses availability from an earlier calendar refresh';
    default:
      return hyperFormatBlocker(code, facts, locale, zone);
  }
}

export function hyperBuildWhyRows(
  rank: HyperHubRanked,
  locale: HyperHubReasonLocale,
  { movedByOwner, placement = [], zone }: HyperHubWhyOptions = {},
): HyperHubWhyRow[] {
  const lang = language(locale);
  const he = lang === 'he';
  const signed = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
  // Keep text plain. Intl may include direction marks in some locales, which the UI handles around numbers.
  const signedPoints = (cents: number) => signed.format(cents / 100).replace(/[\u061c\u200e\u200f]/g, '');
  let displayedCents = 0;
  const rows: HyperHubWhyRow[] = rank.reasons.map(reason => {
    const pointsCents = Math.round(reason.points * 100) || 0;
    displayedCents += pointsCents;
    let text = hyperFormatRankReason(reason, locale, zone);
    if (reason.signal === 'slack' && rank.provisionalSlack) text += he ? ' (זמני)' : ' (provisional)';
    return { kind: 'contribution', signal: reason.signal, text, pointsCents, signedPoints: signedPoints(pointsCents) };
  });
  for (const signal of rank.unknown) rows.push({ kind: 'unknown', signal, text: unknownText[lang][signal] });
  const difference = rank.scoreCents - displayedCents;
  if (difference !== 0) rows.push({
    kind: 'rounding', text: he ? 'התאמת עיגול' : 'Rounding adjustment',
    pointsCents: difference, signedPoints: signedPoints(difference),
  });
  if (movedByOwner) rows.push({ kind: 'override', text: he ? 'שינית את הסדר' : 'Moved by you' });
  for (const reason of placement) rows.push({ kind: 'placement', text: hyperFormatPlacementReason(reason, locale, zone) });
  return rows;
}
