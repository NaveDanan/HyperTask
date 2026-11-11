import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperDocumentFootnoteIndex } from './HyperDocumentFootnoteModel';
import { hyperDocumentFootnoteUrl, hyperReadDocumentFootnote, type HyperDocumentFootnoteValue } from './HyperDocumentFootnoteValue';
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const escapeMarkdown = (value: string) => value.replace(/([\\`*_[\]<>!#()+.\-~{}])/g, '\\$1');
const referenceKeys = ['type', 'docId', 'blobId', 'artifactId', 'fileName', 'fileType', 'url', 'favicon', 'title', 'description'];
const labelToken = (value: string) => {
  if (/[\r\n]/.test(value)) throw Error('This footnote label cannot be exported to Markdown. Use HTML or copy its source.');
  return value.replace(/[\\\]]/g, '\\$&');
};
export interface HyperFootnoteExport { inline(run: HyperTextRun, html: boolean): string | null; definitions(html: boolean): string }
/** All definitions are validated first, so an export never silently loses an opaque source. */
export function hyperCreateFootnoteExport(doc: DocumentDataPB, pages: Record<string, { label: string; url?: string }> = {}): HyperFootnoteExport {
  const index = hyperDocumentFootnoteIndex(doc);
  if (index.conflict) throw Error('Footnote labels or note IDs have conflicting definitions. Copy their source before exporting.');
  const values = new Map<string, HyperDocumentFootnoteValue>(), ordinals = new Map<string, number>(), counts = new Map<string, number>();
  for (const entry of index.entries) {
    if (!entry.read.supported || !entry.read.value || doc.blocks[entry.blockId]?.ty === 'code') throw Error('This footnote uses an unsupported format. Copy its source before exporting.');
    if (!values.has(entry.read.label)) { values.set(entry.read.label, entry.read.value); ordinals.set(entry.read.label, values.size); }
  }
  return {
    inline(run, html) {
      const read = hyperReadDocumentFootnote(run); if (!read) return null;
      if (!read.supported || !read.value || typeof run.insert !== 'string' || !values.has(read.label)) throw Error('This footnote uses an unsupported format. Copy its source before exporting.');
      return Array.from(run.insert, () => {
        if (!html) return `[^${labelToken(read.label)}]`;
        const ordinal = ordinals.get(read.label)!, count = (counts.get(read.label) ?? 0) + 1; counts.set(read.label, count);
        const envelope = JSON.stringify({ version: 1, insert: ' ', attributes: run.attributes });
        return `<sup id="hyper-footnote-ref-${ordinal}-${count}" data-hyper-footnote="${escapeHtml(envelope)}"><a href="#hyper-footnote-${ordinal}" role="doc-noteref">${escapeHtml(read.label)}</a></sup>`;
      }).join('');
    },
    definitions(html) {
      if (!values.size) return '';
      const definitions = [...values].map(([label, value]) => {
        if (!html) {
          const body = value.kind === 'note' ? escapeMarkdown(value.data.text) : JSON.stringify(Object.fromEntries(referenceKeys.filter(key => Object.hasOwn(value.data.reference, key)).map(key => [key, ['url', 'favicon'].includes(key) ? encodeURIComponent(String(value.data.reference[key])) : value.data.reference[key]])));
          return `[^${labelToken(label)}]: ${body.split('\n').join('\n    ')}`;
        }
        let text: string;
        if (value.kind === 'note') text = escapeHtml(value.data.text).replaceAll('\n', '<br>');
        else {
          const reference = value.data.reference, page = reference.docId ? pages[reference.docId] : undefined;
          const title = reference.title || page?.label || reference.fileName || reference.url || reference.docId || reference.blobId || label;
          const url = hyperDocumentFootnoteUrl(reference.type === 'url' ? reference.url ?? '' : reference.type === 'doc' ? page?.url ?? '' : '');
          text = url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title);
          if (reference.description) text += ` ${escapeHtml(reference.description)}`;
        }
        return `<li id="hyper-footnote-${ordinals.get(label)}" role="doc-endnote"><span>${escapeHtml(label)}.</span> ${text}</li>`;
      });
      return html ? `\n<section data-hyper-footnote-definitions="1" role="doc-endnotes"><ol>${definitions.join('\n')}</ol></section>` : `\n\n${definitions.join('\n\n')}`;
    },
  };
}
export { hyperParseFootnoteHtmlMarker } from './HyperDocumentFootnoteValue';
