import { useTr } from '@/i18n';
export const hyperDatabaseFilterStrings = {
  title: 'Property filters', field: 'Filter property', operator: 'Filter condition', value: 'Filter value', add: 'Add property filter', edit: 'Edit property filter', save: 'Save filter', cancel: 'Cancel', remove: 'Remove filter', noProperty: 'Choose a property.',
  empty: 'No property filters.', groups: 'Filter groups', allGroup: 'Match all', anyGroup: 'Match any', unsupported: 'This filter uses settings this version cannot safely edit.', changed: 'This filter or property changed. Reopen it before saving.', unavailable: 'This page is read-only or no longer available to this account.',
  searchProperties: 'Search filter properties', properties: 'Filter properties', searchOptions: 'Search filter options', options: 'Filter options', noOptions: 'No matching options.', missingOption: 'Unavailable option: {id}', selected: '{count} selected', selectValue: 'Select at least one option.', invalidNumber: 'Enter a decimal with at most 28 fractional digits and a value the number field can store.',
  textHelp: 'Text comparisons ignore case. A blank comparison value matches every row.', timeHelp: 'Enter whole minutes, for example 90 for 1h 30m.', timeValue: '{value} min', invalidTime: 'Enter whole minutes within the supported range.', selectHelp: 'Positive conditions match any selected option. Negative conditions exclude every selected option.', checklistHelp: 'An empty checklist is incomplete.',
  textIs: 'Is', textIsNot: 'Is not', contains: 'Contains', doesNotContain: 'Does not contain', startsWith: 'Starts with', endsWith: 'Ends with', emptyValue: 'Is empty', notEmpty: 'Is not empty',
  equal: 'Equals', notEqual: 'Does not equal', greater: 'Is greater than', less: 'Is less than', atLeast: 'Is greater than or equal to', atMost: 'Is less than or equal to', checked: 'Is checked', unchecked: 'Is unchecked', complete: 'Is complete', incomplete: 'Is incomplete',
} as const;
export function useHyperDatabaseFilterText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperDatabaseFilterStrings, args: Record<string, string | number> = {}) => {
    const key = `hyperDatabaseFilter.${name}`, translated = tr(key, { namedArgs: args });
    return translated === key ? Object.entries(args).reduce<string>((value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)), hyperDatabaseFilterStrings[name]) : translated;
  };
}
