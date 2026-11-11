import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperRenderInlineEquationMathML } from '../document-equation/HyperDocumentEquationMathML';
import { hyperReadInlineMath } from './HyperInlineMathValue';
import { hyperDocumentColorCss } from '../document-format/HyperDocumentColor';
import { HYPER_INLINE_MATH_MARKER, hyperInlineMathPortableMarker, hyperInlineMathReadableSource } from './HyperInlineMathPortable';

export const HYPER_INLINE_MATH_EXPORT_ATOMS = 2048;
export const HYPER_INLINE_MATH_EXPORT_BYTES = 8 * 1024 * 1024;
export interface HyperInlineMathExportBudget { atoms: number; bytes: number }

/** HTML/PDF renders trusted MathML. Markdown carries portable source markup and
 * remains readable in renderers that support ordinary inline HTML. */
export function hyperExportInlineMath(run: HyperTextRun, html: boolean, budget: HyperInlineMathExportBudget = { atoms: 0, bytes: 0 }): string | null {
  const read = hyperReadInlineMath(run); if (!read) return null;
  const count = typeof run.insert === 'string' ? run.insert.length : 1;
  if (count > HYPER_INLINE_MATH_EXPORT_ATOMS - budget.atoms) throw new Error('This page has too many inline equations for one export. Split it into smaller pages.');
  const marker = hyperInlineMathPortableMarker(run), formula = read.formula!;
  const content = html ? hyperRenderInlineEquationMathML(formula) : hyperInlineMathReadableSource(formula);
  const attributes = run.attributes ?? {}, foreground = hyperDocumentColorCss(attributes.font_color), background = hyperDocumentColorCss(attributes.bg_color);
  const decoration = [attributes.underline && 'underline', attributes.strikethrough && 'line-through'].filter(Boolean).join(' ');
  const style = [attributes.bold && 'font-weight:700', attributes.italic && 'font-style:italic', decoration && `text-decoration:${decoration}`, foreground && `color:${foreground}`, background && `background-color:${background}`].filter(Boolean).join(';');
  const single = html
    ? `<span class="hyper-document-inline-equation"${style ? ` style="${style}"` : ''} ${HYPER_INLINE_MATH_MARKER}="${marker}">${content}</span>`
    : `<span ${HYPER_INLINE_MATH_MARKER}="${marker}">${content}</span>`;
  const bytes = new TextEncoder().encode(single).length * count;
  if (bytes > HYPER_INLINE_MATH_EXPORT_BYTES - budget.bytes) throw new Error('The inline equations are too large for one portable export. Split the page before exporting.');
  budget.atoms += count; budget.bytes += bytes;
  return single.repeat(count);
}
