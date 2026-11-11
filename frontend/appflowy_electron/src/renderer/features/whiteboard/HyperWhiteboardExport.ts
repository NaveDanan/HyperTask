import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperCanvasConnector, hyperCanvasLabel, hyperCanvasPaintOrder, hyperReadCanvas, type HyperCanvasColor, type HyperCanvasElement } from './HyperWhiteboardModel';
import { hyperCanvasFrameContents } from './HyperWhiteboardFeatures';

export interface HyperWhiteboardExportOptions {
  colors?: Partial<Record<HyperCanvasColor, string>>;
  background?: string;
  noteBackground?: string;
  title?: string;
  frameId?: string;
  images?: Record<string, string>;
}
const xml = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '\uFFFD').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!);
function color(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  // Exported SVG must stay self-contained. CSS paint URLs can load external resources.
  if (/^[a-z]+$/i.test(value) || /^#[\da-f]{3,8}$/i.test(value) || /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([\d.,%/ +\-]+\)$/i.test(value) || /^color\((?:srgb|srgb-linear|display-p3) [\d.,%/ +\-]+\)$/i.test(value)) return value;
  throw new Error('Canvas export requires a resolved, self-contained color.');
}
const defaultColors: Record<HyperCanvasColor, string> = { foreground: '#18181b', primary: '#18181b', info: '#2563eb', success: '#16a34a', warning: '#ca8a04', destructive: '#dc2626' };
const MAX_EMBEDDED_CHARACTERS = 48 * 1024 * 1024;
function linesFor(label: string, width: number): string[] {
  const count = Math.max(1, Math.floor((width - 16) / 8));
  return label.split('\n').flatMap(line => {
    const points = Array.from(line);
    if (!points.length) return [''];
    const result: string[] = [];
    for (let offset = 0; offset < points.length; offset += count) result.push(points.slice(offset, offset + count).join(''));
    return result;
  });
}
function exportElements(doc: DocumentDataPB, options: HyperWhiteboardExportOptions) {
  const snapshot = hyperReadCanvas(doc);
  if (snapshot.unsupportedIds.length) throw new Error('Canvas export cannot omit unsupported elements.');
  const frame = options.frameId ? snapshot.elements.find(element => element.id === options.frameId && element.kind === 'frame') : undefined;
  if (options.frameId && !frame) throw new Error('The selected frame no longer exists.');
  const frameIds = frame ? new Set([frame.id, ...hyperCanvasFrameContents(frame, snapshot.elements).map(element => element.id)]) : null;
  const exported = frameIds ? snapshot.elements.filter(element => frameIds.has(element.id) && (element.kind !== 'connector' || (!element.fromId || frameIds.has(element.fromId)) && (!element.toId || frameIds.has(element.toId)))) : snapshot.elements;
  return { snapshot, frame, exported };
}

function imageData(value: unknown): string {
  if (typeof value !== 'string' || value.length > 24 * 1024 * 1024) throw new Error('Canvas export requires bounded, embedded raster images.');
  const prefix = /^data:image\/(png|jpeg|gif|webp);base64,/.exec(value);
  const encoded = prefix && value.slice(prefix[0].length);
  if (!prefix || !encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Canvas export requires embedded raster images.');
  const header = atob(encoded.slice(0, 64));
  const matched = prefix[1] === 'png' ? header.startsWith('\x89PNG\r\n\x1a\n') : prefix[1] === 'jpeg' ? header.startsWith('\xff\xd8\xff') : prefix[1] === 'gif' ? /^GIF8[79]a/.test(header) : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  if (!matched) throw new Error('Canvas export image content does not match its type.');
  return value;
}

/** Resolve managed images before a pure SVG export. Missing attachments abort the whole export. */
export async function hyperPrepareWhiteboardExport(doc: DocumentDataPB, options: HyperWhiteboardExportOptions = {}, inlineUrl: (source: string) => Promise<string> = source => window.appflowy.assets.inlineUrl(source)): Promise<HyperWhiteboardExportOptions> {
  const images = exportElements(doc, options).exported.filter(element => element.kind === 'image');
  if (!images.length) return options;
  const byPath = new Map<string, Promise<string>>();
  const embedded: Array<[string, string]> = [];
  let total = 0;
  const append = (id: string, data: string) => {
    total += data.length;
    if (total > MAX_EMBEDDED_CHARACTERS) throw new Error('Canvas embedded images are too large to export together. Export a smaller frame.');
    embedded.push([id, data]);
  };
  // Bound concurrent IPC reads for canvases containing many attachments.
  for (let start = 0; start < images.length; start += 4) {
    await Promise.all(images.slice(start, start + 4).map(async element => {
      const supplied = Object.hasOwn(options.images ?? {}, element.id) ? options.images![element.id] : undefined;
      if (supplied !== undefined) { append(element.id, imageData(supplied)); return; }
      const source = element.imagePath!;
      let pending = byPath.get(source);
      if (!pending) {
        pending = Promise.resolve().then(() => inlineUrl(source)).then(imageData);
        byPath.set(source, pending);
      }
      let data: string;
      try { data = await pending; }
      catch { throw new Error('A canvas image could not be embedded. Restore its managed attachment before exporting.'); }
      append(element.id, data);
    }));
  }
  return { ...options, images: Object.fromEntries(embedded) };
}

export function hyperExportWhiteboardSVG(doc: DocumentDataPB, options: HyperWhiteboardExportOptions = {}): string {
  const { snapshot, frame, exported } = exportElements(doc, options);
  const palette = Object.fromEntries(Object.entries(defaultColors).map(([key, value]) => [key, color(options.colors?.[key as HyperCanvasColor], value)])) as Record<HyperCanvasColor, string>;
  const background = color(options.background, '#ffffff'), noteBackground = color(options.noteBackground, '#f4f4f5');
  const prepared = hyperCanvasPaintOrder(exported).map(element => {
    const label = hyperCanvasLabel(element, doc), lines = linesFor(label, element.width);
    return { element, label, lines, height: label && element.kind !== 'image' ? Math.max(element.height, lines.length * 20 + 16) : element.height };
  });
  const heights = new Map(prepared.map(item => [item.element.id, item.height]));
  const bounds = exported.flatMap(element => {
    if (element.kind === 'connector') return hyperCanvasConnector(element, snapshot.elements);
    if (element.kind === 'pen') return element.points.map(point => ({ x: element.x + point.x, y: element.y + point.y }));
    return [{ x: element.x, y: element.y }, { x: element.x + element.width, y: heights.get(element.id)! + element.y }];
  });
  const extent = bounds.reduce((result, point) => ({ left: Math.min(result.left, point.x), top: Math.min(result.top, point.y), right: Math.max(result.right, point.x), bottom: Math.max(result.bottom, point.y) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const left = frame?.x ?? (bounds.length ? extent.left - 24 : 0);
  const top = frame?.y ?? (bounds.length ? extent.top - 24 : 0);
  const width = frame ? Math.max(1, frame.width) : bounds.length ? Math.max(1, extent.right - left + 24) : 800;
  const height = frame ? Math.max(1, frame.height) : bounds.length ? Math.max(1, extent.bottom - top + 24) : 600;
  let totalImages = 0;
  const render = (element: HyperCanvasElement, label: string, lines: string[], visualHeight: number) => {
    const paint = xml(palette[element.color]);
    let shape: string;
    if (element.kind === 'image') {
      if (!Object.hasOwn(options.images ?? {}, element.id)) throw new Error('Canvas images must be embedded before export.');
      const data = imageData(options.images![element.id]);
      totalImages += data.length;
      if (totalImages > MAX_EMBEDDED_CHARACTERS) throw new Error('Canvas embedded images are too large to export together. Export a smaller frame.');
      return `<g><title>${xml(label || 'Image')}</title><image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${xml(data)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${xml(label || 'Image')}"/></g>`;
    } else if (element.kind === 'connector') {
      const [start, end] = hyperCanvasConnector(element, snapshot.elements);
      shape = `<path d="M${start.x} ${start.y} L${end.x} ${end.y}" fill="none" stroke="${paint}" stroke-width="2"/>`;
    } else if (element.kind === 'pen') shape = `<polyline points="${element.points.map(point => `${element.x + point.x},${element.y + point.y}`).join(' ')}" fill="none" stroke="${paint}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (element.kind === 'ellipse') shape = `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + visualHeight / 2}" rx="${element.width / 2}" ry="${visualHeight / 2}" fill="none" stroke="${paint}" stroke-width="2"/>`;
    else shape = `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${visualHeight}" rx="${element.kind === 'frame' ? 0 : 8}" fill="${element.kind === 'note' ? xml(noteBackground) : 'none'}" stroke="${element.kind === 'text' ? 'none' : paint}" stroke-width="2"${element.kind === 'frame' ? ' stroke-dasharray="8 4"' : ''}/>`;
    const text = label ? `<text fill="${paint}" font-family="sans-serif" font-size="14">${lines.map((line, index) => `<tspan x="${element.x + 8}" y="${element.y + 24 + index * 20}">${xml(line)}</tspan>`).join('')}</text>` : '';
    return `<g><title>${xml(label || element.kind)}</title>${shape}${text}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" role="img"><title>${xml(options.title ?? 'HyperTask canvas')}</title><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${xml(background)}"/>${prepared.map(({ element, label, lines, height: visualHeight }) => render(element, label, lines, visualHeight)).join('')}</svg>`;
}

export function hyperResolveWhiteboardTheme(host: HTMLElement): Pick<HyperWhiteboardExportOptions, 'colors' | 'background' | 'noteBackground'> {
  const probe = document.createElement('span');
  host.append(probe);
  const read = (token: string) => { probe.style.color = `var(--${token})`; return getComputedStyle(probe).color; };
  try {
    return { colors: Object.fromEntries(Object.keys(defaultColors).map(token => [token, read(token)])), background: read('background'), noteBackground: read('muted') };
  } finally { probe.remove(); }
}

export async function hyperExportWhiteboardPNG(doc: DocumentDataPB, options: HyperWhiteboardExportOptions = {}, scale = 2): Promise<Uint8Array> {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new Error('PNG export scale must be between 0 and 4.');
  const svg = hyperExportWhiteboardSVG(doc, await hyperPrepareWhiteboardExport(doc, options));
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const width = Math.ceil(Number(parsed.getAttribute('width')) * scale), height = Math.ceil(Number(parsed.getAttribute('height')) * scale);
  if (width > 16384 || height > 16384 || width * height > 64_000_000) throw new Error('The canvas is too large for PNG export. Export SVG or a smaller frame.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render the canvas SVG.')); image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas rendering is unavailable.');
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode PNG.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}
