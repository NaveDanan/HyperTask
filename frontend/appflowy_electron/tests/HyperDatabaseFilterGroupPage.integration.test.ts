import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { coreBinaryPath } from '../src/main/core/binary';

const root = path.resolve(__dirname, '..');
const resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const binary = coreBinaryPath(root, false);
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32'
  ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');

async function binaryHash() {
  const hash = createHash('sha256');
  for await (const part of fs.createReadStream(binary)) hash.update(part);
  return hash.digest('hex');
}

describe('Hyper filter groups in the actual Page, preload and core', () => {
  it('preserves native source and child IDs through grouping, membership changes, deletion and restart', async () => {
    expect(fs.existsSync(binary), 'Build the native core before this integration test.').toBe(true);
    expect(fs.existsSync(executable), 'Install Electron before this integration test.').toBe(true);
    if (process.platform === 'linux') expect(process.env.DISPLAY, 'A desktop display is required.').toBeTruthy();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-filter-group-page-'));
    const before = await binaryHash();
    try {
      const preload = path.join(temporary, 'preload.cjs'), renderer = path.join(temporary, 'renderer.tsx');
      const i18n = path.join(temporary, 'i18n.ts');
      fs.writeFileSync(i18n, `
        import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))};
        export const tr=(key,args={})=>{let value=key.split('.').reduce((v,k)=>v?.[k],en)??key;
          for(const[name,replacement]of Object.entries(args.namedArgs??{}))value=value.replaceAll('{'+name+'}',String(replacement));return value};
        export const useTr=()=>({tr}),resolveLocale=value=>value||'en-US',setLocale=()=>{};
      `);
      await build({ input: path.join(root, 'src/preload/index.ts'), platform: 'node', external: ['electron', /^node:/],
        resolve: { alias: { '@shared': path.join(root, 'src/shared') } }, output: { file: preload, format: 'cjs' } });
      fs.appendFileSync(preload, `
        (()=>{const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',
          Object.fromEntries(['ready','state','lock','restart'].map(name=>[name,(...args)=>ipcRenderer.invoke('fixture:'+name,...args)])))})();
      `);
      fs.writeFileSync(renderer, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create,toBinary} from '@bufbuild/protobuf';
        import {FilterType,FilterDataPBSchema} from '@shared/protobuf/flowy-database2/util_pb';
        import {UserWorkspacePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {HyperDatabasePage} from '@/features/database/HyperDatabasePage';
        import {useWorkspaceStore} from '@/features/sidebar/stores/workspace-store';import {useAppStore} from '@/startup/app-store';
        window.hyperGroupPageChecks=(async()=>{
          const assert=(ok,label)=>{if(!ok)throw Error(label)};let stage='initial source';
          const wait=async(check,label=stage)=>{const end=performance.now()+12000;while(!await check()){
            if(performance.now()>end)throw Error('Timed out '+label+' DOM '+document.body.innerText.slice(-5000));await new Promise(resolve=>setTimeout(resolve,10));}};
          const initial=await fixture.ready();useAppStore.setState({dataDirectory:initial.root,env:{authenticatorType:0,appflowyCloudConfig:{base_url:'',ws_base_url:'',gotrue_url:'',enable_sync_trace:false,base_web_domain:''}}});
          useWorkspaceStore.setState({userProfile:initial.user,currentWorkspace:create(UserWorkspacePBSchema,{workspaceId:initial.workspaceId}),actionResult:null});
          const host=document.createElement('div');document.body.append(host);let app=createRoot(host);
          const mount=()=>app.render(<HyperDatabasePage view={initial.view} context={{}}/>);mount();
          const node=id=>document.querySelector('[data-hyper-filter-node="'+id+'"]');
          const match=id=>node(id)?.querySelector('[aria-label="Group match"]');
          const modal=()=>[...document.querySelectorAll('[role="dialog"]')].find(item=>(item.getAttribute('aria-labelledby')??'').split(' ').some(id=>document.getElementById(id)?.textContent==='Add criterion'));
          const button=(label,container=modal()??document)=>[...container.querySelectorAll('button')].find(item=>item.textContent===label);
          const dataBytes=data=>Array.from(toBinary(FilterDataPBSchema,data)).join(',');
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const uiRows=()=>[...host.querySelectorAll('button[aria-label^="Open row "]')].map(item=>item.getAttribute('aria-label').slice(9)).sort();
          const visible=async indices=>{const expected=indices.map(index=>initial.rowIds[index]).sort();await wait(async()=>{
            const state=await fixture.state();return state.rows.slice().sort().join('|')===expected.join('|')&&uiRows().join('|')===expected.join('|');},'native and Page membership '+indices);};
          const openFilters=async()=>{if(!node(initial.sourceId)){const trigger=[...host.querySelectorAll('button')].find(item=>item.textContent.startsWith('Filter'));assert(trigger,'Page filter toolbar');trigger.click();}
            await wait(()=>node(initial.sourceId),'production group component in Page filter popover');};
          const choose=async(id,label)=>{await openFilters();await wait(()=>match(id)&&!match(id).disabled&&match(id).getAttribute('aria-readonly')!=='true');match(id).click();await wait(()=>document.querySelector('[role="listbox"]'));
            [...document.querySelectorAll('[role="option"]')].find(item=>item.textContent===label).click();await wait(()=>!document.querySelector('[role="listbox"]'));};
          const add=async(id,property,content)=>{await openFilters();button('Add criterion',node(id)).click();await wait(()=>modal());
            const dialog=modal();dialog.querySelector('[aria-label="Filter property"]').click();await wait(()=>document.querySelector('[role="listbox"]'));
            [...document.querySelectorAll('[role="option"]')].find(item=>item.textContent===property).click();await wait(()=>dialog.querySelector('[aria-label="Filter condition"]'));
            if(content!==undefined){dialog.querySelector('[aria-label="Filter condition"]').click();await wait(()=>document.querySelector('[role="listbox"]'));
              [...document.querySelectorAll('[role="option"]')].find(item=>item.textContent==='Is').click();await wait(()=>dialog.querySelector('[aria-label="Filter value"]'));enter(dialog.querySelector('[aria-label="Filter value"]'),content);}
            await wait(()=>!button('Add property filter',dialog).disabled);button('Add property filter',dialog).click();await wait(()=>!modal());};
          await visible([0,1]);await openFilters();const source=(await fixture.state()).filters[0];
          assert(source.id===initial.sourceId&&source.filterType===FilterType.Data,'initial public source is a real native leaf');const originalData=dataBytes(source.oneOfData.value);
          stage='native second criterion';await add(source.id,'Flag');await visible([0]);
          let saved=await fixture.state(),group=saved.filters[0];
          assert(saved.writes.length===1&&group.id===source.id&&group.filterType===FilterType.And&&group.children.length===2,'one Page add creates one native And group');
          const redId=group.children[0].id,flag=group.children.find(item=>item.oneOfData.value?.fieldId===initial.flagId),rootChildren=group.children.map(item=>item.id).join('|');
          assert(redId!==source.id&&dataBytes(group.children[0].oneOfData.value)===originalData&&flag,'original criterion and native child IDs survive grouping');
          stage='keyboard Match any';await openFilters();match(source.id).focus();match(source.id).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
          await wait(()=>document.querySelector('[role="listbox"]'));document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
          await wait(()=>document.querySelector('[role="option"][data-highlighted]')?.textContent==='Match any');document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
          await visible([0,1,2]);await openFilters();await wait(()=>document.activeElement===match(source.id),'keyboard focus after native write');
          saved=await fixture.state();assert(saved.writes.length===2&&saved.filters[0].children.map(item=>item.id).join('|')===rootChildren,'native type change preserves every child ID');
          await choose(source.id,'Match all');await visible([0]);await choose(source.id,'Match any');await visible([0,1,2]);
          stage='nested native criterion';const flagData=dataBytes(flag.oneOfData.value);await add(flag.id,'Color','blue');await visible([0,1,2]);
          saved=await fixture.state();group=saved.filters[0];const nested=group.children.find(item=>item.id===flag.id);
          assert(saved.writes.length===5&&nested.filterType===FilterType.And&&nested.children.length===2&&nested.children[0].id!==flag.id,'nested grouping uses authoritative native IDs');
          assert(dataBytes(nested.children[0].oneOfData.value)===flagData&&group.children[0].id===redId&&dataBytes(group.children[0].oneOfData.value)===originalData,'nested add preserves both original conditions');
          await choose(flag.id,'Match any');await visible([0,1,2,3]);
          stage='delete native nested group';await openFilters();button('Remove filter',node(flag.id)).click();await visible([0,1]);
          saved=await fixture.state();assert(saved.writes.length===7&&saved.filters[0].children.length===1&&!saved.filters[0].children.some(item=>item.id===flag.id),'one actual nested DeleteFilter removes exactly that group');
          assert(saved.filters[0].children[0].id===redId&&dataBytes(saved.filters[0].children[0].oneOfData.value)===originalData,'nested deletion preserves the source criterion and ID');
          stage='fresh native LockView';await openFilters();const locked=await fixture.lock();assert(locked.oneOfIsLocked.case==='isLocked'&&locked.oneOfIsLocked.value&&!match(source.id).disabled,'native view is locked while the old picker is still enabled');
          await choose(source.id,'Match all');await wait(()=>document.body.textContent.includes('read-only or unavailable'));
          const refused=await fixture.state();assert(refused.writes.length===7&&refused.filters[0].filterType===FilterType.Or,'fresh native permission guard prevents a stale control from dispatching a write');
          stage='physical core restart';const snapshot=refused.filterBytes.join(',');app.unmount();const restarted=await fixture.restart();
          assert(restarted.filterBytes.join(',')===snapshot&&restarted.writes.length===7,'native IDs, criteria, group type and child order survive physical restart');
          initial.view=locked;useAppStore.setState({launchId:useAppStore.getState().launchId+1});app=createRoot(host);mount();await visible([0,1]);await openFilters();
          assert(match(source.id).disabled&&node(redId)&&!node(flag.id),'Page reload shows the saved tree and persistent lock');
          assert((await fixture.state()).writes.length===7,'restart and read-only inspection never normalize the filter tree');
          app.unmount();return 'Hyper filter group Page preload native restart checks passed';
        })();
      `);
      const bundle = await build({ input: renderer, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'group-page-fixture', resolveId(source) {
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand', 'zustand/vanilla'].includes(source)) return resolvePackage(source);
          return null;
        }, transform(code, id) { if (id.endsWith('/icons/FlowySvg.tsx')) return code.replace(/import\.meta\.glob\([\s\S]*?\}\)/u, '({})'); return null; } }],
        resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const chunk = bundle.output.find(item => item.type === 'chunk');
      if (chunk?.type !== 'chunk') throw Error('No filter group Page fixture bundle.');
      const checks = path.join(temporary, 'checks.js'); fs.writeFileSync(checks, chunk.code + '\nwindow.hyperGroupPageChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><html lang="en-US"><body></body></html>');
      const source = (relative: string) => JSON.stringify(path.join(root, 'src', relative)), main = path.join(temporary, 'main.ts');
      fs.writeFileSync(main, `
        import {app,BrowserWindow,ipcMain} from 'electron';import fs from 'node:fs/promises';import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {CoreProcess} from ${source('main/core/process.ts')};import {IpcChannel as C} from ${source('shared/api.ts')};
        import {FlowyErrorSchema} from ${source('shared/protobuf/flowy-error/errors_pb.ts')};
        import {SignUpPayloadPBSchema} from ${source('shared/protobuf/flowy-user/auth_pb.ts')};import {UserProfilePBSchema} from ${source('shared/protobuf/flowy-user/user_profile_pb.ts')};
        import {WorkspaceLatestPBSchema} from ${source('shared/protobuf/flowy-folder/workspace_pb.ts')};
        import {CreateViewPayloadPBSchema,ViewIdPBSchema,ViewPBSchema,ViewLayoutPB} from ${source('shared/protobuf/flowy-folder/view_pb.ts')};
        import {DatabasePBSchema,DatabaseViewIdPBSchema} from ${source('shared/protobuf/flowy-database2/database_entities_pb.ts')};
        import {CreateFieldPayloadPBSchema,FieldPBSchema,FieldType} from ${source('shared/protobuf/flowy-database2/field_entities_pb.ts')};
        import {CreateRowPayloadPBSchema,RowMetaPBSchema} from ${source('shared/protobuf/flowy-database2/row_entities_pb.ts')};
        import {CellChangesetPBSchema} from ${source('shared/protobuf/flowy-database2/cell_entities_pb.ts')};
        import {DatabaseSettingChangesetPBSchema} from ${source('shared/protobuf/flowy-database2/setting_entities_pb.ts')};
        import {RepeatedFilterPBSchema} from ${source('shared/protobuf/flowy-database2/util_pb.ts')};
        import {TextFilterPBSchema} from ${source('shared/protobuf/flowy-database2/text_filter_pb.ts')};
        const support=${JSON.stringify(temporary)},binary=${JSON.stringify(binary)},writes=[],pending=new Set();
        const cleared=Object.fromEntries(Object.keys(process.env).map(key=>[key,undefined]));
        const makeCore=()=>new CoreProcess(binary,()=>({...cleared,PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC',TMPDIR:support}));
        let core=makeCore(),win=null,initial=null;
        const config={root:support,app_version:'0.11.4',custom_app_path:support,origin_app_path:support,device_id:'hyper-filter-group-page',platform:process.platform,authenticator_type:0,appflowy_cloud_config:{base_url:'',ws_base_url:'',gotrue_url:''},envs:{}};
        const request=async(event,schema,value)=>{const reply=await core.request(event,schema?toBinary(schema,create(schema,value)):new Uint8Array());if(reply.status!==0)throw Error(event+': '+fromBinary(FlowyErrorSchema,reply.payload).msg);return reply.payload;};
        const call=async(event,output,schema,value)=>fromBinary(output,await request(event,schema,value));
        const wire=()=>core.on('notification',bytes=>win?.webContents.send(C.CoreNotification,bytes));wire();
        const state=async()=>{const database=await call('GetDatabase',DatabasePBSchema,DatabaseViewIdPBSchema,{value:initial.view.id});const filterBytes=await request('GetAllFilters',DatabaseViewIdPBSchema,{value:initial.view.id});
          return {rows:database.rows.map(row=>row.id),filters:fromBinary(RepeatedFilterPBSchema,filterBytes).items,filterBytes:Array.from(filterBytes),writes:[...writes]};};
        ipcMain.on(C.CoreLog,()=>{});ipcMain.handle(C.CoreRequest,(_,event,payload)=>{
          if(event==='UpdateDatabaseSetting')writes.push(fromBinary(DatabaseSettingChangesetPBSchema,payload));
          const request=core.request(event,payload);pending.add(request);request.finally(()=>pending.delete(request)).catch(()=>{});return request;});
        ipcMain.handle('fixture:ready',()=>initial);ipcMain.handle('fixture:state',state);
        ipcMain.handle('fixture:lock',async()=>{await request('LockView',ViewIdPBSchema,{value:initial.view.id});return call('GetView',ViewPBSchema,ViewIdPBSchema,{value:initial.view.id});});
        ipcMain.handle('fixture:restart',async()=>{await Promise.allSettled([...pending]);await core.stop();core=makeCore();wire();await core.start(()=>{});if(await core.init(config)!==0)throw Error('Group core restart failed');return state();});
        app.whenReady().then(async()=>{
          await core.start(()=>{});if(await core.init(config)!==0)throw Error('Group core init failed');
          const user=await call('SignUp',UserProfilePBSchema,SignUpPayloadPBSchema,{email:'anon@appflowy.io',name:'Group Page fixture',password:'FakeGroupPageFixtureOnly!',authType:0,deviceId:'hyper-filter-group-page'});
          const workspace=await call('GetCurrentWorkspaceSetting',WorkspaceLatestPBSchema),view=await call('CreateView',ViewPBSchema,CreateViewPayloadPBSchema,{parentViewId:workspace.workspaceId,name:'Grouped Page filters',layout:ViewLayoutPB.Grid});
          await call('GetDatabase',DatabasePBSchema,DatabaseViewIdPBSchema,{value:view.id});
          const color=await call('CreateField',FieldPBSchema,CreateFieldPayloadPBSchema,{viewId:view.id,fieldType:FieldType.RichText,oneOfFieldName:{case:'fieldName',value:'Color'}});
          const flag=await call('CreateField',FieldPBSchema,CreateFieldPayloadPBSchema,{viewId:view.id,fieldType:FieldType.Checkbox,oneOfFieldName:{case:'fieldName',value:'Flag'}});
          const rowIds=[];for(const[content,checked]of [['red','Yes'],['red','No'],['blue','Yes'],['blue','No']]){
            const row=await call('CreateRow',RowMetaPBSchema,CreateRowPayloadPBSchema,{viewId:view.id});rowIds.push(row.id);
            for(const[fieldId,cellChangeset]of [[color.id,content],[flag.id,checked]])await request('UpdateCell',CellChangesetPBSchema,{viewId:view.id,rowId:row.id,fieldId,cellChangeset});}
          await request('UpdateDatabaseSetting',DatabaseSettingChangesetPBSchema,{viewId:view.id,oneOfInsertFilter:{case:'insertFilter',value:{data:{fieldId:color.id,fieldType:FieldType.RichText,data:toBinary(TextFilterPBSchema,create(TextFilterPBSchema,{condition:0,content:'red'}))}}}});
          const filters=await call('GetAllFilters',RepeatedFilterPBSchema,DatabaseViewIdPBSchema,{value:view.id});if(filters.items.length!==1)throw Error('Native setup must create one source filter');
          initial={root:support,user,workspaceId:workspace.workspaceId,view,rowIds,colorId:color.id,flagId:flag.id,sourceId:filters.items[0].id};
          win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
          win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});
          try{console.log(await win.webContents.executeJavaScript(await fs.readFile(${JSON.stringify(checks)},'utf8')));await core.stop();app.exit(0);}
          catch(error){console.error(error.stack);await core.stop();app.exit(1);}
        }).catch(async error=>{console.error(error.stack);await core.stop();app.exit(1);});
      `);
      await build({ input: main, platform: 'node', external: ['electron', /^node:/],
        resolve: { alias: { '@shared': path.join(root, 'src/shared'), '@': path.join(root, 'src/renderer'), '@bufbuild/protobuf': resolvePackage('@bufbuild/protobuf') } },
        output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout, stderr } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')],
        { timeout: 75_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout, stderr).toContain('Hyper filter group Page preload native restart checks passed');
      expect(await binaryHash(), 'This fixture must leave the core binary unchanged.').toBe(before);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 95_000);
});
