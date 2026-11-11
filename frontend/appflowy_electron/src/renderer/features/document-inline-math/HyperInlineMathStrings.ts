import { useTr } from '@/i18n';

export const hyperInlineMathStrings = {
  insert: 'Inline equation', edit: 'Edit inline equation', title: 'Inline equation',
  description: 'Enter LaTeX without surrounding dollar signs. Unwrap replaces an equation with its exact source.',
  source: 'Inline LaTeX source', preview: 'Inline equation preview', save: 'Save inline equation', unwrap: 'Unwrap equation',
  saving: 'Saving…', cancel: 'Cancel', copy: 'Copy equation source', copyRecovery: 'Copy save details',
  empty: 'Empty inline equation', unsupported: 'This inline equation uses unsupported data. Its source was kept.',
  readOnly: 'This equation is read-only.', changed: 'The equation or surrounding text changed. Select it again.',
  notReady: 'The document is unavailable. Reopen its editor.', ownerChanged: 'The workspace or account changed. Reopen the editor.',
  partial: 'The save could not be confirmed. Copy the source or save details before closing. Inspect the document before editing again.',
  copyFailed: 'The source could not be copied.', codeConflict: 'Unwrap inline equations before applying code formatting.',
  sourceTruncated: 'The source preview is limited to 8,192 characters. Copy equation source keeps the full value.',
  overflow: 'Inline previews are limited to 64 equations per text block. This text is read-only; copy its source to keep every equation and attribute.',
  unsupportedText: 'This text contains unsupported equation data and is read-only. Its source was kept.',
} as const;
export function useHyperInlineMathText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperInlineMathStrings) => { const key = `hyperInlineMath.${name}`, value = tr(key); return value === key ? hyperInlineMathStrings[name] : value; };
}
