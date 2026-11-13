import { useTr } from '@/i18n';
export const hyperCollectionStrings = {
  collections: 'Collections', create: 'New collection', name: 'Collection name', parent: 'Parent page', workspace: 'Workspace root',
  query: 'Page name or metadata contains', tag: 'Tag', match: 'Match property rules', all: 'All rules', any: 'Any rule',
  sort: 'Sort', edited: 'Recently edited', created: 'Recently created', nameSort: 'Name',
  addRule: 'Add property rule', removeRule: 'Remove rule', propertyKey: 'Property key', propertyName: 'Property name',
  propertyType: 'Property type', propertyValue: 'Property value', operator: 'Condition', text: 'Text', number: 'Number', date: 'Date', checkbox: 'Checkbox',
  exists: 'Has value', missing: 'Has no value', equals: 'Equals', contains: 'Contains', before: 'Before', after: 'After', gt: 'Greater than', lt: 'Less than',
  properties: 'Page properties', editProperties: 'Edit page properties', addProperty: 'Save property', removeProperty: 'Remove property',
  keyHelp: 'Use the same key on different pages to filter them together, for example priority or due_date.',
  unsupported: 'Some properties use an unsupported format. Their stored values are preserved.',
  empty: 'No pages match this collection', emptyHelp: 'Edit the saved rules or add matching properties to a page.', edit: 'Edit collection',
  save: 'Save', cancel: 'Cancel', error: 'Could not complete this action', readOnly: 'This page is read-only.',
  public: 'Public', private: 'Private', visibility: 'Visibility', removeDescription: 'This removes the property value from this page.',
  count: '{count} matching pages', refresh: 'Refresh collection', showMore: 'Show more', editProperty: 'Edit property', noProperties: 'This page has no custom properties.',
} as const;
export function useHyperCollectionText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperCollectionStrings, args?: Record<string, string | number>) => {
    const key = `hyperCollections.${name}`, translated = tr(key, { namedArgs: args });
    return translated === key ? Object.entries(args ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), hyperCollectionStrings[name] as string) : translated;
  };
}
