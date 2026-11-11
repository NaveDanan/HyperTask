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
(available ? describe : describe.skip)('Hyper Canvas AI dialog in Electron', () => {
  it('chooses a model, opts in sources, previews both formats, applies once and cancels on dismissal', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-canvas-ai-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), owner = path.join(temporary, 'owner.ts'), entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(i18n, 'export function useTr(){return {tr:key=>key}}');
      fs.writeFileSync(owner, 'export const hyperGetDocumentOwner=()=>window.fixtureOwner;export const useHyperDocumentOwner=()=>window.fixtureOwner;export const hyperDocumentOwnerKey=owner=>owner?JSON.stringify([owner.workspaceId,owner.actorId,owner.contextKey]):"";');
      fs.writeFileSync(entry, `
        import React from 'react';import{createRoot}from'react-dom/client';import{createStore}from'zustand';import{create}from'@bufbuild/protobuf';
        import{AIModelPBSchema,ModelSelectionPBSchema,CompleteTextTaskPBSchema}from'@shared/protobuf/flowy-ai/entities_pb';import{DocumentDataPBSchema}from'@shared/protobuf/flowy-document/entities_pb';
        import{HyperCanvasAI}from'@/features/canvas-ai/HyperCanvasAI';import{hyperCanvasAIBackend}from'@/features/canvas-ai/HyperCanvasAIStore';
        import{hyperInsertCanvasElement,hyperReadCanvas}from'@/features/whiteboard/HyperWhiteboardModel';
        window.hyperCanvasAIChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check)=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed out: '+check);await new Promise(resolve=>setTimeout(resolve,10));}};
          const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
          window.fixtureOwner={workspaceId:'workspace',actorId:'actor',contextKey:'test',isCurrent:()=>true};
          const base=create(DocumentDataPBSchema,{pageId:'document',blocks:{document:{id:'document',ty:'page',data:'{}',childrenId:'children'}},meta:{childrenMap:{children:{children:[]}}}});
          const original=hyperInsertCanvasElement(base,'note',{x:0,y:0,width:240,height:120},{text:'Private existing note'});
          const state=createStore(()=>({document:original.document,status:'ready',error:null,historyPending:false}));const writes=[],requests=[],stopped=[],selectedModels=[],applied=[];
          const session={id:'document',store:state,belongsTo:()=>true,isCurrentOwner:()=>true,flush:async()=>{},change:build=>{const change=build(state.getState().document);writes.push(change.actions);state.setState({document:change.document});return change}};
          let listener=()=>{},slow=false;
          const modelA=create(AIModelPBSchema,{name:'Model A'}),modelB=create(AIModelPBSchema,{name:'Model B'});
          Object.assign(hyperCanvasAIBackend,{openPort:callback=>{listener=callback;return{port:42n,close:()=>{}}},models:async()=>create(ModelSelectionPBSchema,{models:[modelA,modelB],selectedModel:modelA}),selectModel:async(id,model)=>selectedModels.push([id,model.name]),stop:async id=>stopped.push(id),complete:async request=>{
            requests.push(request);if(!slow){const output=request.kind==='mindmap'?{version:1,root:{text:'Plan 🌍',children:[{text:'Build',children:[]}]}}:{version:1,slides:[{title:'Release',bullets:['Build','Test']}]};listener('data:'+JSON.stringify(output));listener('finish:')};return create(CompleteTextTaskPBSchema,{taskId:'task-'+requests.length})}});
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container),props={session,editable:true,selectedIds:[original.focus.id],onApplied:id=>applied.push(id)};
          app.render(<HyperCanvasAI {...props}/>);await wait(()=>button('Canvas AI'));button('Canvas AI').click();await wait(()=>document.querySelector('textarea'));
          assert(requests.length===0&&writes.length===0,'opening does not generate or save');assert(document.querySelector('[aria-label="Include page text"]').getAttribute('aria-checked')==='false','page source starts off');
          const picker=document.querySelector('[aria-label="Model"]');picker.click();await wait(()=>[...document.querySelectorAll('[role="option"]')].some(item=>item.textContent==='Model B'));[...document.querySelectorAll('[role="option"]')].find(item=>item.textContent==='Model B').click();await wait(()=>selectedModels.length===1);assert(selectedModels[0][0]==='document','model is scoped to the actual document');
          const type=value=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          type('Create a plan');await wait(()=>!button('Generate').disabled);button('Generate').click();await wait(()=>document.querySelector('[role="region"][aria-label="Generated canvas preview"]'));
          assert(requests[0].source==='','existing content excluded by default');assert(writes.length===0&&hyperReadCanvas(state.getState().document).elements.length===1,'mind map preview is temporary');assert(document.querySelector('[role="region"]')?.textContent.includes('Plan 🌍'),'preview contains generated labels');
          button('Add to canvas').click();await wait(()=>applied.length===1);assert(writes.length===1&&button('Add to canvas').disabled,'explicit apply runs once');assert(hyperReadCanvas(state.getState().document).elements.length===4,'mind map becomes ordinary canvas elements');
          document.querySelector('[aria-label="Create"]').click();await wait(()=>[...document.querySelectorAll('[role="option"]')].some(item=>item.textContent==='Presentation'));[...document.querySelectorAll('[role="option"]')].find(item=>item.textContent==='Presentation').click();
          document.querySelector('[aria-label="Include selected canvas labels"]').click();await wait(()=>document.querySelector('[aria-label="Include selected canvas labels"]').getAttribute('aria-checked')==='true');
          button('Generate').click();await wait(()=>document.querySelector('[role="region"]')?.textContent.includes('Release'));assert(requests[1].source.includes('Private existing note'),'only opted-in labels are sent');assert(writes.length===1,'slide preview is temporary');button('Add to canvas').click();await wait(()=>applied.length===2);assert(hyperReadCanvas(state.getState().document).elements.some(item=>item.kind==='frame'),'slides become presentation frames');
          slow=true;type('Another plan');await wait(()=>!button('Generate').disabled);button('Generate').click();await wait(()=>button('Stop generating'));document.querySelector('[data-slot="dialog-close"]').click();await wait(()=>stopped.includes('task-3'));listener('data:late');listener('finish:');assert(writes.length===2,'dismissed stream never writes');
          app.render(<HyperCanvasAI {...props} editable={false}/>);await wait(()=>button('Canvas AI').disabled);app.unmount();return'Hyper Canvas AI editor checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'isolated-canvas-ai-context', resolveId(source) {
        if (source.endsWith('/HyperDocumentOwner')) return owner;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No native Canvas AI bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperCanvasAIChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper Canvas AI editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 40_000);
});
