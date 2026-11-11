import { useTr } from '@/i18n';
export const hyperDatabaseFilterGroupStrings = {
  title: 'Filter groups', group: 'Group', match: 'Group match', all: 'Match all', any: 'Match any', add: 'Add criterion',
  help: 'Adding a criterion to a property filter creates a Match all group and keeps the original condition. You can then choose Match any.',
  empty: 'Add a property filter to start a group.',
  unsupported: 'Some filter data is unsupported. It was kept unchanged; group changes are read-only.',
  changed: 'The filter group or its properties changed. Reopen it before saving.',
  unavailable: 'This page is read-only or unavailable.',
  capacity: 'Group editing supports up to 128 filters, three group levels and 64 KiB of criteria. Existing filters were kept.',
  uncertain: 'The filter change could not be confirmed. Existing data was kept. Refresh and inspect filters before another action.',
  recoveryHelp: 'Refresh reads the saved filters. Dismiss only forgets these recovery details; it does not repeat or undo the change. Copy details before leaving this page.',
  copy: 'Copy change details', refresh: 'Refresh filters', dismiss: 'Dismiss recovery', copyFailed: 'The change details could not be copied.',
} as const;
export function useHyperDatabaseFilterGroupText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperDatabaseFilterGroupStrings) => { const key = `hyperDatabaseFilterGroup.${name}`, translated = tr(key); return translated === key ? hyperDatabaseFilterGroupStrings[name] : translated; };
}
