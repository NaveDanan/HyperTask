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
import { HYPER_MATH_FONT_MARKER } from '../src/shared/HyperMathFont';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = syncFs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY)) && ['pdffonts', 'pdftotext'].every(command => spawnSync(command, ['-v'], { stdio: 'ignore' }).status === 0);

(available ? describe : describe.skip)('Hyper equation PDF font isolation', () => {
  it('embeds the pinned binary math font while rejecting document font URLs and network requests', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-math-pdf-'));
    try {
      const formulas = [String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}`,
        String.raw`\begin{pmatrix}\frac{1}{x}&y\\z&\frac{a}{\frac{b}{c}}\end{pmatrix}`,
        String.raw`\begin{bmatrix}\frac{1}{x}&y\\z&\frac{a}{\frac{b}{c}}\end{bmatrix}`,
        String.raw`f(x)=\begin{cases}\frac{x}{y}&x>0\\\frac{a}{\frac{b}{c}}&x\le 0\end{cases}`];
      const ids = formulas.map((_formula, index) => `equation-${index}`);
      const doc = create(DocumentDataPBSchema, { pageId: 'root', blocks: {
        root: { id: 'root', ty: 'page', childrenId: 'children', data: '{}' },
        ...Object.fromEntries(formulas.map((formula, index) => [ids[index], { id: ids[index], ty: 'math_equation', parentId: 'root', childrenId: `${ids[index]}-children`, data: JSON.stringify({ formula }) }])),
      }, meta: { childrenMap: { children: { children: ids } } } });
      const html = hyperExportDocument(doc, 'html', 'Portable equations');
      expect(html.match(/data-hyper-math-font=/g)).toHaveLength(1);
      expect(html).toContain(HYPER_MATH_FONT_MARKER);
      doc.blocks[ids[0]].data = JSON.stringify({ formula: Array(200).fill('x').join('+') });
      const tooWide = hyperExportDocument(doc, 'html', 'Too wide to print');
      doc.blocks[ids[0]].data = JSON.stringify({ formula: String.raw`\begin{matrix}` + Array(100).fill('x').join(String.raw`\\`) + String.raw`\end{matrix}` });
      const tooTall = hyperExportDocument(doc, 'html', 'Too tall to print');
      const target = path.join(temporary, 'equations.pdf'), entry = path.join(temporary, 'main.ts');
      await fs.writeFile(entry, `
        import{app}from'electron';import fs from'node:fs/promises';import http from'node:http';
        import{hyperRenderDocumentPdf}from${JSON.stringify(path.join(root, 'src/main/HyperDocumentPdf.ts'))};
        let requests=0;const server=http.createServer((_request,response)=>{requests++;response.end('blocked font')});
        app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{
          await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/font.woff2';
          try{
            const html=${JSON.stringify(html)}+'<style>@font-face{font-family:Untrusted;src:url("'+url+'")}p.untrusted{font-family:Untrusted}</style><p class="untrusted">Untrusted font stays blocked</p>';
            const bytes=await hyperRenderDocumentPdf(html);await fs.writeFile(${JSON.stringify(target)},bytes);
            let rejected=false;try{await hyperRenderDocumentPdf(${JSON.stringify(tooWide)})}catch(error){rejected=/wider than the PDF page/.test(error.message)}
            if(!rejected)throw Error('An overwide equation was silently clipped');
            rejected=false;try{await hyperRenderDocumentPdf(${JSON.stringify(tooTall)})}catch(error){rejected=/taller than the PDF page/.test(error.message)}
            if(!rejected)throw Error('An overtall equation was silently clipped');
            if(requests!==0)throw Error('PDF loaded an external font');
            console.log('Hyper math PDF checks passed');server.closeAllConnections();server.close(()=>app.exit(0));
          }catch(error){console.error(error.stack);server.closeAllConnections();server.close(()=>app.exit(1))}
        });
      `);
      await build({ input: entry, platform: 'node', external: ['electron', /^node:/], output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')], { timeout: 55_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper math PDF checks passed');
      const { stdout: fonts } = await promisify(execFile)('pdffonts', [target]);
      const mathFonts = fonts.split('\n').filter(line => /STIXTwoMath/i.test(line));
      expect(mathFonts.length).toBeGreaterThan(0);
      for (const font of mathFonts) expect(font).toMatch(/\byes\s+yes\s+yes\b/);
      const { stdout: text } = await promisify(execFile)('pdftotext', [target, '-']);
      expect(text).toContain('Portable equations'); expect(text).toContain('Untrusted font stays blocked');
      if (process.env.HYPER_MATH_PDF_PROOF_DIR) {
        await fs.mkdir(process.env.HYPER_MATH_PDF_PROOF_DIR, { recursive: true });
        await fs.copyFile(target, path.join(process.env.HYPER_MATH_PDF_PROOF_DIR, 'HyperTask-equations.pdf'));
      }
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }, 100_000);
});
