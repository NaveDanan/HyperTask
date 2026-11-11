import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import { HYPER_MATH_FONT_BASE64, HYPER_MATH_FONT_FAMILY, HYPER_MATH_FONT_SHA256 } from '../shared/HyperMathFont';

const partition = `hyper-pdf-${randomUUID()}`;
let queue: Promise<unknown> = Promise.resolve();
const limit = 64 * 1024 * 1024;
const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function hyperPdfMathFont(html: string): string | undefined {
  if (!/<math(?:\s|>)/i.test(html)) return undefined;
  const bytes = Buffer.from(HYPER_MATH_FONT_BASE64, 'base64');
  if (bytes.length > 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== HYPER_MATH_FONT_SHA256) {
    throw new Error('The bundled math font could not be verified.');
  }
  return bytes.toString('base64');
}

export function hyperPdfDocument(html: string): string {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > limit) throw new Error('This document is too large for PDF export.');
  // Use A4's print width during measurement too: 32mm page margins and 8px body margins.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>
    @page{size:A4;margin:16mm}html{color-scheme:light}body{font-family:sans-serif;font-size:11pt;line-height:1.5;color:#18181b;background:white;overflow-wrap:anywhere;margin:8px;width:calc(178mm - 16px)}
    h1,h2,h3,h4,h5,h6{break-after:avoid;line-height:1.25}h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}
    p{margin:.5em 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f5;padding:8pt;border-radius:4pt}code{font-family:monospace}
    table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #d4d4d8;padding:5pt;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}
    img,svg{max-width:100%;height:auto}figure{margin:8pt 0;break-inside:avoid}blockquote{margin-left:0;padding-left:10pt;border-left:2pt solid #d4d4d8}a{color:inherit}
    .hyper-document-equation,.hyper-document-inline-equation{overflow:visible!important}
  </style></head><body>${html}</body></html>`;
}

/** Isolated print renderer: no scripts, network, workspace files, permissions or persistent profile. */
async function render(html: string): Promise<Uint8Array> {
  const content = hyperPdfDocument(html), font = hyperPdfMathFont(html), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-pdf-'));
  let window: BrowserWindow | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const source = path.join(temporary, 'document.html'), url = pathToFileURL(source).href;
    await fs.writeFile(source, content, { mode: 0o600 });
    const isolated = session.fromPartition(partition);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== url && !details.url.startsWith('data:') }));
    window = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const current = window;
    const operation = async () => {
      await current.loadFile(source);
      // The fixed bundled font uses bytes, so arbitrary CSS/URL fonts stay blocked.
      // executeJavaScript runs trusted main code; document scripts stay disabled.
      await current.webContents.executeJavaScript(`(async () => {
        for (const node of document.querySelectorAll('iframe,object,embed,script')) node.remove();
        for (const node of document.querySelectorAll('details')) node.open = true;
        for (const node of document.querySelectorAll('style[data-hyper-math-font]')) node.remove();
        const font = ${JSON.stringify(font ?? null)};
        if (font) {
          const bytes = Uint8Array.from(atob(font), character => character.charCodeAt(0));
          const face = new FontFace(${JSON.stringify(HYPER_MATH_FONT_FAMILY)}, bytes.buffer);
          await face.load();
          document.fonts.add(face);
        }
        await Promise.all(Array.from(document.images, image => image.decode()));
        await document.fonts.ready;
        for (const equation of document.querySelectorAll('.hyper-document-equation,.hyper-document-inline-equation')) {
          const rect = equation.getBoundingClientRect(), math = equation.querySelector('math')?.getBoundingClientRect();
          let available = equation.clientWidth;
          if (equation.classList.contains('hyper-document-inline-equation')) {
            const container = equation.closest('p,li,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote,div,section,article') || document.body;
            const style = getComputedStyle(container);
            available = Math.min(document.body.clientWidth, Math.max(0, container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)));
          }
          if (Math.max(equation.scrollWidth, rect.width, math?.width || 0) > available + 2) throw new Error('An equation is wider than the PDF page. Split it across lines before exporting.');
          const style = getComputedStyle(equation), margins = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
          if (Math.max(equation.scrollHeight, rect.height, math?.height || 0) + margins > 265 * 96 / 25.4 - 16) throw new Error('An equation is taller than the PDF page. Split it into smaller equations before exporting.');
        }
        for (const link of document.querySelectorAll('a[download]')) link.removeAttribute('href');
      })()`);
      const bytes = await current.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, generateTaggedPDF: true, displayHeaderFooter: false });
      if (bytes.length > limit || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The PDF could not be generated within the export size limit.');
      return new Uint8Array(bytes);
    };
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PDF export timed out. Try a smaller document.')), 20_000); })]);
  } finally {
    if (timer) clearTimeout(timer);
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

/** Serialize large print jobs so several export clicks cannot allocate parallel renderers. */
export function hyperRenderDocumentPdf(html: string): Promise<Uint8Array> {
  const result = queue.then(() => render(html));
  queue = result.catch(() => {});
  return result;
}
