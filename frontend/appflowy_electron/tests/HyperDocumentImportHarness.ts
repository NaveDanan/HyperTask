import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'rolldown';
import type { HyperHtmlImportIssue } from '../src/renderer/features/document-import/HyperDocumentHtmlParser';

const root = path.resolve(__dirname, '..');
const resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
export const hyperHtmlElectronAvailable = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
export type HyperHtmlFixtureResult = { ok: true; title: string; bytes: number[]; issues: HyperHtmlImportIssue[]; issueCount: number; blockCount: number; textLength: number } | { ok: false; error: string };
export async function hyperParseHtmlFixtures(cases: Array<{ source: string; fallback?: string }>): Promise<{ pages: HyperHtmlFixtureResult[]; executed: number; requests: number }> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-html-parser-'));
  try {
    const entry = path.join(temporary, 'entry.ts');
    fs.writeFileSync(entry, `import {toBinary} from '@bufbuild/protobuf';import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';import {hyperParseHtmlImport} from '@/features/document-import/HyperDocumentHtmlParser';window.importExecuted=0;window.hyperHtmlResults={pages:${JSON.stringify(cases)}.map(input=>{try{const result=hyperParseHtmlImport(input.source.replaceAll('__FIXTURE_ORIGIN__',window.fixtureOrigin),input.fallback);return{ok:true,title:result.title,bytes:Array.from(toBinary(DocumentDataPBSchema,result.document)),issues:result.issues,issueCount:result.issueCount,blockCount:result.blockCount,textLength:result.textLength}}catch(error){return{ok:false,error:error.message}}}),executed:window.importExecuted};`);
    const result = await build({ input: entry, plugins: [{ name: 'local-parser-packages', resolveId(source) { return source === '@bufbuild/protobuf' ? resolvePackage(source) : null; } }], resolve: { alias: { '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, output: { format: 'iife' }, write: false });
    const code = result.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No HTML parser bundle');
    fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperHtmlResults`);
    fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\' http://127.0.0.1:*; script-src \'self\' \'unsafe-eval\' http://127.0.0.1:*; style-src \'self\' \'unsafe-inline\' http://127.0.0.1:*; img-src http://127.0.0.1:*; frame-src http://127.0.0.1:*"><body></body>');
    const main = path.join(temporary, 'main.cjs');
    fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron'),http=require('node:http');app.whenReady().then(async()=>{let requests=0;const server=http.createServer((request,response)=>{requests++;response.end('fixture')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});try{await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});await win.webContents.executeJavaScript('window.fixtureOrigin='+JSON.stringify('http://127.0.0.1:'+server.address().port));const results=await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));await new Promise(resolve=>setTimeout(resolve,200));win.destroy();console.log('HYPER_HTML_RESULTS '+JSON.stringify({...results,requests}));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.exit(0)}catch(error){console.error(error.stack);server.closeAllConnections();server.close();app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
    const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, maxBuffer: 8_000_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    const report = stdout.split('\n').find(line => line.startsWith('HYPER_HTML_RESULTS '));
    if (!report) throw new Error('No native HTML parser result');
    return JSON.parse(report.slice('HYPER_HTML_RESULTS '.length));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
