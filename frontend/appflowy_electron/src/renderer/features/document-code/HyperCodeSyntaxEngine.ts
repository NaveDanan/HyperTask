import highlighter from './vendor/highlightjs/lib/core.js';
import bash from './vendor/highlightjs/lib/languages/bash.js';
import css from './vendor/highlightjs/lib/languages/css.js';
import xml from './vendor/highlightjs/lib/languages/xml.js';
import javascript from './vendor/highlightjs/lib/languages/javascript.js';
import json from './vendor/highlightjs/lib/languages/json.js';
import markdown from './vendor/highlightjs/lib/languages/markdown.js';
import python from './vendor/highlightjs/lib/languages/python.js';
import rust from './vendor/highlightjs/lib/languages/rust.js';
import sql from './vendor/highlightjs/lib/languages/sql.js';
import typescript from './vendor/highlightjs/lib/languages/typescript.js';
import { hyperCodeSyntaxLanguage, hyperCodeSyntaxLanguages, hyperCodeSyntaxLimits, hyperCodeSyntaxSource, type HyperCodeSyntaxReply } from './HyperCodeSyntaxTypes';
// Static grammar registration only. No DOM highlighting APIs, dynamic loaders, themes or external resources.
for (const [name, grammar] of Object.entries({ bash, css, xml, javascript, json, markdown, python, rust, sql, typescript })) highlighter.registerLanguage(name, grammar);
export function hyperCodeSyntaxTokenize(source: unknown, rawLanguage: unknown, id: number): HyperCodeSyntaxReply {
  const plain: HyperCodeSyntaxReply = { version: 1, id, status: 'plain', html: '', language: null };
  if (!hyperCodeSyntaxSource(source) || rawLanguage !== null && typeof rawLanguage !== 'string') return plain;
  const language = hyperCodeSyntaxLanguage(rawLanguage); if (language === undefined || !source) return plain;
  try {
    const result = language === null ? highlighter.highlightAuto(source, [...hyperCodeSyntaxLanguages]) : highlighter.highlight(source, { language, ignoreIllegals: true });
    if (typeof result.value !== 'string' || result.value.length > hyperCodeSyntaxLimits.html) return plain;
    return { version: 1, id, status: 'ready', html: result.value, language: result.language ?? null };
  } catch { return plain; }
}
