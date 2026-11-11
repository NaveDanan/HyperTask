import { useTr } from '@/i18n';
export const hyperDatabaseDateFilterStrings = {
  title: 'Date filters', field: 'Date property', operator: 'Date condition', day: 'Date', start: 'From date', end: 'Through date', add: 'Add date filter', edit: 'Edit date filter', save: 'Save filter', cancel: 'Cancel',
  remove: 'Remove date filter', legacy: 'Uses the legacy system-timezone rule.', property: 'Uses the property timezone: {zone}.', optIn: 'Use property timezone',
  edited: 'Saving this edit will use the property timezone. Selected dates stay as shown.', unsupported: 'This filter uses settings this version cannot safely edit.', changed: 'This filter or property changed. Reopen it before saving.',
  unavailable: 'This page is read-only or no longer available to this account.',
  systemOnly: 'Uses the system timezone. This timestamp has no range.',
  invalidDate: 'Enter a valid date.', endBeforeStart: 'The end must be on or after the start.', noProperty: 'Choose a date property.',
  endFallback: 'For dates without a range, end conditions use the start date.',
  startOn: 'Start is on', startBefore: 'Start is before', startAfter: 'Start is after', startOnOrBefore: 'Start is on or before', startOnOrAfter: 'Start is on or after', startBetween: 'Start is between', startEmpty: 'Start is empty', startNotEmpty: 'Start is not empty',
  endOn: 'End is on', endBefore: 'End is before', endAfter: 'End is after', endOnOrBefore: 'End is on or before', endOnOrAfter: 'End is on or after', endBetween: 'End is between', endEmpty: 'End is empty', endNotEmpty: 'End is not empty',
} as const;
export function useHyperDatabaseDateFilterText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperDatabaseDateFilterStrings, args: Record<string, string> = {}) => {
    const key = `hyperDatabaseDateFilter.${name}`, translated = tr(key, { namedArgs: args });
    return translated === key ? Object.entries(args).reduce<string>((value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement), hyperDatabaseDateFilterStrings[name]) : translated;
  };
}
