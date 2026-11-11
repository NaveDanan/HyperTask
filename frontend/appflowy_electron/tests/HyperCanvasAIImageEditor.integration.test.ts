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
(available ? describe : describe.skip)('Hyper Canvas AI image dialog in Electron', () => {
  it('previews only a trusted asset, opts in source labels, applies once and cancels a dismissed image request', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-canvas-image-ai-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), owner = path.join(temporary, 'owner.ts'), entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(i18n, 'export function useTr(){return {tr:key=>key}}');
      fs.writeFileSync(owner, 'export const hyperGetDocumentOwner=()=>window.fixtureOwner;export const useHyperDocumentOwner=()=>window.fixtureOwner;export const hyperDocumentOwnerKey=owner=>owner?JSON.stringify([owner.workspaceId,owner.actorId,owner.contextKey]):"";');
      fs.writeFileSync(entry, `
        import React from'react';import{createRoot}from'react-dom/client';import{createStore}from'zustand';import{create}from'@bufbuild/protobuf';
        import{CompleteTextTaskPBSchema}from'@shared/protobuf/flowy-ai/entities_pb';import{DocumentDataPBSchema}from'@shared/protobuf/flowy-document/entities_pb';
        import{HyperCanvasImageAI}from'@/features/canvas-ai/HyperCanvasImageAI';import{hyperCanvasImageAIBackend}from'@/features/canvas-ai/HyperCanvasImageAIStore';
        import{hyperInsertCanvasElement,hyperReadCanvas}from'@/features/whiteboard/HyperWhiteboardModel';
        window.hyperCanvasImageAIChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check)=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed out: '+check);await new Promise(resolve=>setTimeout(resolve,10));}};
          const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
          window.fixtureOwner={workspaceId:'workspace',actorId:'actor',contextKey:'test',isCurrent:()=>true};
          const base=create(DocumentDataPBSchema,{pageId:'document',blocks:{document:{id:'document',ty:'page',data:'{}',childrenId:'children'}},meta:{childrenMap:{children:{children:[]}}}});
          const original=hyperInsertCanvasElement(base,'note',{x:0,y:0,width:240,height:120},{text:'Private selected note'}),state=createStore(()=>({document:original.document,status:'ready',error:null,historyPending:false}));
          const writes=[],requests=[],imports=[],stopped=[],applied=[];const session={id:'document',store:state,belongsTo:()=>true,isCurrentOwner:()=>true,flush:async()=>{},change:build=>{const result=build(state.getState().document);writes.push(result.actions);state.setState({document:result.document});return result}};
          let listener=()=>{},slow=false;Object.assign(hyperCanvasImageAIBackend,{openPort:callback=>{listener=callback;return{port:42n,close:()=>{}}},stop:async id=>stopped.push(id),importImage:async url=>{imports.push(url);return{path:'/workspace/images/generated.png',previewUrl:'appflowy-file://local/images/generated.png',width:2,height:3,name:'generated.png',size:80}},complete:async request=>{requests.push(request);if(!slow){listener('data:![Generated image](file:///workspace/ai_generated_images/generated.png)');listener('finish:')}return create(CompleteTextTaskPBSchema,{taskId:'image-task-'+requests.length})}});
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container),props={session,editable:true,selectedIds:[original.focus.id],onApplied:id=>applied.push(id)};app.render(<HyperCanvasImageAI {...props}/>);
          await wait(()=>button('Generate image'));button('Generate image').click();await wait(()=>document.querySelector('textarea'));assert(!document.querySelector('[aria-label="Model"]'),'text models are not presented as image models');assert(requests.length===0&&imports.length===0&&writes.length===0,'opening does not generate, import or write');assert(document.querySelector('[aria-label="Include page text"]').getAttribute('aria-checked')==='false','page source defaults off');
          const type=value=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          type('Paint a tree');await wait(()=>!button('Generate').disabled);button('Generate').click();await wait(()=>document.querySelector('img')?.naturalWidth===2&&!button('Add image to canvas').disabled);
          assert(requests[0].source==='','existing page text is excluded');assert(imports[0]==='file:///workspace/ai_generated_images/generated.png','only generated artifact goes to the trusted importer');assert(document.querySelector('img').getAttribute('src').startsWith('appflowy-file://local/images/'),'preview uses managed protocol');assert(writes.length===0,'preview leaves document unchanged');button('Add image to canvas').click();await wait(()=>applied.length===1);assert(writes.length===1&&button('Add image to canvas').disabled,'explicit apply runs once');assert(hyperReadCanvas(state.getState().document).elements.some(item=>item.kind==='image'&&item.alt==='Paint a tree'),'applied image is editable canvas content');
          document.querySelector('[aria-label="Include selected canvas labels"]').click();await wait(()=>!button('Generate').disabled);button('Generate').click();await wait(()=>requests.length===2&&!button('Add image to canvas').disabled);assert(requests[1].source.includes('Private selected note'),'only opted-in selected labels are included');assert(writes.length===1,'second preview is still temporary');
          slow=true;type('Another image');await wait(()=>!button('Generate').disabled);button('Generate').click();await wait(()=>button('Stop generating'));document.querySelector('[data-slot="dialog-close"]').click();await wait(()=>stopped.includes('image-task-3'));listener('data:late');listener('finish:');assert(writes.length===1,'dismissal never writes');app.render(<HyperCanvasImageAI {...props} editable={false}/>);await wait(()=>button('Generate image').disabled);app.unmount();return'Hyper Canvas AI image editor checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'isolated-canvas-image-ai-context', resolveId(source) {
        if (source.endsWith('/HyperDocumentOwner')) return owner;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No native Canvas image AI bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperCanvasImageAIChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src appflowy-file:; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      const image = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=';
      fs.writeFileSync(main, `const{app,BrowserWindow,protocol}=require('electron');protocol.registerSchemesAsPrivileged([{scheme:'appflowy-file',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);app.whenReady().then(async()=>{protocol.handle('appflowy-file',()=>new Response(Buffer.from(${JSON.stringify(image)},'base64'),{headers:{'content-type':'image/png'}}));const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper Canvas AI image editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 40_000);
});
