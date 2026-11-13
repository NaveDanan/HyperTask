import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperRenderInlineEquationMathML } from '../document-equation/HyperDocumentEquationMathML';
import { HYPER_INLINE_MATH_ATOM_LIMIT, hyperInlineMathWithinAtomLimit, hyperReadInlineMath } from './HyperInlineMathValue';

export function hyperInlineMathAtomAt(runs: HyperTextRun[], ordinal: number) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) return null;
  let offset = 0;
  for (const run of runs) {
    if (hyperReadInlineMath(run)?.atomic) {
      const count = (run.insert as string).length;
      if (ordinal < count) return { offset: offset + ordinal, run };
      ordinal -= count;
    }
    offset += typeof run.insert === 'string' ? run.insert.length : 1;
  }
  return null;
}
export function hyperInlineMathMalformedAt(runs: HyperTextRun[]) {
  let offset = 0;
  for (const run of runs) { const read = hyperReadInlineMath(run); if (read && !read.atomic) return { offset, run }; offset += typeof run.insert === 'string' ? run.insert.length : 1; }
  return null;
}
/** Unknown operation fields cannot round-trip through contenteditable. Unknown
 * attributes can: each atom retains the complete attribute object. */
export function hyperInlineMathTextEditable(runs: HyperTextRun[]) {
  return hyperInlineMathWithinAtomLimit(runs) && runs.every(run => { const read = hyperReadInlineMath(run); return !read || read.atomic && Object.keys(run).every(key => key === 'insert' || key === 'attributes'); });
}
export function hyperInlineMathDomSource(runs: HyperTextRun[]): string {
  const normalized: HyperTextRun[] = [];
  const ordered = (value: unknown) => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  for (const run of runs) {
    const attributes = JSON.parse(ordered(run.attributes ?? {})), previous = normalized.at(-1);
    if (typeof previous?.insert === 'string' && typeof run.insert === 'string' && ordered(previous.attributes) === ordered(attributes)) previous.insert += run.insert;
    else normalized.push({ insert: run.insert, attributes });
  }
  return ordered(normalized);
}
export interface HyperInlineMathDomLabels { equation: string; empty: string; unsupported: string; overflow?: string }
export const hyperInlineMathPaintLimits = { atoms: HYPER_INLINE_MATH_ATOM_LIMIT, formulas: 8, source: 32 * 1024, markup: 256 * 1024, tags: 5000 } as const;
export const hyperInlineMathPaintBudget = () => ({ atoms: 0, source: 0, markup: 0, tags: 0, formulas: new Map<string, { html: string; error: string; tags: number }>() });
const defaultLabels: HyperInlineMathDomLabels = { equation: 'Inline equation', empty: 'Empty inline equation', unsupported: 'Unsupported inline equation', overflow: 'Inline previews are limited. The original text is kept.' };
export function hyperCreateInlineMathOverflow(runs: HyperTextRun[], labels: HyperInlineMathDomLabels = defaultLabels, malformed = false): HTMLElement {
  const group = document.createElement('span');
  group.dataset.hyperInlineMath = ''; if (malformed) group.dataset.hyperInlineMathMalformed = ''; else group.dataset.hyperInlineMathOverflow = '';
  group.dataset.hyperInlineMathRuns = JSON.stringify(runs);
  group.dataset.hyperInlineMathLength = String(runs.reduce((length, run) => length + (typeof run.insert === 'string' ? run.insert.length : 1), 0));
  group.dataset.hyperAtomic = '""'; group.contentEditable = 'false'; group.tabIndex = 0; group.setAttribute('role', 'button');
  const label = malformed ? labels.unsupported : labels.overflow ?? defaultLabels.overflow!;
  group.className = 'rounded-sm bg-muted px-1 font-mono text-sm'; group.setAttribute('aria-label', label);
  let preview = '';
  for (const run of runs) { preview += (typeof run.insert === 'string' ? run.insert : '\uFFFC').slice(0, 512 - preview.length); if (preview.length >= 512) break; }
  group.textContent = `${label} ${preview}`;
  return group;
}
export function hyperCreateInlineMathElements(run: HyperTextRun, labels: HyperInlineMathDomLabels = defaultLabels, budget = hyperInlineMathPaintBudget()): HTMLElement[] {
  const read = hyperReadInlineMath(run);
  if (!read) return [];
  if (!read.atomic) return [hyperCreateInlineMathOverflow([run], labels, true)];
  const count = (run.insert as string).length;
  if (count > hyperInlineMathPaintLimits.atoms - budget.atoms) return [hyperCreateInlineMathOverflow([run], labels)];
  budget.atoms += count;
  let html = '', error = '', tagCount = 0;
  if (read.supported && read.formula) {
    const formula = read.formula, cached = budget.formulas.get(formula);
    if (cached) ({ html, error, tags: tagCount } = cached);
    else if (budget.formulas.size < hyperInlineMathPaintLimits.formulas && formula.length <= hyperInlineMathPaintLimits.source - budget.source) {
      budget.source += formula.length;
      try { html = hyperRenderInlineEquationMathML(formula); } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
      tagCount = html ? html.match(/</gu)?.length ?? 0 : 0;
      budget.formulas.set(formula, { html, error, tags: tagCount });
    } else error = labels.overflow ?? defaultLabels.overflow!;
  }
  return Array.from(run.insert as string, () => {
    const paint = html && html.length <= hyperInlineMathPaintLimits.markup - budget.markup && tagCount <= hyperInlineMathPaintLimits.tags - budget.tags;
    if (paint) { budget.markup += html.length; budget.tags += tagCount; }
    const atom = document.createElement('span');
    atom.dataset.hyperInlineMath = ''; atom.dataset.hyperAtomic = JSON.stringify('$'); atom.dataset.hyperAttributes = JSON.stringify(run.attributes);
    atom.contentEditable = 'false'; atom.tabIndex = 0; atom.setAttribute('role', 'button');
    const a = run.attributes ?? {};
    atom.className = ['hyper-document-inline-equation cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring', a.bold && 'font-semibold', a.italic && 'italic', a.underline && 'underline', a.strikethrough && 'line-through'].filter(Boolean).join(' ');
    atom.setAttribute('aria-label', read.supported ? `${labels.equation}: ${(read.formula || labels.empty).slice(0, 256)}` : labels.unsupported);
    if (paint) atom.innerHTML = html;
    else { atom.textContent = read.formula ? read.formula.slice(0, 256) : read.supported ? labels.empty : labels.unsupported; atom.classList.add('bg-muted', 'px-1', 'font-mono', 'text-sm'); }
    if (error || !read.supported) { atom.dataset.hyperInlineMathUnsupported = ''; atom.title = error || 'This inline equation has unsupported data. Its source was kept.'; }
    else if (html && !paint) { atom.dataset.hyperInlineMathPreviewLimited = ''; atom.title = labels.overflow ?? defaultLabels.overflow!; }
    return atom;
  });
}
