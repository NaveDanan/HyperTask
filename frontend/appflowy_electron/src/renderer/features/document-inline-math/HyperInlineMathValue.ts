import type { HyperTextRun } from '../document/HyperDocumentModel';

// AppFlowy MentionBlockKeys.mentionChar and InlineMathEquationKeys.formula.
export const hyperInlineMathPlaceholder = '$';
// Keep the same UTF-16 source bound as HyperDocumentEquationMathML.
export const HYPER_INLINE_MATH_SOURCE_LIMIT = 8192;
export const HYPER_INLINE_MATH_ATOM_LIMIT = 64;
export type HyperInlineMathErrorReason = 'changed' | 'unsupported' | 'invalidPosition' | 'mixedAttributes' | 'sourceLimit' | 'atomLimit';
export class HyperInlineMathError extends Error {
  constructor(readonly reason: HyperInlineMathErrorReason) {
    super(reason === 'changed' ? 'The inline equation or its text changed. Select it again before saving.'
      : reason === 'invalidPosition' ? 'Select a complete text character for the inline equation.'
      : reason === 'mixedAttributes' ? 'Select text with matching formatting to preserve its attributes.'
      : reason === 'sourceLimit' ? 'Use an inline equation with at most 8,192 characters.'
      : reason === 'atomLimit' ? 'Use at most 64 inline equations in one text block.'
      : 'This inline equation has an unsupported format. Its source was kept.');
    this.name = 'HyperInlineMathError';
  }
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function hyperValidateInlineMathSource(formula: unknown): asserts formula is string {
  if (typeof formula !== 'string') throw new HyperInlineMathError('unsupported');
  if (formula.length > HYPER_INLINE_MATH_SOURCE_LIMIT) throw new HyperInlineMathError('sourceLimit');
}
/** These attributes already own an inline atom or an interaction. Do not choose
 * one interpretation and discard the other. Unrelated attributes remain opaque. */
export function hyperInlineMathConflictingAttributes(attributes: Record<string, unknown>): boolean {
  return ['mention', 'footnote', 'hyper_footnote', 'href'].some(key => attributes[key] !== null && attributes[key] !== undefined)
    || attributes.code !== null && attributes.code !== undefined && attributes.code !== false;
}
export interface HyperInlineMathRead {
  formula: string | null;
  raw: unknown;
  atomic: boolean;
  supported: boolean;
}
/** A merged run is several separate one-character atoms with the same formula.
 * Non-string/future formula payloads are inspectable without conversion. TeX
 * parsing belongs to the equation renderer, not inspection of persisted data. */
export function hyperReadInlineMath(run: HyperTextRun): HyperInlineMathRead | null {
  if (!record(run.attributes) || !Object.hasOwn(run.attributes, 'formula')) return null;
  const raw = run.attributes.formula, formula = typeof raw === 'string' ? raw : null;
  const atomic = typeof run.insert === 'string' && /^\$+$/u.test(run.insert);
  const knownRun = Object.keys(run).every(key => key === 'insert' || key === 'attributes');
  return { formula, raw, atomic, supported: atomic && knownRun && formula !== null && formula.length <= HYPER_INLINE_MATH_SOURCE_LIMIT && !hyperInlineMathConflictingAttributes(run.attributes) };
}
/** Bound editor materialization without expanding merged dollar runs. */
export function hyperInlineMathWithinAtomLimit(runs: HyperTextRun[]): boolean {
  let count = 0;
  for (const run of runs) if (hyperReadInlineMath(run)?.atomic) {
    count += (run.insert as string).length;
    if (count > HYPER_INLINE_MATH_ATOM_LIMIT) return false;
  }
  return true;
}
