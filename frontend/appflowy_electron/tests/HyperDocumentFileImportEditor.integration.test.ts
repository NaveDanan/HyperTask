import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
(available ? describe : describe.skip)('Hyper file import panel in Electron', () => {
  it('keeps cancelled and failed imports open, restores loading, checks scope before picking and preserves partial successes', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-file-import-ui-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), ui = path.join(temporary, 'ui.tsx');
      fs.writeFileSync(i18n, `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))};export function tr(key,options={}){let text=key.split('.').reduce((value,part)=>value?.[part],en)??key;for(const [name,value]of Object.entries(options.namedArgs??{}))text=text.replaceAll('{'+name+'}',String(value));return text;}export function useTr(){return{tr}}`);
      fs.writeFileSync(ui, "import React from 'react';export const Spinner=()=> <span>Loading</span>;export const MaterialDialog=({children})=> <div>{children}</div>;export const showDialog=()=>{};");
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';import {UserProfilePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {ViewPBSchema,RepeatedViewPBSchema} from '@shared/protobuf/flowy-folder/view_pb';import {ImportPayloadPBSchema,ImportTypePB} from '@shared/protobuf/flowy-folder/import_pb';
        import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';import {FlowyErrorSchema} from '@shared/protobuf/flowy-error/errors_pb';import {ImportPanel} from '@/features/sidebar/import/ImportPanel';
        window.hyperChecks=(async()=>{
          let phase='cancel';const assert=(ok,message)=>{if(!ok)throw Error(message)};const wait=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed out '+phase+': '+check+'; '+document.body.textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
          let mode='cancel',paths=[],userId=1n,locked=false,picks=0,reads=0,conversions=0,imports=[],callbacks=0,closes=0,captured=false;
          const emptyDoc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'}},meta:{childrenMap:{children:{children:[]}}}});
          window.appflowy={dialog:{pickFiles:async()=>{assert(captured,'destination actor and parent captured before picker');picks++;if(mode==='picker-error')throw Error('Picker unavailable');if(mode==='actor')userId=2n;return paths;}},fs:{readText:async()=>{reads++;return mode==='unreadable'?null:'Contents'}},core:{request:async(event,payload)=>{
            const reply=(schema,value)=>({status:0,payload:toBinary(schema,create(schema,value))});const error=message=>({status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:message}))});
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});if(event==='GetUserProfile')return reply(UserProfilePBSchema,{id:userId});if(event==='GetView'){captured=true;return reply(ViewPBSchema,{id:'parent',name:'Destination',oneOfIsLocked:{case:'isLocked',value:locked}});}
            if(event==='ConvertDataToDocument'){conversions++;return mode==='convert-error'?error('Conversion unavailable'):reply(DocumentDataPBSchema,emptyDoc);}
            if(event==='ImportData'){const values=fromBinary(ImportPayloadPBSchema,payload);imports.push(values);if(mode==='native-error'||mode==='partial'&&imports.length===2)return error('Native import unavailable');return reply(RepeatedViewPBSchema,{items:[{id:'page-'+imports.length,name:values.items[0].name,parentViewId:values.parentViewId}]});}
            throw Error('Unexpected event: '+event);
          }}};
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);let key=0;const render=()=>app.render(<ImportPanel key={key} parentViewId="parent" onImported={()=>{callbacks++}} close={()=>{closes++}}/>);render();
          const markdown=()=>[...host.querySelectorAll('button')].find(button=>button.textContent.includes('Markdown'));const csv=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='CSV');const idle=()=>host.querySelector('[aria-busy="false"]');
          await wait(()=>markdown());markdown().click();await wait(()=>picks===1&&idle());assert(callbacks===0&&closes===0&&imports.length===0,'cancelled picker is not success');
          phase='unreadable';mode='unreadable';paths=['/selected/missing.md'];captured=false;markdown().click();await wait(()=>host.textContent.includes('could not be read')&&idle());assert(host.textContent.includes('missing.md')&&callbacks===0&&closes===0,'unreadable file remains visible');assert(!markdown().disabled,'safe read failure restores controls');
          phase='conversion';mode='convert-error';paths=['/selected/broken.md'];markdown().click();await wait(()=>host.textContent.includes('Conversion unavailable')&&idle());assert(imports.length===0&&callbacks===0&&closes===0,'conversion failure is not success');
          phase='actor';mode='actor';const beforeActorReads=reads;markdown().click();await wait(()=>host.textContent.includes('signed-in user changed')&&idle());assert(reads===beforeActorReads&&imports.length===0,'actor change after picker blocks file processing');userId=1n;
          phase='picker';mode='picker-error';markdown().click();await wait(()=>host.textContent.includes('Picker unavailable')&&idle());assert(!markdown().disabled&&callbacks===0,'picker failure restores loading');
          phase='native';mode='native-error';paths=['/selected/data.csv'];const beforeCSVConversions=conversions;csv().click();await wait(()=>host.textContent.includes('Native import unavailable')&&idle());assert(imports.length===1&&imports[0].items[0].importType===ImportTypePB.CSV&&conversions===beforeCSVConversions,'CSV uses native path');assert(markdown().disabled&&csv().disabled&&callbacks===0&&closes===0,'uncertain failure disables duplicate retry choices');csv().click();await new Promise(resolve=>setTimeout(resolve,20));assert(imports.length===1,'uncertain file not retried');
          phase='partial';let previous=markdown();key++;mode='partial';paths=['/selected/first.md','/selected/second.md'];imports=[];render();await wait(()=>markdown()&&markdown()!==previous);markdown().click();await wait(()=>host.textContent.includes('Native import unavailable')&&idle());assert(imports.length===2&&callbacks===1&&closes===0,'known created page reports partial success without closing');assert(host.textContent.includes('1 pages imported.')&&host.textContent.includes('second.md'),'partial result identifies failed file and retained page');
          phase='success';previous=markdown();key++;mode='success';paths=['/selected/success.csv'];imports=[];render();await wait(()=>markdown()&&markdown()!==previous);csv().click();await wait(()=>callbacks===2&&closes===1&&idle());assert(imports.length===1&&!host.textContent.includes('needs attention'),'only confirmed success closes panel');
          phase='locked';previous=markdown();key++;locked=true;captured=false;const beforeLockedPicks=picks;render();await wait(()=>markdown()&&markdown()!==previous);markdown().click();await wait(()=>host.textContent.includes('locked')&&idle());assert(picks===beforeLockedPicks,'locked destination blocked before picker');
          app.unmount();return 'Hyper file import panel checks passed';
        })();
      `);
      const result = await build({ input: entry, onwarn(warning, fallback) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') fallback(warning); }, plugins: [{ name: 'isolated-file-import', resolveId(source) { if (source.endsWith('/i18n')) return i18n; if (source === '@/ui') return ui; if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source); return null; } }], resolve: { alias: { '@/i18n': i18n, '@/ui': ui, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = result.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No file import panel bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper file import panel checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
