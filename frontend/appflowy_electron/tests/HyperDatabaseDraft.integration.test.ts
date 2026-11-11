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
(available ? describe : describe.skip)('Hyper retained database drafts in native Electron', () => {
  it('recovers actual page/store drafts after notification eviction, failed blur saves, hidden/type-changed properties, read-only changes and shared panes', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-database-draft-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), scope = path.join(temporary, 'scope.ts'), access = path.join(temporary, 'access.ts');
      const workspace = path.join(temporary, 'workspace.ts'), settings = path.join(temporary, 'settings.tsx'), rowDocument = path.join(temporary, 'row.tsx');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export function useTr(){return {tr}}');
      fs.writeFileSync(scope, 'export const usePageAccessLevel=()=>null;export const useViewPluginNotifier=()=>null;');
      fs.writeFileSync(access, "export const ShareAccessLevel={fullAccess:'fullAccess',readAndWrite:'readAndWrite',readAndComment:'readAndComment',readOnly:'readOnly'};export const viewIsLocked=view=>view.oneOfIsLocked?.case==='isLocked'&&view.oneOfIsLocked.value;");
      fs.writeFileSync(workspace, "import {create} from 'zustand';export const useWorkspaceStore=create(()=>({currentWorkspace:null,userProfile:null,actionResult:null}));");
      fs.writeFileSync(settings, "import React from 'react';export const HyperDatabaseFieldSettings=({field})=><span>{field.name}</span>;export const HyperRelationTarget=()=>null;");
      fs.writeFileSync(rowDocument, 'export const HyperRowDocument=()=>null;');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {HyperDatabasePage} from '@/features/database/HyperDatabasePage';
        import {hyperDatabaseDrafts} from '@/features/database/HyperDatabaseDraft';
        import {useWorkspaceStore} from '@/features/sidebar/stores/workspace-store';
        import {useAppStore} from '@/startup/app-store';
        import {FieldPBSchema,FieldType,RepeatedFieldPBSchema} from '@shared/protobuf/flowy-database2/field_entities_pb';
        import {DatabasePBSchema,HyperUpdateRowActivityPBSchema,HyperRowActivityAckPBSchema} from '@shared/protobuf/flowy-database2/database_entities_pb';
        import {DatabaseLayoutPB,DatabaseViewSettingPBSchema} from '@shared/protobuf/flowy-database2/setting_entities_pb';
        import {CellPBSchema,CellIdPBSchema,CellChangesetPBSchema} from '@shared/protobuf/flowy-database2/cell_entities_pb';
        import {FieldVisibility,RepeatedFieldSettingsPBSchema} from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
        import {RepeatedCalculationsPBSchema} from '@shared/protobuf/flowy-database2/calculation_entities_pb';
        import {RowMetaPBSchema,DatabaseViewRowIdPBSchema} from '@shared/protobuf/flowy-database2/row_entities_pb';
        import {ViewPBSchema,ViewLayoutPB} from '@shared/protobuf/flowy-folder/view_pb';
        import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';
        import {UserProfilePBSchema,UserWorkspacePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {AuthTypePB,WorkspaceTypePB} from '@shared/protobuf/flowy-user/workspace_pb';
        import {SubscribeObjectSchema} from '@shared/protobuf/flowy-notification/subject_pb';
        import {DatabaseNotification} from '@shared/protobuf/flowy-database2/notification_pb';
        import {FlowyErrorSchema} from '@shared/protobuf/flowy-error/errors_pb';
        window.hyperDraftChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check,label='')=>{const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)throw Error('Timed out '+label+': '+check+'; body='+host.textContent.slice(0,2500));await new Promise(resolve=>setTimeout(resolve,10));}};
          const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
          assert(document.hasFocus(),'native fixture needs focused webContents');
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const button=(container,label)=>[...container.querySelectorAll('button')].find(node=>node.textContent===label);
          const row=id=>create(RowMetaPBSchema,{id});
          const original=Array.from({length:5000},(_,index)=>row('row'+String(index).padStart(3,'0')));
          let rows=[...original],fields=[create(FieldPBSchema,{id:'primary',name:'Title',fieldType:FieldType.RichText,isPrimary:true}),create(FieldPBSchema,{id:'notes',name:'Notes',fieldType:FieldType.RichText})],fieldSettings=[];
          let actor=1n,failWrite=false,holdWrite=false,pendingWrite=null,locked=false,notification=null,reads=0;
          const values=new Map(),writes=[],copied=[];
          const view=create(ViewPBSchema,{id:'view',name:'Draft recovery dataset',layout:ViewLayoutPB.Grid});
          const profile=()=>create(UserProfilePBSchema,{id:actor,userAuthType:AuthTypePB.Local,workspaceType:WorkspaceTypePB.LocalW});
          const reply=(schema,value)=>({status:0,payload:toBinary(schema,create(schema,value))});
          const failure=message=>({status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:message}))});
          window.appflowy={clipboard:{writeText:value=>{copied.push(value)}},core:{onNotification:listener=>{notification=listener;return()=>{}},onPortMessage:()=>()=>{},request:async(event,payload)=>{
            if(event==='HyperUpdateRowActivity'){const value=fromBinary(HyperUpdateRowActivityPBSchema,payload);return reply(HyperRowActivityAckPBSchema,{contextId:value.contextId,activityId:value.activityId,revision:value.revision});}if(event==='GetDatabase')return reply(DatabasePBSchema,{id:'database',rowActivityContext:'fixture-context',rows,layoutType:DatabaseLayoutPB.Grid});
            if(event==='GetFields')return reply(RepeatedFieldPBSchema,{items:fields});
            if(event==='GetDatabaseSetting')return reply(DatabaseViewSettingPBSchema,{});
            if(event==='GetAllFieldSettings')return reply(RepeatedFieldSettingsPBSchema,{items:fieldSettings});
            if(event==='GetAllCalculations')return reply(RepeatedCalculationsPBSchema,{});
            if(event==='GetView')return reply(ViewPBSchema,{...view,oneOfIsLocked:{case:'isLocked',value:locked}});
            if(event==='GetUserProfile')return reply(UserProfilePBSchema,profile());
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});
            if(event==='GetRowMeta'){const request=fromBinary(DatabaseViewRowIdPBSchema,payload);return rows.some(row=>row.id===request.rowId)?reply(RowMetaPBSchema,{id:request.rowId}):failure('Removed row')}
            if(event==='GetCell'){reads++;const request=fromBinary(CellIdPBSchema,payload);return reply(CellPBSchema,{rowId:request.rowId,fieldId:request.fieldId,data:new TextEncoder().encode(actor===2n?'Other actor saved':values.get(request.rowId+':'+request.fieldId)??request.rowId+' '+request.fieldId)})}
            if(event==='UpdateCell'){const request=fromBinary(CellChangesetPBSchema,payload);writes.push(request);if(holdWrite)await new Promise(resolve=>{pendingWrite=resolve});if(failWrite)return failure('Fixture rejected write');values.set(request.rowId+':'+request.fieldId,request.cellChangeset);return {status:0,payload:new Uint8Array()}}
            if(event==='CreateRow'){rows=[row('new-row'),...rows];return reply(RowMetaPBSchema,{id:'new-row'})}
            throw Error('Unexpected event '+event);
          }}};
          useWorkspaceStore.setState({currentWorkspace:create(UserWorkspacePBSchema,{workspaceId:'workspace',workspaceType:WorkspaceTypePB.LocalW}),userProfile:profile()});
          useAppStore.setState({dataDirectory:'/disposable/draft-fixture'});
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
          let readOnly=false,panes=1;
          const render=()=>app.render(<>{Array.from({length:panes},(_,index)=><section data-pane={index} key={index}><HyperDatabasePage view={view} context={{}} readOnly={readOnly}/></section>)}</>);
          const pane=(index=0)=>host.querySelector('[data-pane="'+index+'"]');
          const input=(id,field='primary',index=0)=>pane(index)?.querySelector('tbody input[aria-label="'+(field==='primary'?'Title':'Notes')+' · '+id+'"]');
          const record=(id,field='primary',index=0)=>pane(index)?.querySelector('[data-hyper-draft="'+id+':'+field+'"]');
          const next=()=>pane().querySelector('[aria-label="Rows: Next"]');
          const notify=async()=>{notification(toBinary(SubscribeObjectSchema,create(SubscribeObjectSchema,{source:'Database',id:'database',ty:DatabaseNotification.DidReorderRows})));await new Promise(resolve=>setTimeout(resolve,110));};
          const discard=async(id,field='primary')=>{button(record(id,field),'Discard draft').click();await wait(()=>document.querySelector('[role="dialog"]'),'discard dialog');const dialog=document.querySelector('[role="dialog"]');assert(dialog.textContent.includes('every open pane'),'discard explains shared state');button(dialog,'Discard draft').click();await wait(()=>!record(id,field),'discard finished');};
          render();await wait(()=>pane()?.querySelectorAll('tbody input').length===100&&reads===200,'bounded actual-store grid and acknowledged row activation');assert(reads===200,'50 rows x2 fields are read and refreshed once after live activation');
          let element=input('row049');element.focus();enter(element,'LOCAL UNSAVED boundary draft');await wait(()=>record('row049'));
          rows=[row('inserted'),...original];await notify();await wait(()=>!input('row049'),'boundary eviction');
          assert(writes.length===0&&record('row049').textContent.includes('LOCAL UNSAVED boundary draft'),'focused notification eviction retains draft without a blur write');
          assert(next().disabled,'retained offscreen draft keeps navigation guard');button(record('row049'),'Copy draft').click();await tick();assert(copied.at(-1)==='LOCAL UNSAVED boundary draft','evicted text is copyable');
          button(record('row049'),'Retry save').click();await wait(()=>!record('row049'),'guarded explicit recovery save');assert(writes.length===1&&writes[0].rowId==='row049'&&writes[0].cellChangeset==='LOCAL UNSAVED boundary draft','recovery targets original evicted row');
          rows=[...original];await notify();await wait(()=>input('row049'));element=input('row049');element.focus();enter(element,'Failed blur draft');element.blur();failWrite=true;
          await wait(()=>record('row049')?.querySelector('[role="alert"]'),'real rejected blur');assert(writes.length===2,'one rejected blur request');button(pane(),'New row').click();await wait(()=>!input('row049'),'new row refresh eviction');assert(record('row049').textContent.includes('Failed blur draft'),'failed draft and retry survive New row refresh');failWrite=false;await discard('row049');
          rows=[...original];await notify();await wait(()=>input('row000','notes'));element=input('row000','notes');element.focus();enter(element,'Hidden property draft');
          fieldSettings=[{fieldId:'notes',visibility:FieldVisibility.AlwaysHidden}];await notify();await wait(()=>!input('row000','notes'),'hidden field');assert(record('row000','notes').textContent.includes('Hidden property draft'),'hidden property retains text');
          const beforeHidden=writes.length;button(record('row000','notes'),'Retry save').click();await wait(()=>record('row000','notes')?.querySelector('[role="alert"]'));assert(writes.length===beforeHidden,'fresh hidden-field guard prevents replay');button(record('row000','notes'),'Copy draft').click();await tick();assert(copied.at(-1)==='Hidden property draft');await discard('row000','notes');
          fieldSettings=[];await notify();await wait(()=>input('row000','notes'));element=input('row000','notes');element.focus();enter(element,'Original type draft');fields=[fields[0],{...fields[1],fieldType:FieldType.Number}];await notify();
          await wait(()=>input('row000','notes')?.value==='row000 notes','new type editor');assert(record('row000','notes').textContent.includes('Original type draft'),'same-ID field type change keeps original draft');const beforeType=writes.length;button(record('row000','notes'),'Retry save').click();await wait(()=>record('row000','notes')?.querySelector('[role="alert"]'));assert(writes.length===beforeType,'type-changed draft never applies to new type');await discard('row000','notes');
          element=input('row049');element.focus();enter(element,'Permission loss draft');readOnly=true;render();await wait(()=>!input('row049'));rows=[row('inserted'),...original];await notify();assert(record('row049').textContent.includes('Permission loss draft'),'read-only plus eviction retains draft');assert(button(record('row049'),'Retry save').disabled,'read-only recovery cannot write');await discard('row049');readOnly=false;rows=[...original];render();await notify();await wait(()=>input('row000'));
          panes=2;render();await wait(()=>input('row000','primary',1));element=input('row000');element.focus();enter(element,'Shared latest draft');await wait(()=>input('row000','primary',1)?.value==='Shared latest draft','second pane receives shared draft');element=input('row000','primary',1);element.focus();enter(element,'Updated in second pane');await wait(()=>input('row000')?.value==='Updated in second pane','first pane receives latest version');
          rows=original.slice(1);await notify();await wait(()=>!input('row000')&&!input('row000','primary',1));assert(record('row000')?.textContent.includes('Updated in second pane')&&record('row000','primary',1)?.textContent.includes('Updated in second pane'),'both panes retain one shared record after eviction');
          const readsBeforeSwitch=reads;actor=2n;useWorkspaceStore.setState({userProfile:profile()});await wait(()=>!record('row000')&&!record('row000','primary',1)&&input('row001')?.value==='Other actor saved','actor isolation and fresh same-view data');assert(reads>readsBeforeSwitch,'same view UUID creates a fresh owner-scoped store');actor=1n;useWorkspaceStore.setState({userProfile:profile()});await wait(()=>record('row000'),'original actor recovers private draft');await discard('row000');
          rows=[...original];await notify();await wait(()=>input('row001'));element=input('row001');element.focus();enter(element,'Before external change');values.set('row001:primary','SERVER CHANGED');rows=original.filter(row=>row.id!=='row001');await notify();await wait(()=>!input('row001'));rows=[...original];await notify();await wait(()=>input('row001'));const beforeConflict=writes.length;button(record('row001'),'Retry save').click();await wait(()=>record('row001')?.textContent.includes('saved cell or property changed'));assert(writes.length===beforeConflict&&values.get('row001:primary')==='SERVER CHANGED','source-byte conflict preserves external save');await discard('row001');await wait(()=>input('row001')?.value==='SERVER CHANGED','discard reloads current saved bytes');
          app.unmount();return 'Hyper retained database draft checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'native-draft-context', resolveId(source) {
        if (source.endsWith('/workspace-store')) return workspace;
        if (source.endsWith('/HyperDatabaseFieldSettings')) return settings;
        if (source.endsWith('/HyperRowDocument')) return rowDocument;
        if (source.endsWith('/view-scope')) return scope;
        if (source.endsWith('/page-access-level-store')) return access;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand', 'zustand/vanilla'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw Error('No database draft integration bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperDraftChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});win.webContents.focus();try{const result=await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log(result);app.exit(0);}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 90_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper retained database draft checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 100_000);
});
