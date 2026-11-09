import { describe, expect, it } from 'vitest';
import en from '@resources/translations/en-US.json';
import { Translator } from './translator';

describe('Translator', () => {
  const t = new Translator(
    { hello: 'Hallo {}', nested: { name: 'Name {name}' } },
    { appName: 'AppFlowy', title: 'Login to @:appName', count: { one: '{} item', other: '{} items' }, missing: 'fallback' },
  );

  it('resolves dotted keys, positional and named arguments', () => {
    expect(t.tr('hello', { args: ['Welt'] })).toBe('Hallo Welt');
    expect(t.tr('nested.name', { namedArgs: { name: 'X' } })).toBe('Name X');
  });

  it('falls back to the fallback locale, then to the key', () => {
    expect(t.tr('missing')).toBe('fallback');
    expect(t.tr('no.such.key')).toBe('no.such.key');
  });

  it('expands @: links', () => {
    expect(t.tr('title')).toBe('Login to AppFlowy');
  });

  it('selects plural forms', () => {
    expect(t.plural('count', 1)).toBe('1 item');
    expect(t.plural('count', 5)).toBe('5 items');
  });

  it('reads the real en-US file the Flutter app uses', () => {
    const real = new Translator(en, en);
    expect(real.tr('signIn.loginTitle')).toBe('Login to HyperTask');
  });
});
