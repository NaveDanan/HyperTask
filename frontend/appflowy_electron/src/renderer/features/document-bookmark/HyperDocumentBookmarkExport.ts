import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperReadDocumentBookmark } from './HyperDocumentBookmarkModel';
import { hyperBookmarkHtmlMarker, hyperBookmarkUrl, hyperValidateBookmarkFields } from './HyperDocumentBookmarkValue';
import { hyperPortableBookmarkRaster } from './HyperBookmarkThumbnailValue';
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const markdown = (value: string) => value.replace(/([\\`*_[\]<>!#()+.\-~{}])/g, '\\$1');
export function hyperExportDocumentBookmark(doc: DocumentDataPB, id: string, html: boolean, mediaUrls: Record<string, string> = {}): string {
  const read = hyperReadDocumentBookmark(doc, id), value = hyperValidateBookmarkFields(read.fields), url = hyperBookmarkUrl(value.url), title = value.title || value.url;
  const thumbnail = value.thumbnail, image = thumbnail ? mediaUrls[thumbnail.media.url] : undefined;
  if (thumbnail && (!image || html && !hyperPortableBookmarkRaster(image) || !html && !hyperPortableBookmarkRaster(image) && !/^[A-Za-z0-9%_.-]+$/u.test(image))) throw Error('The bookmark thumbnail must be included as a portable raster image. Its saved reference was kept.');
  if (image && !hyperPortableBookmarkRaster(image)) { const decoded = decodeURIComponent(image); if (decoded === '.' || decoded === '..' || /[/\\\0]/u.test(decoded)) throw Error('The bookmark thumbnail export path is unsafe.'); }
  if (!html) return [thumbnail && `![${markdown(title)}](<${image}>)`, `[${markdown(title)}](<${url.replaceAll('>', '%3E')}>)`, value.site && markdown(value.site), value.description && markdown(value.description), value.caption && markdown(value.caption)].filter(Boolean).join('\n\n');
  return `<figure data-hyper-bookmark="${escape(hyperBookmarkHtmlMarker(doc.blocks[id], true))}" style="margin:1rem 0;padding:1rem;border:1px solid currentColor;border-radius:8px;overflow-wrap:anywhere">${thumbnail ? `<img data-hyper-bookmark-thumbnail src="${escape(image!)}" width="${thumbnail.width}" height="${thumbnail.height}" alt="${escape(title)}" style="max-width:100%;height:auto;max-height:256px;object-fit:contain">` : ''}<p><a href="${escape(url)}" rel="noopener noreferrer"><strong>${escape(title)}</strong></a></p>${value.site ? `<p>${escape(value.site)}</p>` : ''}${value.description ? `<p>${escape(value.description).replaceAll('\n', '<br>')}</p>` : ''}${value.caption ? `<figcaption>${escape(value.caption).replaceAll('\n', '<br>')}</figcaption>` : ''}</figure>`;
}
