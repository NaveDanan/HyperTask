// Translation lookup with easy_localization semantics, reading the same JSON files the
// Flutter app uses (frontend/resources/translations). LocaleKeys.a_b in Dart is the
// dotted path "a.b" here.

export type Translations = Record<string, unknown>;

export interface TrOptions {
  /** Positional arguments, replacing each `{}` in order. */
  args?: (string | number)[];
  /** Named arguments, replacing `{name}`. */
  namedArgs?: Record<string, string | number>;
}

const LINK = /@(?:\.(upper|lower|capitalize))?:([\w\-|.]+)/g;

export class Translator {
  constructor(
    private readonly primary: Translations,
    private readonly fallback: Translations,
  ) {}

  tr(key: string, options: TrOptions = {}): string {
    const raw = this.lookup(key);
    if (typeof raw !== 'string') return key;
    return this.format(this.resolveLinks(raw), options);
  }

  /** easy_localization's plural(): picks zero/one/two/other by count and substitutes it for `{}`. */
  plural(key: string, count: number, options: TrOptions = {}): string {
    const group = this.lookup(key);
    if (typeof group === 'string') return this.format(this.resolveLinks(group), { ...options, args: [count] });
    if (!group || typeof group !== 'object') return key;
    const forms = group as Record<string, unknown>;
    const form =
      (count === 0 && forms.zero) || (count === 1 && forms.one) || (count === 2 && forms.two) || forms.other;
    if (typeof form !== 'string') return key;
    return this.format(this.resolveLinks(form), { args: [count], ...options });
  }

  private lookup(key: string): unknown {
    return resolvePath(this.primary, key) ?? resolvePath(this.fallback, key);
  }

  private resolveLinks(text: string, depth = 0): string {
    if (depth > 8) return text;
    return text.replace(LINK, (match, modifier: string | undefined, linkKey: string) => {
      const trimmed = linkKey.replace(/\.+$/, '');
      const trailing = linkKey.slice(trimmed.length);
      const value = this.lookup(trimmed);
      if (typeof value !== 'string') return match;
      let linked = this.resolveLinks(value, depth + 1);
      if (modifier === 'upper') linked = linked.toUpperCase();
      else if (modifier === 'lower') linked = linked.toLowerCase();
      else if (modifier === 'capitalize') linked = linked.charAt(0).toUpperCase() + linked.slice(1);
      return linked + trailing;
    });
  }

  private format(text: string, { args, namedArgs }: TrOptions): string {
    let result = text;
    if (namedArgs) {
      for (const [name, value] of Object.entries(namedArgs)) {
        result = result.split(`{${name}}`).join(String(value));
      }
    }
    if (args) {
      let index = 0;
      result = result.replace(/\{\}/g, (match) => (index < args.length ? String(args[index++]) : match));
    }
    return result;
  }
}

function resolvePath(source: Translations, key: string): unknown {
  if (key in source) return source[key];
  let node: unknown = source;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}
