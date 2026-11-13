import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..'), resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY));
(available ? describe : describe.skip)('Hyper PDF export menu in Electron', () => {
  it('saves through the typed bridge, cancels without printing, and drops a completed print after an account switch', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-pdf-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), ui = path.join(temporary, 'ui.ts'), entry = path.join(temporary, 'entry.tsx');
      const target = path.join(temporary, 'saved.pdf'), stale = path.join(temporary, 'stale.pdf');
      fs.writeFileSync(i18n, `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))};export function tr(key){return key.split('.').reduce((value,key)=>value?.[key],en)??key}export const useTr=()=>({tr});export const resolveLocale=value=>value;export const setLocale=()=>{};`);
      fs.writeFileSync(ui, 'export const Popover=()=>null;export const showToast=value=>window.hyperToasts.push(value.message);');
      fs.writeFileSync(entry, `
        import React from'react';import{createRoot}from'react-dom/client';import{createStore}from'zustand';import{create,toBinary}from'@bufbuild/protobuf';
        import{HyperDocumentExportTab}from'@/features/view-header/share/ShareButton';
        import{DocumentDataPBSchema}from'@shared/protobuf/flowy-document/entities_pb';import{ViewPBSchema,ViewLayoutPB}from'@shared/protobuf/flowy-folder/view_pb';
        import{UserProfilePBSchema}from'@shared/protobuf/flowy-user/user_profile_pb';
        import{useWorkspaceStore}from'@/features/sidebar/stores/workspace-store';import{useAppStore}from'@/startup/app-store';
        window.hyperPdfMenuChecks=(async()=>{
          const assert=(value,message)=>{if(!value)throw Error(message)};
          const wait=async(check,label)=>{const until=Date.now()+6000;while(!await check()){if(Date.now()>until)throw Error('Timed out '+label);await new Promise(resolve=>setTimeout(resolve,10));}};
          const fixture=window.fixture;window.hyperToasts=[];
          const doc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',childrenId:'children',data:'{}'},p:{id:'p',ty:'paragraph',parentId:'root',childrenId:'pc',data:JSON.stringify({delta:[{insert:'Saved document print content'}]})}},meta:{childrenMap:{children:{children:['p']},pc:{children:[]}}}});
          let reads=0;window.appflowy={core:{request:async event=>{if(event!=='GetDocumentData')throw Error('Unexpected '+event);reads++;return{status:0,payload:toBinary(DocumentDataPBSchema,doc)}}},assets:{writeExportBytes:fixture.write,inlineUrl:async()=>{throw Error('Unexpected attachment read')}},documentExport:{renderPdf:fixture.render},dialog:{saveFile:fixture.pick},clipboard:{writeText:()=>{throw Error('Unexpected clipboard')}}};
          const owner=id=>create(UserProfilePBSchema,{id:BigInt(id),name:'PDF fixture'});
          useWorkspaceStore.setState({userProfile:owner(1),currentWorkspace:{workspaceId:'workspace'},actionResult:null});useAppStore.setState({dataDirectory:'pdf-fixture',env:null});
          const store=Object.assign(createStore(()=>({viewName:'PDF fixture',workspaceId:'workspace'})),{view:create(ViewPBSchema,{id:'document',name:'PDF fixture',layout:ViewLayoutPB.Document})});
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);app.render(<HyperDocumentExportTab store={store}/>);
          const button=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='PDF');await wait(button,'PDF action');
          button().click();await wait(async()=>(await fixture.state()).writes===1,'PDF saved');await wait(()=>!button().disabled,'buttons restored');
          assert(await fixture.valid(${JSON.stringify(target)}),'actual PDF bytes saved through main/preload bridge');assert(window.hyperToasts.length===1,'success feedback');
          await fixture.cancel();button().click();await wait(async()=>(await fixture.state()).picks===2&&!button().disabled,'dialog cancellation');
          assert((await fixture.state()).renders===1&&(await fixture.state()).writes===1,'cancel starts no print or write');
          await fixture.hold(${JSON.stringify(stale)});button().click();await wait(async()=>(await fixture.state()).renders===2,'held print starts');
          assert(button().disabled&&[...host.querySelectorAll('button')].every(button=>button.disabled),'all export actions disabled while printing');
          useWorkspaceStore.setState({userProfile:owner(2),currentWorkspace:{workspaceId:'workspace'},actionResult:null});await fixture.release();
          await wait(()=>!button().disabled,'stale print settles');
          assert((await fixture.state()).writes===1&&!await fixture.valid(${JSON.stringify(stale)}),'old actor print cannot write after account switch');
          assert(window.hyperToasts.length===2&&reads===3,'cancel has no success toast and stale export reports failure');
          app.unmount();return'Hyper PDF menu checks passed';
        })();
      `);
      const renderer = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'pdf-menu-fixture', resolveId(source) {
        if (source.endsWith('/i18n')) return i18n;
        if (source === '@/ui') return ui;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@/ui': ui, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const chunk = renderer.output.find(item => item.type === 'chunk'); if (chunk?.type !== 'chunk') throw Error('No PDF menu bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), chunk.code + '\nwindow.hyperPdfMenuChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const preload = path.join(temporary, 'preload.cjs');
      fs.writeFileSync(preload, `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',Object.fromEntries(['write','render','pick','state','cancel','hold','release','valid'].map(name=>[name,(...args)=>ipcRenderer.invoke(name,...args)])));`);
      const main = path.join(temporary, 'main.ts');
      fs.writeFileSync(main, `
        import{app,BrowserWindow,ipcMain}from'electron';import fs from'node:fs/promises';
        import{hyperRenderDocumentPdf}from${JSON.stringify(path.join(root, 'src/main/HyperDocumentPdf.ts'))};import{HyperAssets}from${JSON.stringify(path.join(root, 'src/main/HyperAssets.ts'))};
        let selected=${JSON.stringify(target)},picks=0,renders=0,writes=0,held=false,release;const assets=new HyperAssets(()=>${JSON.stringify(temporary)});
        ipcMain.handle('pick',()=>{picks++;return selected});ipcMain.handle('state',()=>({picks,renders,writes}));ipcMain.handle('cancel',()=>{selected=null});ipcMain.handle('hold',(_,target)=>{selected=target;held=true});ipcMain.handle('release',()=>{release?.();held=false});
        ipcMain.handle('render',async(_,html)=>{renders++;if(held)await new Promise(resolve=>release=resolve);return hyperRenderDocumentPdf(html)});
        ipcMain.handle('write',async(_,target,bytes)=>{await assets.writeExportBytes(target,bytes);writes++});ipcMain.handle('valid',async(_,target)=>{try{return(await fs.readFile(target)).subarray(0,5).toString()==='%PDF-'}catch{return false}});
        app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});win.webContents.focus();try{console.log(await win.webContents.executeJavaScript(await fs.readFile(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}});
      `);
      await build({ input: main, platform: 'node', external: ['electron', /^node:/], output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')], { timeout: 55_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper PDF menu checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 100_000);
});
