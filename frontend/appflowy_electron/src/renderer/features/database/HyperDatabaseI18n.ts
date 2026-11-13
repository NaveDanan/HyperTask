import { useTr } from '@/i18n';
import strings from './HyperDatabase.en.json';

// English fallback allows the module to land independently of the shared translation files.
// The shared catalogue owns translations under hyperDatabase.
export function useHyperDatabaseText() {
  const { tr } = useTr();
  return (key: keyof typeof strings, args?: Record<string, string>) => {
    const fullKey = `hyperDatabase.${key}`;
    const value = tr(fullKey, { namedArgs: args });
    return value === fullKey ? Object.entries(args ?? {}).reduce((text, [name, replacement]) => text.replaceAll(`{${name}}`, replacement), strings[key]) : value;
  };
}
