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
(available ? describe : describe.skip)('Hyper HTML import review in Electron', () => {
  it('reviews notices before saving, reads only selected HTML and surfaces actor/partial failures', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-html-import-ui-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'); fs.writeFileSync(i18n, 'export const tr=key=>key;export function useTr(){return{tr}}');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';import {UserProfilePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {ViewPBSchema,RepeatedViewPBSchema} from '@shared/protobuf/flowy-folder/view_pb';import {ImportPayloadPBSchema} from '@shared/protobuf/flowy-folder/import_pb';
        import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';import {FlowyErrorSchema} from '@shared/protobuf/flowy-error/errors_pb';
        import {HyperDocumentHtmlImport} from '@/features/document-import/HyperDocumentHtmlImport';import {hyperDocumentPlainText} from '@/features/document/HyperDocumentModel';
        window.hyperChecks=(async()=>{
          let phase='initial';const assert=(ok,message)=>{if(!ok)throw Error(message)};const wait=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed out '+phase+': '+check+'; '+document.body.textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
          let userId=1n,paths=['/selected/page.html'],mode='success';const reads=[],imports=[],completed=[];let closes=0;
          window.appflowy={dialog:{pickFiles:async()=>paths},fs:{readText:async path=>{reads.push(path);if(!paths.includes(path))throw Error('Unexpected file read');return '<title>Review title</title><p>Readable <strong>bold</strong> 🌍</p><img src="/private/never-read.png" alt="Saved reference">'}},core:{request:async(event,payload)=>{
            const reply=(schema,value)=>({status:0,payload:toBinary(schema,create(schema,value))});
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});if(event==='GetUserProfile')return reply(UserProfilePBSchema,{id:userId});if(event==='GetView')return reply(ViewPBSchema,{id:'parent',name:'Destination'});
            if(event==='ImportData'){const data=fromBinary(ImportPayloadPBSchema,payload);imports.push(data);if(mode==='partial'&&imports.length===2)return {status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:'Test import failure'}))};return reply(RepeatedViewPBSchema,{items:[{id:'imported-'+imports.length,parentViewId:data.parentViewId,name:data.items[0].name}]});}
            throw Error('Unexpected event: '+event);
          }}};
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);let componentKey=0;
          const render=(editable=true)=>app.render(<HyperDocumentHtmlImport key={componentKey} parentViewId="parent" editable={editable} onImported={views=>completed.push(views)} onClose={()=>{closes++}}/>);render();
          const trigger=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='HTML / Notion HTML');const save=()=>[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Import pages');const close=()=>[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Close');
          await wait(()=>trigger());trigger().click();await wait(()=>save()&&!save().disabled);assert(imports.length===0,'opening review does not write');assert(document.querySelector('[role="dialog"]').textContent.includes('Image reference retained as text'),'unsupported assets reported before save');assert(reads.join('|')==='/selected/page.html','only explicitly selected HTML is read');document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!save());assert(imports.length===0,'closing review imports nothing');
          trigger().click();await wait(()=>save()&&!save().disabled);const title=document.querySelector('input[aria-label="Page title: page.html"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,'Chosen title 🌍');title.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Chosen title 🌍'}));save().click();await wait(()=>!save());assert(imports.length===1&&imports[0].items[0].name==='Chosen title 🌍','review title reaches native import');assert(completed.length===1&&completed[0][0].id==='imported-1','created views reported to parent');const documentData=fromBinary(DocumentDataPBSchema,imports[0].items[0].oneOfData.value);assert(hyperDocumentPlainText(documentData).includes('Readable bold 🌍'),'actual parsed protobuf sent');assert(hyperDocumentPlainText(documentData).includes('/private/never-read.png'),'asset source retained as text');
          phase='actor';let oldTrigger=trigger();componentKey++;render();await wait(()=>trigger()&&trigger()!==oldTrigger);trigger().click();await wait(()=>save()&&!save().disabled);render(false);await wait(()=>save().disabled);assert(imports.length===1,'readonly review cannot import');render(true);await wait(()=>!save().disabled);userId=2n;save().click();await wait(()=>document.querySelector('[role="dialog"]').textContent.includes('signed-in user changed'));assert(imports.length===1&&save().disabled,'stale actor blocked without retry');close().click();await wait(()=>!save());
          phase='partial';oldTrigger=trigger();componentKey++;userId=1n;paths=['/selected/one.html','/selected/two.html'];imports.length=0;mode='partial';render();await wait(()=>trigger()&&trigger()!==oldTrigger);trigger().click();await wait(()=>save()&&!save().disabled);save().click();await wait(()=>document.querySelector('[role="dialog"]').textContent.includes('Test import failure'));assert(imports.length===2,'separate pages imported once each');assert(save().disabled,'partial import is not retried automatically');assert(document.querySelector('[role="dialog"]').textContent.includes('Check the sidebar'),'partial failure explains saved pages may exist');assert(completed.at(-1).length===1,'known imported page retained and reported');assert(reads.every(path=>path.startsWith('/selected/')&&path.endsWith('.html')),'no referenced image or arbitrary path read');
          app.unmount();return 'Hyper HTML import review checks passed';
        })();
      `);
      const result = await build({ input: entry, onwarn(warning, fallback) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') fallback(warning); }, plugins: [{ name: 'isolated-html-import', resolveId(source) { if (source.endsWith('/i18n')) return i18n; if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source); return null; } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = result.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No HTML import review bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper HTML import review checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
