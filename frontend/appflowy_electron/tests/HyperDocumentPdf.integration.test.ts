import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32, deflateSync } from 'node:zlib';
import { create } from '@bufbuild/protobuf';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { HyperAssets } from '../src/main/HyperAssets';
import { hyperInlineDocumentExport } from '../src/renderer/features/document/HyperDocumentExportBundle';
import { hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperInsertTable } from '../src/renderer/features/document/HyperDocumentTable';
import { hyperInsertCanvasElement } from '../src/renderer/features/whiteboard/HyperWhiteboardModel';
import { hyperInsertDocumentColumns } from '../src/renderer/features/document-columns/HyperDocumentColumnsModel';

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = syncFs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY)) && ['pdfinfo', 'pdftotext'].every(command => spawnSync(command, ['-v'], { stdio: 'ignore' }).status === 0);
function pixel() {
  const chunk = (name: string, bytes: Buffer) => { const body = Buffer.concat([Buffer.from(name), bytes]), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 70, 90, 110, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

(available ? describe : describe.skip)('Hyper portable PDF export in Electron', () => {
  it('prints complete rich content without external access and preserves an existing file when rendering fails', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-document-pdf-test-'));
    try {
      const storage = path.join(temporary, 'storage'); await fs.mkdir(storage);
      const assets = new HyperAssets(() => storage), source = path.join(temporary, 'picture.png');
      await fs.writeFile(source, pixel()); const image = await assets.importFile(source, 'image');
      let doc = create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } });
      const paragraph = hyperInsertBlock(doc, doc.pageId, '', 'paragraph');
      doc = hyperEditText(paragraph.document, paragraph.focus!.id, [{ insert: 'Portable rich text ', attributes: { bold: true } }, { insert: 'with Hebrew שלום and literal <script> text.' }]).document;
      const table = hyperInsertTable(doc, doc.pageId, paragraph.focus!.id);
      doc = hyperEditText(table.document, table.focus!.id, [{ insert: 'Table content' }]).document;
      const columns = hyperInsertDocumentColumns(doc, doc.pageId, '', 2); doc = columns.document;
      const container = Object.values(doc.blocks).find(block => block.ty === 'simple_columns')!;
      const columnIds = doc.meta!.childrenMap[container.childrenId].children;
      for (const [index, id] of columnIds.entries()) {
        const child = doc.meta!.childrenMap[doc.blocks[id].childrenId].children[0];
        doc = hyperEditText(doc, child, [{ insert: index ? 'Right column' : 'Left column' }]).document;
      }
      doc = hyperInsertCanvasElement(doc, 'image', { x: 0, y: 0, width: 120, height: 120 }, { imagePath: image.path, alt: 'Embedded canvas image' }).document;
      doc = hyperInsertCanvasElement(doc, 'text', { x: 140, y: 20, width: 240, height: 80 }, { text: 'Canvas label' }).document;
      const toggle = hyperInsertBlock(doc, doc.pageId, '', 'toggle_list');
      doc = hyperEditText(toggle.document, toggle.focus!.id, [{ insert: 'Collapsed section' }]).document;
      const hidden = hyperInsertBlock(doc, toggle.focus!.id, '', 'paragraph');
      doc = hyperEditText(hidden.document, hidden.focus!.id, [{ insert: 'Print includes collapsed section content' }]).document;
      for (let index = 0; index < 70; index++) {
        const next = hyperInsertBlock(doc, doc.pageId, doc.meta!.childrenMap[doc.blocks[doc.pageId].childrenId].children.at(-1) ?? '', 'paragraph');
        doc = hyperEditText(next.document, next.focus!.id, [{ insert: `Paragraph ${index}: exported document content remains readable across page boundaries.` }]).document;
      }
      const html = await hyperInlineDocumentExport(doc, 'html', 'HyperTask PDF', {}, { assets, writeText: async () => { throw Error('Unexpected text write'); } });
      await fs.unlink(source); await fs.unlink(image.path);
      const target = path.join(temporary, 'document.pdf'), entry = path.join(temporary, 'main.ts');
      await fs.writeFile(entry, `
        import{app}from'electron';import fs from'node:fs/promises';import http from'node:http';
        import{hyperRenderDocumentPdf}from${JSON.stringify(path.join(root, 'src/main/HyperDocumentPdf.ts'))};
        import{HyperAssets}from${JSON.stringify(path.join(root, 'src/main/HyperAssets.ts'))};
        app.on('window-all-closed',()=>{});const server=http.createServer((req,res)=>{requests++;res.end('unexpected')});let requests=0;
        app.whenReady().then(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;const url='http://127.0.0.1:'+port+'/private';
          try{const assets=new HyperAssets(()=>${JSON.stringify(storage)});
            const html=${JSON.stringify(html)}+'<script>fetch("'+url+'");document.body.textContent="SCRIPT RAN"</script><iframe src="'+url+'"></iframe><style>body{background-image:url("'+url+'")}</style>';
            const pdf=await hyperRenderDocumentPdf(html);await assets.writeExportBytes(${JSON.stringify(target)},pdf);
            const before=await fs.readFile(${JSON.stringify(target)});let rejected=false;
            try{const invalid=await hyperRenderDocumentPdf('<img src="'+url+'">');await assets.writeExportBytes(${JSON.stringify(target)},invalid)}catch{rejected=true}
            if(!rejected||!(await fs.readFile(${JSON.stringify(target)})).equals(before)||requests!==0)throw Error('Failed PDF/network preservation check');
            console.log('Hyper PDF checks passed');server.closeAllConnections();server.close(()=>app.exit(0));
          }catch(error){console.error(error.stack);server.closeAllConnections();server.close(()=>app.exit(1))}
        });
      `);
      await build({ input: entry, platform: 'node', external: ['electron', /^node:/], output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')], { timeout: 65_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper PDF checks passed');
      const { stdout: text } = await promisify(execFile)('pdftotext', [target, '-']);
      for (const value of ['HyperTask PDF', 'Portable rich text', 'Table content', 'Left column', 'Right column', 'Canvas label', 'Print includes collapsed section content', 'Paragraph 69']) expect(text).toContain(value);
      expect(text).not.toContain('SCRIPT RAN'); expect(text).not.toContain(temporary);
      const { stdout: info } = await promisify(execFile)('pdfinfo', [target]);
      expect(Number(info.match(/Pages:\s+(\d+)/)?.[1])).toBeGreaterThan(1);
      if (process.env.HYPER_PDF_PROOF_DIR) {
        await fs.mkdir(process.env.HYPER_PDF_PROOF_DIR, { recursive: true });
        await fs.copyFile(target, path.join(process.env.HYPER_PDF_PROOF_DIR, 'HyperTask-document-export.pdf'));
      }
      expect((await fs.readdir(temporary)).some(name => name.endsWith('.partial'))).toBe(false);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }, 100_000);
});
