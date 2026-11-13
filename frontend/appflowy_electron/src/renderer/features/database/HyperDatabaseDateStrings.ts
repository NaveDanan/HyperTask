import { useTr } from '@/i18n';
export const hyperDatabaseDateStrings = {
  start: 'Start date', end: 'End date', startTime: 'Start time', endTime: 'End time', includeTime: 'Include time', range: 'Date range',
  save: 'Save date', cancel: 'Cancel', clear: 'Clear date', empty: 'No date', timezone: 'Timezone', dateFormat: 'Date format', timeFormat: 'Time format',
  twelveHour: '12 hour', twentyFourHour: '24 hour', startOccurrence: 'Start time occurrence', endOccurrence: 'End time occurrence', earlier: 'Earlier', later: 'Later', chooseOccurrence: 'Choose occurrence',
  invalidDate: 'Enter a valid date.', invalidTime: 'Enter a valid time.', invalidZone: 'Enter a valid IANA timezone, such as Europe/London.',
  gap: 'This clock time does not exist in this timezone. Choose another time.', fold: 'This clock time occurs twice. Choose which occurrence to use.',
  endBeforeStart: 'The end must be on or after the start.', unsupported: 'This date uses settings this version cannot safely edit.',
  readOnly: 'This date is read-only.',
  reminder: 'This date has a reminder. Editing is unavailable until its notification schedule can be updated too.',
  filterZone: 'New date filters use the property timezone. Existing filters keep their saved timezone rule until explicitly changed.', systemZone: 'System timezone: {zone}',
  changed: 'This property changed. Reopen its settings before saving.', pending: 'Save or discard this property’s cell drafts before changing its date settings.',
} as const;
export function useHyperDatabaseDateText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperDatabaseDateStrings, args: Record<string, string> = {}) => {
    const key = `hyperDatabaseDate.${name}`, translated = tr(key, { namedArgs: args });
    return translated === key ? Object.entries(args).reduce<string>((value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement), hyperDatabaseDateStrings[name]) : translated;
  };
}
