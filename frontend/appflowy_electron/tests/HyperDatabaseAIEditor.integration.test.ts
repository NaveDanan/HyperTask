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
const available = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
(available ? describe : describe.skip)('Hyper database AI field controls in Electron', () => {
  it('requires source selection, previews a stream, selects model/language, applies explicitly and enforces read-only controls', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-database-ai-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), workspace = path.join(temporary, 'workspace.ts'), backend = path.join(temporary, 'backend.ts');
      fs.writeFileSync(i18n, 'export function useTr(){return {tr:key=>key}}');
      fs.writeFileSync(workspace, "import {create} from 'zustand';export const useWorkspaceStore=create(()=>({currentWorkspace:{workspaceId:'workspace'},userProfile:{id:1n}}));");
      fs.writeFileSync(backend, "export const hyperDatabaseAIRowDocument='$row-document';export const hyperDatabaseAIBackend=()=>window.fixtureBackend;");
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create} from '@bufbuild/protobuf';
        import {HyperDatabaseAICell} from '@/features/database/HyperDatabaseAICell';
        import {FieldPBSchema,FieldType} from '@shared/protobuf/flowy-database2/field_entities_pb';
        import {AIModelPBSchema,ModelSelectionPBSchema,CompleteTextTaskPBSchema} from '@shared/protobuf/flowy-ai/entities_pb';
        window.hyperAIChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Timed out: '+check);await new Promise(resolve=>setTimeout(resolve,10));}};
          const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
          const context={viewId:'view',rowId:'row',fieldId:'ai',fieldType:FieldType.Translate,workspaceId:'workspace',actorId:'1'};
          const requests=[],writes=[],models=[],copies=[];let listener=()=>{},saved='Original translation',stamp='original';
          const modelA=create(AIModelPBSchema,{name:'Model A'}),modelB=create(AIModelPBSchema,{name:'Model B'});
          window.appflowy={clipboard:{writeText:value=>copies.push(value)}};
          window.fixtureBackend={read:async()=>({context,target:{text:saved,stamp,language:'French'},sources:[{id:'title',name:'Source title',text:'Selected fact',stamp:'title-stamp'},{id:'private',name:'Unselected property',text:'Private value',stamp:'private-stamp'}]}),write:async(context,text)=>{writes.push(text);saved=text;stamp='updated'},ai:{models:async()=>create(ModelSelectionPBSchema,{models:[modelA,modelB],selectedModel:modelA}),selectModel:async(source,model)=>models.push([source,model.name]),stop:async()=>{},openPort:callback=>{listener=callback;return{port:5n,close:()=>{}}},complete:async request=>{requests.push(request);setTimeout(()=>{listener('data:Reviewed translation 🌍');listener('finish:')},20);return create(CompleteTextTaskPBSchema,{taskId:'task'})}}};
          const field=create(FieldPBSchema,{id:'ai',name:'Translation',fieldType:FieldType.Translate});
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
          const props={repository:{},viewId:'view',rowId:'row',field,value:saved,editable:true,saving:false,save:async operation=>{await operation();return true}};
          app.render(<HyperDatabaseAICell {...props}/>);await wait(()=>container.querySelector('[aria-label="Review AI field: Translation"]'));container.querySelector('button').click();
          await wait(()=>document.querySelector('[aria-label="Source title"]')&&document.querySelector('[aria-label="Target language"]')?.value==='French');
          assert(requests.length===0&&writes.length===0,'opening an AI field never generates or writes');assert(button('Generate').disabled,'source selection is explicit');
          document.querySelector('[aria-label="Source title"]').click();await wait(()=>!button('Generate').disabled);
          const modelPicker=document.querySelector('[aria-label="Model"]');modelPicker.click();await wait(()=>[...document.querySelectorAll('[role="option"]')].some(option=>option.textContent==='Model B'));
          [...document.querySelectorAll('[role="option"]')].find(option=>option.textContent==='Model B').click();await wait(()=>models.length===1);assert(models[0][0]==='view'&&models[0][1]==='Model B','selected model is scoped to database view');
          const language=document.querySelector('[aria-label="Target language"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(language,'Spanish');language.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>language.value==='Spanish');
          button('Generate').click();await wait(()=>document.querySelector('[aria-label="Generated result"]')?.textContent.includes('Reviewed translation'));
          assert(requests.length===1&&requests[0].action==='translate'&&requests[0].language==='Spanish','selected language reaches generation');assert(requests[0].sourceText==='Source title:\\nSelected fact','unselected properties are excluded');assert(writes.length===0&&saved==='Original translation','stream preview keeps original value');
          button('Copy result').click();assert(copies[0]==='Reviewed translation 🌍','copy does not write the cell');await wait(()=>!button('Replace cell with result').disabled);button('Replace cell with result').click();await wait(()=>writes.length===1&&button('Replace cell with result').disabled);assert(saved==='Reviewed translation 🌍','explicit replacement saves reviewed result');
          app.unmount();const readOnly=createRoot(container),beforeReadOnly=requests.length;readOnly.render(<HyperDatabaseAICell {...props} value={saved} editable={false}/>);await wait(()=>container.querySelector('button'));assert(!container.querySelector('button').disabled,'read-only cell can open its saved value');container.querySelector('button').click();await wait(()=>document.querySelector('[aria-label="Saved cell value"]'));assert(document.querySelector('[aria-label="Saved cell value"]').textContent==='Reviewed translation 🌍','read-only body exposes the complete saved value');assert(!button('Generate')&&!button('Replace cell with result')&&requests.length===beforeReadOnly,'read-only opening performs no generation or writes');button('Copy result').click();assert(copies.at(-1)==='Reviewed translation 🌍','read-only saved value can be copied');readOnly.unmount();return 'Hyper database AI editor checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'isolated-ai-field-context', resolveId(source) {
        if (source.endsWith('/workspace-store')) return workspace;
        if (source.endsWith('/HyperDatabaseAIBackend')) return backend;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No native AI field bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperAIChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper database AI editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 35_000);
});
