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
const available = fs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY));
(available ? describe : describe.skip)('Hyper canvas interaction in Electron', () => {
  it('edits notes, presents frames, creates a mind map and exports SVG/PNG through accessible controls', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-canvas-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export const useTr=()=>({tr});');
      fs.writeFileSync(entry, `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {createStore} from 'zustand';
        import {create} from '@bufbuild/protobuf'; import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';
        import {HyperWhiteboard} from '@/features/whiteboard/HyperWhiteboard';
        import {hyperReadCanvas,hyperCanvasLabel} from '@/features/whiteboard/HyperWhiteboardModel';
        window.hyperCanvasResult=(async()=>{
          const assert=(condition,message)=>{if(!condition)throw Error(message)};
          const wait=async(test)=>{const end=Date.now()+5000;while(!test()){if(Date.now()>end)throw Error('Timed out: '+test);await new Promise(r=>setTimeout(r,10));}};
          const initial=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'}},meta:{childrenMap:{children:{children:[]}}}});
          const store=createStore(()=>({document:initial,status:'ready',error:null,historyPending:false}));
          const writes=[],exports=[];const session={store,isCurrentOwner:()=>true,change:build=>{const result=build(store.getState().document);writes.push(result.actions);store.setState({document:result.document});return result},history:async()=>{},flush:async()=>{}};
          window.appflowy={dialog:{saveFile:async options=>options.defaultPath},fs:{writeText:async(path,content)=>exports.push({path,content}),writeBytes:async(path,content)=>exports.push({path,content})}};
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
          app.render(<HyperWhiteboard session={session} editable={true}/>);
          const button=name=>[...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')===name||button.textContent===name);
          await wait(()=>button('Rectangle'));button('Rectangle').click();await wait(()=>!button('Add at center').disabled);button('Add at center').click();
          await wait(()=>hyperReadCanvas(store.getState().document).elements.length===1);
          const shapeId=hyperReadCanvas(store.getState().document).elements[0].id;
          await wait(()=>container.querySelector('g[data-canvas-id]')?.getAttribute('aria-pressed')==='true');
          const originalX=hyperReadCanvas(store.getState().document).elements[0].x;
          const svg=container.querySelector('svg[role="application"]');svg.focus();svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));
          await wait(()=>hyperReadCanvas(store.getState().document).elements[0].x===originalX+10);
          await wait(()=>Number(container.querySelector('g[data-canvas-id] rect').getAttribute('x'))===originalX+10);
          const before=hyperReadCanvas(store.getState().document).elements[0].x;
          svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await wait(()=>hyperReadCanvas(store.getState().document).elements[0].x===before+1);
          svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));await wait(()=>!store.getState().document.blocks[shapeId]);
          button('Note').click();await wait(()=>button('Note').getAttribute('aria-pressed')==='true');button('Add at center').click();
          await wait(()=>container.querySelector('textarea'));
          const input=container.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Shared canvas note');input.dispatchEvent(new Event('input',{bubbles:true}));
          await wait(()=>hyperCanvasLabel(hyperReadCanvas(store.getState().document).elements[0],store.getState().document)==='Shared canvas note');
          button('Frame').click();await wait(()=>button('Frame').getAttribute('aria-pressed')==='true');button('Add at center').click();
          await wait(()=>hyperReadCanvas(store.getState().document).elements.filter(e=>e.kind==='frame').length===1);button('Add at center').click();
          await wait(()=>hyperReadCanvas(store.getState().document).elements.filter(e=>e.kind==='frame').length===2);await wait(()=>!button('Present frames').disabled);button('Present frames').click();
          await wait(()=>button('Exit presentation'));assert(!button('Rectangle'),'presentation hides editing tools');button('Next frame').click();await wait(()=>[...document.querySelectorAll('[role="status"]')].some(item=>item.textContent==='2 / 2'));
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>button('Rectangle'));
          button('Mind map').click();await wait(()=>document.querySelector('textarea[aria-label="Topics"]'));
          const topics=document.querySelector('textarea[aria-label="Topics"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(topics,'Plan\\n  First\\n  Second');topics.dispatchEvent(new Event('input',{bubbles:true}));
          await new Promise(resolve=>requestAnimationFrame(resolve));button('Create mind map').click();await wait(()=>hyperReadCanvas(store.getState().document).elements.filter(e=>e.mindMapRootId&&e.kind==='note').length===3);
          await wait(()=>!document.querySelector('textarea[aria-label="Topics"]'));button('Export SVG').click();await wait(()=>exports.length===1);assert(exports[0].content.includes('Shared canvas note'),'SVG includes shared page text');assert(exports[0].content.includes('Plan'),'SVG includes mind map');
          await wait(()=>!button('Export PNG').disabled);button('Export PNG').click();await wait(()=>exports.length===2);assert([...exports[1].content.slice(0,8)].join(',')==='137,80,78,71,13,10,26,10','PNG encoded by native canvas');
          app.render(<HyperWhiteboard session={session} editable={false}/>);await wait(()=>button('Rectangle').disabled);
          assert(!button('Zoom in').disabled,'read-only zoom stays usable');assert(writes.length>=4,'writes reached document session');app.unmount();
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'isolated-canvas-test', resolveId(source) { if (source.endsWith('/i18n')) return i18n; if (['react', 'react/jsx-runtime', 'react-dom/client', 'zustand', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source); return null; } }],
        resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false,
      });
      const code = bundled.output.find(item => item.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No canvas test bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperCanvasResult`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><html><body></body></html>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log('Hyper canvas interaction passed');app.exit(0);}catch(error){console.error(error.stack);app.exit(1);}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper canvas interaction passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
