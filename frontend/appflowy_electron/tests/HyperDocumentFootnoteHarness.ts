import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'rolldown';
const root = path.resolve(__dirname, '..'), resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
export const hyperFootnoteElectronAvailable = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
/** Isolated native Chromium, real feature modules and Base UI. Never mounts source HTML. */
export async function hyperRunFootnoteElectron(source: string): Promise<string> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-footnote-editor-'));
  try {
    const stubs: Record<string, string> = {
      '/i18n': `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))};export const tr=(key,options={})=>{let value=key.split('.').reduce((v,k)=>v?.[k],en)??key;for(const[k,v]of Object.entries(options.namedArgs??{}))value=value.replaceAll('{'+k+'}',String(v));return value};export const useTr=()=>({tr});export const resolveLocale=value=>value||'en-US';export const setLocale=()=>{};`,
      '/view-scope': 'export const usePageAccessLevel=()=>null;export const useViewPluginNotifier=()=>null;export const useViewScope=()=>null;export const ViewScopeProvider=({children})=>children;',
      '/document-appearance-store': 'export const useDocumentFontSize=()=>({fontSize:16});',
      '/DocumentBanner': 'export const DocumentBanner=()=>null;export const deletePermanently=async()=>true;export const restorePage=async()=>true;',
      '/page-access-level-store': 'export const ShareAccessLevel={fullAccess:"fullAccess",readAndWrite:"readAndWrite",readAndComment:"readAndComment",readOnly:"readOnly"};export const isEditable=state=>!state.isLocked;export const viewIsLocked=view=>view.oneOfIsLocked.case==="isLocked"&&view.oneOfIsLocked.value;',
      '/HyperDocumentOwner': 'export const hyperGetDocumentOwner=()=>window.fixtureOwner;export const useHyperDocumentOwner=()=>window.fixtureOwner;export const hyperDocumentOwnerKey=owner=>owner?JSON.stringify([owner.workspaceId,owner.actorId,owner.contextKey]):"";',
      '/tabs-store': 'export const tabsActions={openView:()=>{}};',
      '/reminder-store': 'export const reminderActions={refresh:async()=>{}};',
    };
    const paths = Object.fromEntries(Object.entries(stubs).map(([name, code]) => { const file = path.join(temporary, name.slice(1) + '.ts'); fs.writeFileSync(file, code); return [name, file]; }));
    const entry = path.join(temporary, 'entry.tsx'); fs.writeFileSync(entry, source);
    const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'isolated-footnote-editor', resolveId(source) {
      const stub = Object.entries(paths).find(([suffix]) => source.endsWith(suffix)); if (stub) return stub[1];
      if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source); return null;
    } }], resolve: { alias: { '@/i18n': paths['/i18n'], '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
    const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw Error('No footnote fixture bundle');
    fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperFootnoteChecks`); fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><body></body>');
    const main = path.join(temporary, 'main.cjs'); fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
    const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 45_000, maxBuffer: 2_000_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); return stdout;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
