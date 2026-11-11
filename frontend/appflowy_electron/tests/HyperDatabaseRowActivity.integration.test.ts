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
(available ? describe : describe.skip)('Hyper database visible-row providers in Electron', () => {
  it('activates read-only windows, shares pane sources and keeps children through failure, retry and close/reopen', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-row-activity-ui-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), workspace = path.join(temporary, 'workspace.ts'), reminders = path.join(temporary, 'reminders.ts');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export const useTr=()=>({tr});');
      fs.writeFileSync(workspace, "import {create} from 'zustand';export const useWorkspaceStore=create(()=>({currentWorkspace:{workspaceId:'workspace'},userProfile:{id:1n},actionResult:null}));");
      fs.writeFileSync(reminders, 'export const reminderActions={refresh:async()=>{}};');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React,{StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';
        import {HyperDatabaseRowActivityProvider,HyperDatabaseRowActivityRows,HyperDatabaseRowActivityNotice} from '@/features/database/HyperDatabaseRowActivityView';
        import {hyperGetDocumentOwner} from '@/features/document/HyperDocumentOwner';
        import {useAppStore} from '@/startup/app-store';import {useWorkspaceStore} from '@/features/sidebar/stores/workspace-store';
        window.hyperRowActivityChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check,label)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Timed out '+label);await new Promise(resolve=>setTimeout(resolve,10));}};
          const frame=()=>new Promise(resolve=>setTimeout(resolve,30));
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const calls=[],pins=new Map(),pending=[],staleContexts=new Set();let fail=false,hold=false,activations=0,refreshes=0,holdRefresh=false,rejectRefresh=null;
          const backend={updateRowActivity:async request=>{
            calls.push({...request,rowIds:[...request.rowIds]});
            const result={contextId:request.contextId,activityId:request.activityId,revision:request.revision};
            if(request.closeActivity){pins.delete(request.activityId);return result;}
            if(staleContexts.has(request.contextId))throw Error('Unenrolled stale context');
            if(!request.rowIds.length){pins.delete(request.activityId);return result;}
            pins.set(request.activityId,new Set(request.rowIds));
            if(hold)return await new Promise(resolve=>pending.push(()=>resolve(result)));
            if(fail)throw Error('Fixture subscription failure');return result;
          }};
          let rowsA=Array.from({length:200},(_,index)=>'row-'+index),rowsB=['row-0','shared'];
          let showA=true,showB=true,contextA='view-context',contextB='view-context',readOnly=true;
          useAppStore.setState({dataDirectory:'/disposable/row-activity',env:null});
          function Pane({name,rows,contextId}){const[draft,setDraft]=useState('Saved');return <section data-pane={name}><HyperDatabaseRowActivityProvider owner={hyperGetDocumentOwner()} databaseId="database" viewId="view" contextId={contextId} backend={backend} activated={()=>{activations++;}} refreshContext={async()=>{refreshes++;if(holdRefresh)return await new Promise((resolve,reject)=>{rejectRefresh=reject});if(contextId==='stale-enrollment'){contextB='fresh-enrollment';render();return contextB;}return contextId;}}>
            <HyperDatabaseRowActivityRows rowIds={rows}/><HyperDatabaseRowActivityRows rowIds={rows.slice(0,1)}/><HyperDatabaseRowActivityNotice/>
            <input aria-label={'Draft '+name} value={draft} disabled={readOnly} onChange={event=>setDraft(event.target.value)}/>
          </HyperDatabaseRowActivityProvider></section>}
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
          const render=()=>app.render(<StrictMode>{showA&&<Pane key="A" name="A" rows={rowsA} contextId={contextA}/>} {showB&&<Pane key="B" name="B" rows={rowsB} contextId={contextB}/>}</StrictMode>);
          render();await wait(()=>pins.size===2&&activations===2,'read-only subscriptions');
          assert(host.querySelector('[aria-label="Draft A"]').disabled,'read-only input remains disabled');
          const firstA=calls.find(call=>call.rowIds.length===200),firstB=calls.find(call=>call.rowIds.includes('shared'));
          assert(firstA&&firstB&&firstA.activityId!==firstB.activityId,'linked panes own separate activity IDs');
          assert(calls.filter(call=>call.rowIds.length).length===2,'StrictMode and duplicate detail sources do not multiply requests');
          readOnly=false;render();await wait(()=>!host.querySelector('[aria-label="Draft B"]').disabled,'editable draft');
          const input=host.querySelector('[aria-label="Draft B"]');input.focus();enter(input,'LOCAL UNSAVED');await wait(()=>input.value==='LOCAL UNSAVED','dirty input');
          rowsA=Array.from({length:446},(_,index)=>'calendar-'+index);render();await wait(()=>calls.some(call=>call.rowIds.length===446),'maximum calendar set');
          rowsA=[];render();await wait(()=>calls.some(call=>call.activityId===firstA.activityId&&!call.rowIds.length&&!call.closeActivity),'live empty pane');
          showA=false;render();await wait(()=>calls.some(call=>call.activityId===firstA.activityId&&call.closeActivity),'closing first pane');assert(pins.size===1,'only linked pane pins remain');
          assert(calls.some(call=>call.activityId===firstA.activityId&&call.closeActivity),'pane disposal has a terminal marker');
          assert(pins.get(firstB.activityId)?.has('shared'),'closing linked pane retains the other pane subscriptions');
          fail=true;rowsB=['later-page'];render();await wait(()=>host.querySelector('[data-hyper-row-activity-error]'),'visible error');
          assert(input.isConnected&&input.value==='LOCAL UNSAVED','activation error preserves dirty child and focus identity');
          const failedCount=calls.length;await frame();await frame();assert(calls.length===failedCount,'no automatic retry after accepted failure');
          fail=false;const retry=host.querySelector('[data-hyper-row-activity-error] button');retry.focus();assert(document.activeElement===retry,'retry is keyboard focusable');retry.click();
          await wait(()=>!host.querySelector('[data-hyper-row-activity-error]')&&calls.length===failedCount+1,'explicit retry');
          assert(host.querySelector('[aria-label="Draft B"]')===input&&input.value==='LOCAL UNSAVED','retry retains unsent child state');
          const previousB=calls.at(-1);contextB='reopened-view-context';render();await wait(()=>calls.some(call=>call.contextId===contextB&&call.rowIds.includes('later-page')),'new view context');
          const reopened=calls.find(call=>call.contextId===contextB&&call.rowIds.length);
          assert(reopened.activityId!==previousB.activityId,'view reopen allocates a fresh activity identity');
          assert(calls.some(call=>call.activityId===previousB.activityId&&!call.rowIds.length),'old context receives its own release');
          assert(input.isConnected&&input.value==='LOCAL UNSAVED','context replacement does not remount draft children');
          hold=true;rowsB=['aba-pending'];render();await wait(()=>pending.length===1,'ABA slow activation');
          const obsolete=calls.at(-1),beforeABA=activations;hold=false;pins.clear();
          useWorkspaceStore.setState({userProfile:{id:2n}});useWorkspaceStore.setState({userProfile:{id:1n}});
          await wait(()=>calls.some(call=>call.activityId!==obsolete.activityId&&call.rowIds.includes('aba-pending')),'fresh provider after synchronous owner ABA');
          pending[0]();await frame();assert(activations===beforeABA+1,'old owner activation stays ignored while fresh scope activates');
          assert(input.isConnected&&input.value==='LOCAL UNSAVED','owner epoch recapture keeps same final owner draft');
          fail=true;rowsB=['retry-aba'];render();await wait(()=>host.querySelector('[data-hyper-row-activity-error]'),'retry ABA error');
          holdRefresh=true;host.querySelector('[data-hyper-row-activity-error] button').click();await wait(()=>rejectRefresh,'pending scoped context read');
          fail=false;pins.clear();useWorkspaceStore.setState({userProfile:{id:2n}});useWorkspaceStore.setState({userProfile:{id:1n}});holdRefresh=false;
          await wait(()=>!host.querySelector('[data-hyper-row-activity-error]'),'fresh epoch active');rejectRefresh(Error('Late obsolete context read failed'));await frame();
          assert(!host.querySelector('[data-hyper-row-activity-error]'),'old retry error cannot surface after owner ABA');
          pending.length=0;hold=true;rowsB=['pending-page'];render();await wait(()=>pending.length===1,'slow activation');
          const held=calls.at(-1);showB=false;render();await wait(()=>calls.some(call=>call.activityId===held.activityId&&!call.rowIds.length&&call.revision>held.revision),'urgent higher release');
          const before=activations;pending[0]();await frame();assert(activations===before,'late activation cannot revive an unmounted pane');assert(pins.size===0,'all pane pins released');
          const beforeEnrollmentRefresh=refreshes;contextB='stale-enrollment';rowsB=[];staleContexts.add('stale-enrollment');staleContexts.add('fresh-enrollment');hold=false;showB=true;render();
          await wait(()=>calls.some(call=>call.contextId==='fresh-enrollment'&&!call.closeActivity),'one fresh context enrollment');
          await frame();assert(refreshes===beforeEnrollmentRefresh+1,'first enrollment failure performs only one safe context read');
          assert(host.querySelector('[data-hyper-row-activity-error]'),'second enrollment failure stays at explicit retry');
          const failedEnrollmentCalls=calls.length;await frame();assert(calls.length===failedEnrollmentCalls,'no enrollment retry loop');
          staleContexts.clear();host.querySelector('[data-hyper-row-activity-error] button').click();await wait(()=>!host.querySelector('[data-hyper-row-activity-error]'),'explicit enrollment retry');
          assert(calls.some(call=>call.contextId==='fresh-enrollment'&&!call.rowIds.length&&!call.closeActivity),'empty pane enrolls live');
          app.unmount();await frame();assert(calls.at(-1).closeActivity,'final empty pane terminal disposal');return 'Hyper row activity UI checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'isolated-row-activity-ui', resolveId(source) {
          if (source.endsWith('/workspace-store')) return workspace;
          if (source.endsWith('/reminder-store')) return reminders;
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source);
          return null;
        } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk');
      if (code?.type !== 'chunk') throw new Error('No row activity integration bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperRowActivityChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});win.focus();win.webContents.focus();try{const result=await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log(result);app.exit(0);}catch(error){console.error(error.stack);app.exit(1);}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper row activity UI checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 35_000);
});
