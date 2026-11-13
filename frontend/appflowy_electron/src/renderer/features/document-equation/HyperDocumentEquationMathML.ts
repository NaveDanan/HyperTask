import katex from './vendor/katex-0.19.1/katex.mjs';

export const HYPER_EQUATION_SOURCE_LIMIT = 8192;
const cache = new Map<string, string>();
const supportedTags = new Set(['span', 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'mfrac', 'msqrt', 'mroot', 'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mstyle', 'mpadded', 'mphantom', 'mmultiscripts', 'mprescripts', 'none']);
let cachedBytes = 0;
function validateSource(formula: string) {
  if (typeof formula !== 'string' || formula.length > HYPER_EQUATION_SOURCE_LIMIT) throw new Error('Use an equation with at most 8,192 characters. The original source was kept.');
  let depth = 0;
  for (let i = 0; i < formula.length; i++) {
    if (formula[i] === '\\') { i++; continue; }
    if (formula[i] === '%') { while (i < formula.length && formula[i] !== '\n') i++; continue; }
    if (formula[i] === '{' && ++depth > 64) throw new Error('This equation is nested too deeply. The original source was kept.');
    if (formula[i] === '}') depth--;
  }
}
/** Trusted pinned parser output only. Raw formula and error strings never become HTML. */
function renderMathML(formula: string, displayMode: boolean): string {
  validateSource(formula);
  const key = `${displayMode ? 'block' : 'inline'}\0${formula}`;
  const cached = cache.get(key);
  if (cached !== undefined) { cache.delete(key); cache.set(key, cached); return cached; }
  let denied = false;
  const html = katex.renderToString(formula, {
    displayMode, output: 'mathml', strict: 'error', throwOnError: true,
    // Capture blocked commands even when KaTeX would display them as red unsupported text.
    trust: () => { denied = true; return false; }, maxExpand: 512, maxSize: 20, macros: Object.create(null) as Record<string, string>,
  });
  if (denied) throw new Error('Links, images and HTML commands are not supported in equations. The original source was kept.');
  // The parser can emit legacy MathML such as menclose that Chromium omits visually.
  for (const tag of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b/giu)) if (!supportedTags.has(tag[1].toLowerCase())) throw new Error(`This equation requires unsupported MathML (${tag[1]}). The original source was kept.`);
  if (html.length > 256 * 1024 || (html.match(/</gu)?.length ?? 0) > 10_000) throw new Error('This equation expands beyond the rendering limit. The original source was kept.');
  cache.set(key, html); cachedBytes += (key.length + html.length) * 2;
  while (cache.size > 32 || cachedBytes > 4 * 1024 * 1024) { const first = cache.keys().next().value!; cachedBytes -= (first.length + cache.get(first)!.length) * 2; cache.delete(first); }
  return html;
}
export const hyperRenderEquationMathML = (formula: string): string => renderMathML(formula, true);
export const hyperRenderInlineEquationMathML = (formula: string): string => renderMathML(formula, false);
