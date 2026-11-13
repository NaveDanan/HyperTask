import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'rolldown';
import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = syncFs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY) && ['pdffonts', 'pdftotext'].every(command => spawnSync(command, ['-v'], { stdio: 'ignore' }).status === 0);
const document = (formula: string) => create(DocumentDataPBSchema, { pageId: 'page', blocks: {
  page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' },
  text: { id: 'text', ty: 'paragraph', parentId: 'page', childrenId: 'text-children', data: JSON.stringify({ delta: [{ insert: 'Before inline equation ' }, { insert: '$', attributes: { formula } }, { insert: ' after inline equation.' }] }) },
}, meta: { childrenMap: { children: { children: ['text'] } } } });

(available ? describe : describe.skip)('Hyper inline math native PDF export', () => {
  it('embeds the pinned font without requests and refuses oversized inline math before printing', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-inline-math-pdf-'));
    try {
      const html = hyperExportDocument(document(String.raw`\frac{a_1}{b}+\alpha`), 'html', 'Inline equations');
      const tooWide = hyperExportDocument(document(Array(200).fill('x').join('+')), 'html');
      const tooNarrow = hyperExportDocument(document(Array(20).fill('x').join('+')), 'html');
      const tooTall = hyperExportDocument(document(String.raw`\begin{matrix}` + Array(100).fill('x').join(String.raw`\\`) + String.raw`\end{matrix}`), 'html');
      const target = path.join(temporary, 'inline.pdf'), entry = path.join(temporary, 'main.ts');
      await fs.writeFile(entry, `
        import{app}from'electron';import fs from'node:fs/promises';import http from'node:http';import{inspect}from'node:util';
        import{hyperRenderDocumentPdf}from${JSON.stringify(path.join(root, 'src/main/HyperDocumentPdf.ts'))};
        let requests=0;const server=http.createServer((_request,response)=>{requests++;response.end('must stay blocked')});
        app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{
          await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
          try{
            const source=${JSON.stringify(html)}+'<script>fetch("'+origin+'/script")</script><style>@font-face{font-family:Remote;src:url("'+origin+'/font")}p.remote{font-family:Remote}</style><p class="remote">Remote font blocked</p>';
            await fs.writeFile(${JSON.stringify(target)},await hyperRenderDocumentPdf(source));
            let missingImageRejected=false;try{await hyperRenderDocumentPdf('<img src="'+origin+'/image">')}catch{missingImageRejected=true}
            if(!missingImageRejected)throw Error('An unavailable remote image was silently omitted');
            let rejected=false;try{await hyperRenderDocumentPdf(${JSON.stringify(tooWide)})}catch(error){rejected=/wider than the PDF page/.test(error.message)}
            if(!rejected)throw Error('Overwide inline math was silently clipped');
            rejected=false;try{await hyperRenderDocumentPdf('<div style="width:120px">'+${JSON.stringify(tooNarrow)}+'</div>')}catch(error){rejected=/wider than the PDF page/.test(error.message)}
            if(!rejected)throw Error('Inline math overflowed its printable container');
            rejected=false;try{await hyperRenderDocumentPdf(${JSON.stringify(tooTall)})}catch(error){rejected=/taller than the PDF page/.test(error.message)}
            if(!rejected)throw Error('Overtall inline math was silently clipped');
            if(requests!==0)throw Error('PDF made an external request');
            console.log('HYPER_INLINE_MATH_PDF_GREEN');server.closeAllConnections();server.close(()=>app.exit(0));
          }catch(error){console.error(inspect(error,{depth:3}));server.closeAllConnections();server.close(()=>app.exit(1))}
        });
      `);
      await build({ input: entry, platform: 'node', external: ['electron', /^node:/], output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')], { timeout: 55_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('HYPER_INLINE_MATH_PDF_GREEN');
      const { stdout: fonts } = await promisify(execFile)('pdffonts', [target]);
      const mathFonts = fonts.split('\n').filter(line => /STIXTwoMath/i.test(line)); expect(mathFonts.length).toBeGreaterThan(0); for (const font of mathFonts) expect(font).toMatch(/\byes\s+yes\s+yes\b/);
      const { stdout: text } = await promisify(execFile)('pdftotext', [target, '-']); expect(text).toContain('Before inline equation'); expect(text).toContain('after inline equation'); expect(text).toContain('Remote font blocked');
      if (process.env.HYPER_INLINE_MATH_PDF_PROOF_DIR) {
        const proof = path.join(process.env.HYPER_INLINE_MATH_PDF_PROOF_DIR, 'HyperTask-inline-equations.pdf');
        await fs.mkdir(path.dirname(proof), { recursive: true, mode: 0o700 }); await fs.copyFile(target, proof); await fs.chmod(proof, 0o600);
      }
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }, 80_000);
});
