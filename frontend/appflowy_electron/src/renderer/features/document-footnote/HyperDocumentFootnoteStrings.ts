import { useTr } from '@/i18n';
export const hyperDocumentFootnoteStrings = {
  insert: 'Footnote', title: 'Footnote or citation', description: 'Add a note or cite a page or web source.', note: 'Text note', doc: 'Page reference', url: 'Web reference', existing: 'Existing footnote', sourceType: 'Footnote type', text: 'Note text', page: 'Referenced page', address: 'Source URL', sourceTitle: 'Source title', sourceDescription: 'Source description',
  save: 'Save footnote', saving: 'Saving footnote…', cancel: 'Cancel', remove: 'Remove this reference', copy: 'Copy footnote source', openPage: 'Open referenced page', openUrl: 'Open source URL',
  pages: 'Choose a page', searchPages: 'Search referenced pages', noPages: 'No pages match.', loadPages: 'Load pages', loading: 'Loading pages…', showMore: 'Show more', chooseExisting: 'Choose an existing footnote', references: 'Changes apply to all {count} references to this footnote.',
  readOnly: 'This footnote is read-only.', unsupported: 'This footnote uses a format this version cannot safely edit. Its data was kept.', conflict: 'Footnote labels or note IDs have conflicting definitions. Resolve the conflicting references before editing.', changed: 'The footnote or its text changed. Reopen it before saving.', invalidNote: 'Enter some note text.', invalidUrl: 'Enter a safe, absolute HTTP, HTTPS or mailto URL.', choosePage: 'Choose a referenced page.',
  invalidPosition: 'Choose a text position between complete characters.', notReady: 'This document is unavailable or has pending recovery.', ownerChanged: 'The document, workspace or account changed. Reopen the footnote inspector.', closed: 'The footnote inspector was closed.', pageUnavailable: 'The referenced source is unavailable.', partial: 'The save was not confirmed. Copy the footnote source before closing; saving again could duplicate it.', copyFailed: 'The footnote source could not be copied.',
  list: 'Footnotes', previous: 'Previous choices', next: 'Next choices', range: '{start}–{end} of {total}', attachment: 'Attachment reference', unknown: 'Unsupported footnote', searchExisting: 'Search existing footnotes',
} as const;
export function useHyperDocumentFootnoteText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperDocumentFootnoteStrings, args: Record<string, string | number> = {}) => {
    const key = `hyperDocumentFootnote.${name}`, value = tr(key, { namedArgs: args });
    return value === key ? Object.entries(args).reduce<string>((text, [key, replacement]) => text.replaceAll(`{${key}}`, String(replacement)), hyperDocumentFootnoteStrings[name]) : value;
  };
}
