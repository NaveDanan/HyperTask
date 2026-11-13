import type { BlockPB } from '@shared/protobuf/flowy-document/entities_pb';
export type HyperCodeLanguage = string | null;
export function hyperCodeLanguageSnapshot(block: Pick<BlockPB, 'data'>): { present: boolean; value: unknown } {
  const data: unknown = JSON.parse(block.data || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('This code block has an unsupported data format. Its source was kept.');
  const present = Object.hasOwn(data, 'language'), value = present ? (data as Record<string, unknown>).language : null;
  return { present, value };
}
export function hyperCodeLanguage(block: Pick<BlockPB, 'data'>): { present: boolean; value: HyperCodeLanguage } {
  const { present, value } = hyperCodeLanguageSnapshot(block);
  if (value !== null && typeof value !== 'string') throw Error('This code language has an unsupported format. Its source was kept.');
  return { present, value };
}
export function hyperValidateCodeLanguage(value: HyperCodeLanguage): HyperCodeLanguage {
  if (value !== null && (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value))) throw Error('Use a language tag of at most 256 characters without control characters.');
  return value;
}
export function hyperCodeLanguageMarker(block: Pick<BlockPB, 'data'>): string {
  const language = hyperCodeLanguage(block), value = JSON.stringify({ version: 1, present: language.present, ...(language.present ? { value: language.value } : {}) });
  if (value.length > 8192) throw Error('The stored code language is too large for HTML export. Copy its source instead.');
  return value;
}
export function hyperParseCodeLanguageMarker(raw: string): Record<string, unknown> | null {
  try {
    if (raw.length > 8192) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.present !== 'boolean' || Object.keys(value).some(key => !['version', 'present', 'value'].includes(key))) return null;
    if (!value.present) return Object.hasOwn(value, 'value') ? null : {};
    return value.value === null || typeof value.value === 'string' ? { language: value.value } : null;
  } catch { return null; }
}
export function hyperCodeHtmlLanguage(block: Pick<BlockPB, 'data'>): string | null {
  const language = hyperCodeLanguage(block).value;
  return typeof language === 'string' && /^[A-Za-z0-9_+-]{1,128}$/u.test(language) ? language : null;
}
export function hyperCodeMarkdownLanguage(block: Pick<BlockPB, 'data'>): string {
  const language = hyperCodeLanguage(block).value;
  if (language === null || language === '') return '';
  if (!/^[A-Za-z0-9_+-]+$/u.test(language)) throw Error('This code language cannot be represented by the Markdown importer. Export HTML to keep the exact language tag.');
  return language;
}
