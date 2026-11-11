import { hyperDocumentExportScope, hyperDocumentProtectedImages, hyperPrepareProtectedDocumentImages } from '../document-media/HyperDocumentProtectedExport';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import type { AppFlowyApi } from '@shared/api';
import { hyperExportWhiteboardSVG, hyperPrepareWhiteboardExport } from '../whiteboard/HyperWhiteboardExport';
import { hyperReadCanvas } from '../whiteboard/HyperWhiteboardModel';
import { hyperDocumentHasCanvas, hyperDocumentLocalAssets, hyperDocumentLocalBookmarkThumbnails, hyperDocumentPageMentions, hyperExportDocument, type HyperDocumentExportOptions } from './HyperDocumentExport';

interface HyperExportIO {
  assets: Pick<AppFlowyApi['assets'], 'exportFile' | 'inlineUrl'>;
  current?(): boolean;
  writeText(path: string, content: string): Promise<void>;
  page?(id: string): Promise<{ label: string; url?: string }>;
}
const encodedName = (path: string) => encodeURIComponent(path.split(/[\\/]/).at(-1)!).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const companion = (target: string, filename: string) => `${target.slice(0, (target.startsWith('/') ? target.lastIndexOf('/') : Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))) + 1)}${filename}`;

async function withPageMentions(document: DocumentDataPB, options: HyperDocumentExportOptions, io: HyperExportIO): Promise<HyperDocumentExportOptions> {
  const pageMentions = { ...options.pageMentions };
  const ids = hyperDocumentPageMentions(document).filter(id => !pageMentions[id]);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { pageMentions[id] = await io.page?.(id) ?? { label: id }; }
      catch { pageMentions[id] = { label: id }; }
    }
  }));
  return { ...options, pageMentions };
}

/** Validate all blocks before showing a save dialog or reading/copying attachment bytes. */
export function hyperValidateDocumentExport(document: DocumentDataPB, format: 'html' | 'markdown', title: string, options: HyperDocumentExportOptions = {}) {
  const mediaUrls = Object.fromEntries(hyperDocumentLocalAssets(document).map((url, index) => [url, `attachment-${index}.bin`]));
  // Validate the model before asking for a save location. Image files are read only later.
  const placeholder = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
  if (format === 'html') for (const source of hyperDocumentLocalBookmarkThumbnails(document)) mediaUrls[source] = placeholder;
  for (const url of hyperDocumentProtectedImages(document)) mediaUrls[url] = placeholder;
  const images = Object.fromEntries(hyperReadCanvas(document).elements.filter(element => element.kind === 'image').map(element => [element.id, placeholder]));
  return hyperExportDocument(document, format, title, { ...options, mediaUrls, canvas: { ...options.canvas, images: { ...images, ...options.canvas?.images } } });
}

async function withCanvasImages(document: DocumentDataPB, options: HyperDocumentExportOptions, io: HyperExportIO): Promise<HyperDocumentExportOptions> {
  if (!hyperDocumentHasCanvas(document)) return options;
  const canvas = await hyperPrepareWhiteboardExport(document, options.canvas, source => io.assets.inlineUrl(source));
  if (Object.values(canvas.images ?? {}).reduce((sum, value) => sum + value.length, 0) > 48 * 1024 * 1024) throw new Error('The canvas images are too large for export. Export a smaller canvas.');
  return { ...options, canvas };
}

export async function hyperInlineDocumentExport(document: DocumentDataPB, format: 'html' | 'markdown', title: string, options: HyperDocumentExportOptions, io: HyperExportIO): Promise<string> {
  const scope = hyperDocumentExportScope(document, io.current); scope.check();
  hyperValidateDocumentExport(document, format, title, options);
  options = await withPageMentions(document, options, io); scope.check();
  options = await withCanvasImages(document, options, io); scope.check();
  if (hyperDocumentProtectedImages(document).length && !scope.owner) throw new Error('Open a workspace before exporting protected images.');
  const prepared = await hyperPrepareProtectedDocumentImages(document, Object.values(options.canvas?.images ?? {}).reduce((sum, value) => sum + value.length, 0), scope.check);
  const mediaUrls: Record<string, string> = { ...prepared.mediaUrls };
  let size = prepared.size;
  for (const source of hyperDocumentLocalAssets(document)) {
    scope.check(); const url = await io.assets.inlineUrl(source); scope.check();
    size += url.length;
    if (size > 48 * 1024 * 1024) throw new Error('The attachments are too large for an inline export. Save HTML or Markdown instead.');
    mediaUrls[source] = url;
  }
  scope.check(); return hyperExportDocument(document, format, title, { ...options, mediaUrls });
}

export const hyperCopyDocumentExport = (document: DocumentDataPB, title: string, options: HyperDocumentExportOptions, io: HyperExportIO): Promise<string> => hyperInlineDocumentExport(document, 'markdown', title, options, io);

export async function hyperSaveDocumentExport(document: DocumentDataPB, format: 'html' | 'markdown', title: string, target: string, options: HyperDocumentExportOptions, io: HyperExportIO): Promise<void> {
  const scope = hyperDocumentExportScope(document, io.current); scope.check();
  hyperValidateDocumentExport(document, format, title, options);
  options = await withPageMentions(document, options, io); scope.check();
  options = await withCanvasImages(document, options, io); scope.check();
  if (hyperDocumentProtectedImages(document).length && !scope.owner) throw new Error('Open a workspace before exporting protected images.');
  const prepared = await hyperPrepareProtectedDocumentImages(document, Object.values(options.canvas?.images ?? {}).reduce((sum, value) => sum + value.length, 0), scope.check);
  const mediaUrls: Record<string, string> = { ...prepared.mediaUrls };
  if (format === 'html') { let size = prepared.size; for (const source of hyperDocumentLocalBookmarkThumbnails(document)) { scope.check(); const value = await io.assets.inlineUrl(source); scope.check(); size += value.length; if (size > 48 * 1024 * 1024) throw Error('The bookmark thumbnails are too large for portable HTML.'); mediaUrls[source] = value; } }
  const copies = hyperDocumentLocalAssets(document).map(source => {
    if (mediaUrls[source]) return null;
    const extension = source.match(/\.([A-Za-z0-9]{1,16})$/)?.[1] || 'bin';
    const path = companion(target, `HyperTask.asset-${crypto.randomUUID()}.${extension}`);
    mediaUrls[source] = encodedName(path);
    return { source, path };
  }).filter((copy): copy is { source: string; path: string } => copy !== null);
  const canvasPath = format === 'markdown' && hyperDocumentHasCanvas(document) ? companion(target, `HyperTask.canvas-${crypto.randomUUID()}.svg`) : undefined;
  scope.check(); const content = hyperExportDocument(document, format, title, { ...options, mediaUrls, ...(canvasPath ? { canvasUrl: encodedName(canvasPath) } : {}) });
  const canvas = canvasPath ? hyperExportWhiteboardSVG(document, { title, ...options.canvas }) : undefined;
  // Final content is written last. Failed attachment copies leave an existing export intact.
  // Unique companions never replace unrelated files and are retained if a later write fails.
  for (const copy of copies) { scope.check(); await io.assets.exportFile(copy.source, copy.path); scope.check(); }
  if (canvasPath && canvas) { scope.check(); await io.writeText(canvasPath, canvas); scope.check(); }
  scope.check(); await io.writeText(target, content);
}
