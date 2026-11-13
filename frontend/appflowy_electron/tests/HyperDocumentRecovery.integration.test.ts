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
(available ? describe : describe.skip)('Hyper explicit document recovery in Electron', () => {
  it('keeps failed drafts until confirmed saved reads succeed, updates shared panes, and rejects stale owners', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-document-recovery-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), scope = path.join(temporary, 'scope.ts'), appearance = path.join(temporary, 'appearance.ts');
      const banner = path.join(temporary, 'banner.ts'), access = path.join(temporary, 'access.ts');
      fs.writeFileSync(i18n, `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))};export function tr(key,options={}){let value=key.split('.').reduce((value,key)=>value?.[key],en)??key;for(const[name,replacement]of Object.entries(options.namedArgs??{}))value=value.replaceAll('{'+name+'}',String(replacement));return value}export function useTr(){return {tr}}`);
      fs.appendFileSync(i18n, '\nexport const resolveLocale=value=>value;export const setLocale=()=>{};');
      fs.writeFileSync(scope, 'export const usePageAccessLevel=()=>null;export const useViewPluginNotifier=()=>null;export const useViewScope=()=>null;export const ViewScopeProvider=({children})=>children;');
      fs.writeFileSync(appearance, 'export const useDocumentFontSize=()=>({fontSize:16});');
      fs.writeFileSync(banner, 'export const DocumentBanner=()=>null;export const deletePermanently=async()=>true;export const restorePage=async()=>true;');
      fs.writeFileSync(access, "export const ShareAccessLevel={fullAccess:'fullAccess',readAndWrite:'readAndWrite',readAndComment:'readAndComment',readOnly:'readOnly'};export const isEditable=state=>!state.isLocked;export const viewIsLocked=view=>view.oneOfIsLocked?.case==='isLocked'&&view.oneOfIsLocked.value;");
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {clone,create} from '@bufbuild/protobuf';
        import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';
        import {HyperDocumentEditor} from '@/features/document/HyperDocumentPage';
        import {HyperDocumentSession} from '@/features/document/HyperDocumentSession';
        import {hyperSetSelection} from '@/features/document/HyperDocumentDom';
        window.hyperRecoveryChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check,label='')=>{const deadline=Date.now()+6000;while(!check()){if(Date.now()>deadline)throw Error('Timed out '+label+': '+check);await new Promise(resolve=>setTimeout(resolve,10));}};
          const copied=[],unexpected=[];
          window.appflowy={clipboard:{writeText:value=>copied.push(value)},core:{onNotification:()=>()=>{},onPortMessage:()=>()=>{},request:async event=>{unexpected.push(event);throw Error('Unexpected core event '+event)}}};
          const model=text=>create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',childrenId:'children',data:'{}'},p:{id:'p',ty:'paragraph',parentId:'root',childrenId:'p-children',data:JSON.stringify({delta:[{insert:text}]})}},meta:{childrenMap:{children:{children:['p']},'p-children':{children:[]}}}});
          function fixture(id,scope){
            const control={saved:model('Saved before failure'),failWrites:true,holdReads:false,opens:[],reads:[],applies:[],closes:[],jobs:[],listeners:0};
            let session;
            const backend={open:async documentId=>{control.opens.push(documentId);if(control.holdReads)return await new Promise((resolve,reject)=>control.jobs.push({resolve:value=>resolve(clone(DocumentDataPBSchema,value)),reject}));return clone(DocumentDataPBSchema,control.saved)},read:async documentId=>{control.reads.push(documentId);return clone(DocumentDataPBSchema,control.saved)},apply:async(documentId,actions)=>{control.applies.push({documentId,actions});if(control.failWrites)throw Error('Fixture save failed');control.saved=clone(DocumentDataPBSchema,session.store.getState().document)},close:async id=>{control.closes.push(id)},history:async()=>{throw Error('Recovery must not invoke history')},listen:()=>{control.listeners++;return()=>{control.listeners--}}};
            session=new HyperDocumentSession(id,backend,scope);
            return {session,control};
          }
          const host=document.createElement('div');document.body.append(host);
          let app=createRoot(host);
          const mount=session=>app.render(<><section data-pane="main"><HyperDocumentEditor session={session} title="Recovery page" editable/></section><section data-pane="side"><HyperDocumentEditor session={session} title="Recovery page" editable/></section></>);
          const pane=name=>host.querySelector('[data-pane="'+name+'"]');
          const editor=name=>pane(name)?.querySelector('[data-hyper-text="p"]');
          const both=text=>editor('main')?.textContent===text&&editor('side')?.textContent===text;
          const button=(container,label)=>[...container.querySelectorAll('button')].find(button=>button.textContent===label);
          const type=(name,text)=>{const element=editor(name);element.focus();element.textContent=text;hyperSetSelection(element,{start:text.length,end:text.length});element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));};
          const dialog=()=>document.querySelector('[role="alertdialog"]');
          const confirm=async(name='main')=>{button(pane(name),'Reload saved page').click();await wait(dialog,'confirmation opens');assert(dialog().textContent.includes('every open pane'),'confirmation explains shared-pane replacement');button(dialog(),'Discard and reload').click();await wait(()=>!dialog(),'confirmation closes');};
          const {session,control}=fixture('recovery-document');await session.flush();mount(session);await wait(()=>both('Saved before failure'));
          type('main','First failed local edit');type('main','Final failed local draft 🌍');await session.flush().catch(()=>{});await wait(()=>both('Final failed local draft 🌍')&&session.store.getState().status==='error');
          assert(control.applies.length===1,'later queued actions are retained optimistically but not dispatched after the first failure');
          assert(editor('main').contentEditable==='false'&&editor('side').contentEditable==='false','both failed panes prevent further edits');
          button(pane('main'),'Copy unsaved content').click();assert(copied.at(-1).includes('Final failed local draft 🌍'),'failed draft remains exportable before recovery');
          button(pane('main'),'Reload saved page').click();await wait(dialog);assert(control.opens.length===1,'opening confirmation does not read or write');
          const keep=button(dialog(),'Keep draft');await wait(()=>document.activeElement===keep,'safe initial focus');keep.click();await wait(()=>!dialog());
          assert(control.opens.length===1&&control.applies.length===1&&both('Final failed local draft 🌍'),'Keep draft makes no backend call and keeps every pane unchanged');
          control.holdReads=true;
          for(let attempt=0;attempt<2;attempt++){
            await confirm(attempt?'side':'main');await wait(()=>control.jobs.length===attempt+1,'saved read starts');
            assert(session.store.getState().historyPending&&both('Final failed local draft 🌍'),'pending saved read keeps draft in both panes');
            assert(button(pane('main'),'Reload saved page').disabled&&button(pane('side'),'Reload saved page').disabled,'only one recovery read can run');
            control.jobs[attempt].reject(Error('Fixture saved-read failure '+attempt));await wait(()=>!session.store.getState().historyPending&&session.store.getState().status==='error');
            assert(both('Final failed local draft 🌍')&&control.applies.length===1,'repeated read failure never discards draft or replays queued writes');
          }
          control.saved=model('Saved on disk version two');await confirm();await wait(()=>control.jobs.length===3);
          assert(both('Final failed local draft 🌍'),'confirmed draft is retained until successful response');control.jobs[2].resolve(control.saved);
          await wait(()=>session.store.getState().status==='ready'&&!session.store.getState().historyPending&&both('Saved on disk version two'));
          assert(control.applies.length===1&&control.reads.length===0,'reload opens saved document and does not reapply or refresh failed changes');
          assert(!pane('main').querySelector('[role="alert"]')&&!pane('side').querySelector('[role="alert"]'),'successful shared recovery clears stale errors in every pane');
          assert(editor('main').contentEditable==='true'&&editor('side').contentEditable==='true','recovered panes are editable again');
          control.failWrites=false;type('side','Fresh edit after recovery');await session.flush();await wait(()=>both('Fresh edit after recovery'));
          assert(control.applies.length===2,'only a new explicit edit dispatches after recovery');
          app.unmount();assert(await session.dispose(),'recovered session closes cleanly');assert(control.closes.length===1&&control.listeners===0,'recovery releases shared listener and core handle');
          app=createRoot(host);let currentOwner=true;
          const scoped=fixture('scoped-document',{workspaceId:'workspace-fixture',actorId:'actor-fixture',contextKey:'native-recovery',isCurrent:()=>currentOwner});
          await scoped.session.flush();mount(scoped.session);await wait(()=>both('Saved before failure'));type('main','Original owner failed draft');await scoped.session.flush().catch(()=>{});await wait(()=>both('Original owner failed draft')&&scoped.session.store.getState().status==='error');
          button(pane('main'),'Reload saved page').click();await wait(dialog);currentOwner=false;button(dialog(),'Discard and reload').click();await wait(()=>!dialog());await new Promise(resolve=>setTimeout(resolve,20));
          assert(scoped.control.opens.length===1&&scoped.control.applies.length===1&&both('Original owner failed draft'),'owner loss while confirmation is open blocks backend reads and keeps original draft');
          currentOwner=true;scoped.control.holdReads=true;await confirm('side');await wait(()=>scoped.control.jobs.length===1);currentOwner=false;scoped.control.jobs[0].resolve(model('Snapshot from a changed owner'));
          await wait(()=>!scoped.session.store.getState().historyPending);assert(scoped.session.store.getState().status==='error'&&both('Original owner failed draft'),'owner loss during a saved read rejects its result in both panes');
          const opens=scoped.control.opens.length;await scoped.session.reloadSaved().catch(()=>{});assert(scoped.control.opens.length===opens&&scoped.control.applies.length===1,'stale owner cannot perform a later reload or replay');
          button(pane('side'),'Copy unsaved content').click();assert(copied.at(-1).includes('Original owner failed draft'),'blocked recovery keeps original draft available for copying');
          assert(unexpected.length===0,'recovery does not start unrelated native operations');app.unmount();await scoped.session.dispose();
          return 'Hyper explicit recovery checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'isolated-document-recovery', resolveId(source) {
        if (source.endsWith('/view-scope')) return scope;
        if (source.endsWith('/document-appearance-store')) return appearance;
        if (source.endsWith('/DocumentBanner')) return banner;
        if (source.endsWith('/page-access-level-store')) return access;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk');if (code?.type !== 'chunk') throw new Error('No document recovery integration bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperRecoveryChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});win.webContents.focus();try{const result=await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log(result);app.exit(0);}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 90_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper explicit recovery checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 150_000);
});
