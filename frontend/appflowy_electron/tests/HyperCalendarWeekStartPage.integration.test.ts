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
  for await (const chunk of fs.createReadStream(binary)) hash.update(chunk);
  return hash.digest('hex');
}

describe('Hyper calendar week start in the actual Page, preload and core', () => {
  it('keeps linked preferences, calendar dates, keyboard focus and locks through native restart', async () => {
    expect(fs.existsSync(binary), 'Build the native core before this integration test.').toBe(true);
    expect(fs.existsSync(executable), 'Install Electron before this integration test.').toBe(true);
    if (process.platform === 'linux') expect(process.env.DISPLAY, 'A desktop display is required.').toBeTruthy();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-calendar-week-start-'));
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
        (()=>{const{contextBridge,ipcRenderer}=require('electron');
          contextBridge.exposeInMainWorld('fixture',Object.fromEntries(['ready','state','lock','restart'].map(name=>[name,(...args)=>ipcRenderer.invoke('fixture:'+name,...args)])))})();
      `);
      fs.writeFileSync(renderer, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create} from '@bufbuild/protobuf';
        import {UserWorkspacePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {HyperDatabasePage} from '@/features/database/HyperDatabasePage';
        import {useWorkspaceStore} from '@/features/sidebar/stores/workspace-store';import {useAppStore} from '@/startup/app-store';
        window.hyperWeekStartChecks=(async()=>{
          const assert=(ok,label)=>{if(!ok)throw Error(label)};
          const wait=async(check,label='calendar state')=>{const end=performance.now()+10000;while(!await check()){
            if(performance.now()>end)throw Error('Timed out '+label+' DOM '+document.body.innerText.slice(-2500));
            await new Promise(resolve=>setTimeout(resolve,10));}};
          const initial=await fixture.ready();document.documentElement.lang='en-US';
          useAppStore.setState({dataDirectory:initial.root,env:{authenticatorType:0,appflowyCloudConfig:{base_url:'',ws_base_url:'',gotrue_url:'',enable_sync_trace:false,base_web_domain:''}}});
          useWorkspaceStore.setState({userProfile:initial.user,currentWorkspace:create(UserWorkspacePBSchema,{workspaceId:initial.workspaceId}),actionResult:null});
          const hosts=[document.createElement('div'),document.createElement('div')];for(const host of hosts)document.body.append(host);
          let apps=hosts.map(host=>createRoot(host)),readOnly=false;
          const mount=()=>{apps[0].render(<HyperDatabasePage view={initial.view} context={{}} readOnly={readOnly}/>);
            apps[1].render(<HyperDatabasePage view={initial.linked} context={{}}/>);};
          const trigger=(index,label='First day of week')=>hosts[index].querySelector('[aria-label="'+label+'"]');
          const grid=index=>hosts[index].querySelector('[role="grid"][data-hyper-calendar-layout]');
          const cells=index=>[...grid(index)?.querySelectorAll('[role="gridcell"]')??[]];
          const idle=index=>trigger(index)&&!trigger(index).disabled&&trigger(index).getAttribute('aria-readonly')!=='true';
          const today=index=>{const now=Date.now;Date.now=()=>Date.parse('2026-11-11T12:00:00Z');try{
            [...hosts[index].querySelectorAll('button')].find(node=>node.textContent==='Today').click();}finally{Date.now=now;}};
          const frame=async(index,kind,count,first,last)=>{await wait(()=>grid(index)?.dataset.hyperCalendarLayout===kind&&cells(index).length===count&&cells(index)[0]?.getAttribute('aria-label')===first&&cells(index).at(-1)?.getAttribute('aria-label')===last,'aligned '+kind+' grid');};
          const choose=async(index,label,control='First day of week')=>{
            await wait(()=>idle(index));const before=(await fixture.state()).writes.length;trigger(index,control).click();
            await wait(()=>document.querySelector('[role="listbox"]'),'picker opens');
            const option=[...document.querySelectorAll('[role="option"]')].find(node=>node.textContent===label);assert(option,'option '+label);option.click();
            await wait(async()=>(await fixture.state()).writes.length===before+1&&!document.querySelector('[role="listbox"]')&&idle(index),'native selection acknowledgement');
          };
          mount();await wait(()=>idle(0)&&idle(1)&&cells(0).length===42&&cells(1).length===42);today(0);today(1);
          const original=await fixture.state();assert(original.writes.length===0,'inspection and initial enrollment never write settings');
          assert(original.ranges.length===2&&original.ranges.every(range=>range.isRange),'fixture uses actual native ranges');
          assert(original.ranges[0].includeTime&&!original.ranges[1].includeTime,'fixture distinguishes timed and all-day native cells');
          assert(original.ranges[0].start===String(Date.parse('2026-11-11T07:30:00Z')/1000)&&original.ranges[1].start===String(Date.parse('2026-11-11T08:00:00Z')/1000)&&original.ranges.every(range=>range.end===String(Date.parse('2026-11-12T08:00:00Z')/1000)),'fixture saves the expected property-zone instants');
          await frame(0,'month',42,'2026-11-01','2026-12-12');await frame(1,'month',42,'2026-10-26','2026-12-06');
          trigger(0).focus();trigger(0).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
          await wait(()=>document.querySelector('[role="listbox"]'));document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
          await wait(()=>!document.querySelector('[role="listbox"]')&&document.activeElement===trigger(0),'Escape restores week-start focus');
          trigger(0).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[role="listbox"]'));
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
          await wait(()=>document.querySelector('[role="option"][data-highlighted]')?.textContent==='Monday','keyboard highlights Monday');
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
          await wait(async()=>(await fixture.state()).source.firstDayOfWeek===1&&idle(0)&&!document.querySelector('[role="listbox"]'),'keyboard selects Monday');
          await wait(()=>document.activeElement===trigger(0),'native save keeps keyboard focus');
          await frame(0,'month',42,'2026-10-26','2026-12-06');
          await choose(0,'Week','Calendar period');await frame(0,'week',7,'2026-11-09','2026-11-15');
          await choose(0,'Sunday');await frame(0,'week',7,'2026-11-08','2026-11-14');
          assert((await fixture.state()).linked.firstDayOfWeek===1,'changing the source leaves linked Monday preference intact');
          await frame(1,'month',42,'2026-10-26','2026-12-06');
          await choose(0,'Monday');await frame(0,'week',7,'2026-11-09','2026-11-15');
          await choose(1,'Sunday');await frame(1,'month',42,'2026-11-01','2026-12-12');
          assert((await fixture.state()).source.firstDayOfWeek===1,'changing linked preference leaves source Monday intact');
          await frame(0,'week',7,'2026-11-09','2026-11-15');
          await choose(0,'Month','Calendar period');await frame(0,'month',42,'2026-10-26','2026-12-06');
          await choose(0,'Sunday');await frame(0,'month',42,'2026-11-01','2026-12-12');
          await choose(1,'Monday');await frame(1,'month',42,'2026-10-26','2026-12-06');
          const saved=await fixture.state();assert(saved.writes.length===8,'each choice sends one native setting write');
          const unchanged=value=>{assert(value.source.fieldId===original.source.fieldId&&value.linked.fieldId===original.linked.fieldId,'date fields stay bound');
            assert(value.source.showWeekends===false&&value.source.showWeekNumbers===true&&value.linked.showWeekends===true&&value.linked.showWeekNumbers===false,'all view flags stay exact');
            assert(value.zone==='America/Los_Angeles'&&JSON.stringify(value.ranges)===JSON.stringify(original.ranges),'property zone and every native date/range flag stay exact');};
          unchanged(saved);
          readOnly=true;mount();await wait(()=>trigger(0)?.disabled);const first=cells(0)[0].getAttribute('aria-label');
          hosts[0].querySelector('[aria-label="Next period"]').click();await wait(()=>cells(0)[0].getAttribute('aria-label')!==first);
          assert(cells(0).length===42&&(await fixture.state()).writes.length===8,'read-only browsing sends no setting mutation');
          readOnly=false;mount();await wait(()=>idle(0));
          const locked=await fixture.lock();assert(locked.oneOfIsLocked.case==='isLocked'&&locked.oneOfIsLocked.value,'LockView really locked the native fixture');
          assert(idle(0),'permission test begins with a stale enabled control');trigger(0).click();await wait(()=>document.querySelector('[role="listbox"]'));
          [...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='Monday').click();
          await wait(()=>hosts[0].textContent.includes('read-only or unavailable')&&idle(0),'fresh native lock refusal');
          const refused=await fixture.state();assert(refused.writes.length===8&&refused.source.firstDayOfWeek===0,'fresh native lock blocks dispatch before any SetLayoutSetting');unchanged(refused);
          for(const app of apps)app.unmount();const persisted=await fixture.restart();
          assert(persisted.source.firstDayOfWeek===0&&persisted.linked.firstDayOfWeek===1,'independent native choices survive actual core restart');unchanged(persisted);
          initial.view=locked;useAppStore.setState({launchId:useAppStore.getState().launchId+1});apps=hosts.map(host=>createRoot(host));mount();
          await wait(()=>trigger(0)?.disabled&&idle(1));today(0);today(1);
          await frame(0,'month',42,'2026-11-01','2026-12-12');await frame(1,'month',42,'2026-10-26','2026-12-06');
          assert((await fixture.state()).writes.length===8,'restart and locked inspection never normalize settings');
          for(const app of apps)app.unmount();return 'Hyper calendar week-start Page preload core restart checks passed';
        })();
      `);
      const bundled = await build({ input: renderer, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'hyper-week-start-page', resolveId(source) {
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand', 'zustand/vanilla'].includes(source)) return resolvePackage(source);
          return null;
        }, transform(code, id) { if (id.endsWith('/icons/FlowySvg.tsx')) return code.replace(/import\.meta\.glob\([\s\S]*?\}\)/u, '({})'); return null; } }],
        resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const chunk = bundled.output.find(item => item.type === 'chunk');
      if (chunk?.type !== 'chunk') throw Error('No calendar Page fixture bundle.');
      const checks = path.join(temporary, 'checks.js'); fs.writeFileSync(checks, chunk.code + '\nwindow.hyperWeekStartChecks');
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
        import {CalendarLayoutPB} from ${source('shared/protobuf/flowy-database2/calendar_entities_pb.ts')};
        import {DatabaseLayoutPB,DatabaseViewSettingPBSchema,LayoutSettingChangesetPBSchema} from ${source('shared/protobuf/flowy-database2/setting_entities_pb.ts')};
        import {GetFieldPayloadPBSchema,RepeatedFieldPBSchema,TypeOptionChangesetPBSchema} from ${source('shared/protobuf/flowy-database2/field_entities_pb.ts')};
        import {DateTypeOptionPBSchema,DateCellChangesetPBSchema,DateCellDataPBSchema} from ${source('shared/protobuf/flowy-database2/date_entities_pb.ts')};
        import {CreateRowPayloadPBSchema,RowMetaPBSchema} from ${source('shared/protobuf/flowy-database2/row_entities_pb.ts')};
        import {OrderObjectPositionTypePB} from ${source('shared/protobuf/flowy-database2/position_entities_pb.ts')};
        import {CellChangesetPBSchema,CellIdPBSchema,CellPBSchema} from ${source('shared/protobuf/flowy-database2/cell_entities_pb.ts')};
        import {hyperDatabaseDateCandidates} from ${source('renderer/features/database/HyperDatabaseDate.ts')};
        const support=${JSON.stringify(temporary)},binary=${JSON.stringify(binary)},writes=[],rowIds=[];
        const cleared=Object.fromEntries(Object.keys(process.env).map(key=>[key,undefined]));
        const makeCore=()=>new CoreProcess(binary,()=>({...cleared,PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC',TMPDIR:support}));
        let core=makeCore(),win=null,initial=null,fieldId='';
        const config={root:support,app_version:'0.11.4',custom_app_path:support,origin_app_path:support,device_id:'hyper-calendar-week-start',platform:process.platform,authenticator_type:0,appflowy_cloud_config:{base_url:'',ws_base_url:'',gotrue_url:''},envs:{}};
        const request=async(event,schema,value)=>{const reply=await core.request(event,schema?toBinary(schema,create(schema,value)):new Uint8Array());if(reply.status!==0)throw Error(event+': '+fromBinary(FlowyErrorSchema,reply.payload).msg);return reply.payload;};
        const call=async(event,output,schema,value)=>fromBinary(output,await request(event,schema,value));
        const wire=()=>core.on('notification',value=>win?.webContents.send(C.CoreNotification,value));wire();
        const setting=async viewId=>(await call('GetDatabaseSetting',DatabaseViewSettingPBSchema,DatabaseViewIdPBSchema,{value:viewId})).layoutSetting.oneOfCalendar.value;
        const state=async()=>{const fields=await call('GetFields',RepeatedFieldPBSchema,GetFieldPayloadPBSchema,{viewId:initial.view.id});
          const ranges=[];for(const rowId of rowIds){const cell=await call('GetCell',CellPBSchema,CellIdPBSchema,{viewId:initial.view.id,rowId,fieldId}),date=fromBinary(DateCellDataPBSchema,cell.data);
            ranges.push({id:rowId,start:String(date.oneOfTimestamp.value),end:String(date.oneOfEndTimestamp.value),includeTime:date.includeTime,isRange:date.isRange});}
          return {source:await setting(initial.view.id),linked:await setting(initial.linked.id),writes:[...writes],ranges,zone:fromBinary(DateTypeOptionPBSchema,fields.items.find(field=>field.id===fieldId).typeOptionData).timezoneId};};
        ipcMain.on(C.CoreLog,()=>{});ipcMain.handle(C.CoreRequest,async(_,event,payload)=>{
          if(event==='SetLayoutSetting'){const input=fromBinary(LayoutSettingChangesetPBSchema,payload);writes.push({viewId:input.viewId,calendar:input.oneOfCalendar.value});}
          return core.request(event,payload);});
        ipcMain.handle('fixture:ready',()=>initial);ipcMain.handle('fixture:state',state);
        ipcMain.handle('fixture:lock',async()=>{await request('LockView',ViewIdPBSchema,{value:initial.view.id});return call('GetView',ViewPBSchema,ViewIdPBSchema,{value:initial.view.id});});
        ipcMain.handle('fixture:restart',async()=>{await core.stop();core=makeCore();wire();await core.start(()=>{});if(await core.init(config)!==0)throw Error('Calendar core restart failed');
          for(const view of [initial.view,initial.linked])await call('GetDatabase',DatabasePBSchema,DatabaseViewIdPBSchema,{value:view.id});return state();});
        app.whenReady().then(async()=>{
          await core.start(()=>{});if(await core.init(config)!==0)throw Error('Calendar core init failed');
          const user=await call('SignUp',UserProfilePBSchema,SignUpPayloadPBSchema,{email:'anon@appflowy.io',name:'Calendar week-start fixture',password:'FakeCalendarFixtureOnly!',authType:0,deviceId:'hyper-calendar-week-start'});
          const workspace=await call('GetCurrentWorkspaceSetting',WorkspaceLatestPBSchema);
          const view=await call('CreateView',ViewPBSchema,CreateViewPayloadPBSchema,{parentViewId:workspace.workspaceId,name:'Sunday calendar',layout:ViewLayoutPB.Calendar});
          const database=await call('GetDatabase',DatabasePBSchema,DatabaseViewIdPBSchema,{value:view.id});
          const linked=await call('CreateView',ViewPBSchema,CreateViewPayloadPBSchema,{parentViewId:workspace.workspaceId,name:'Monday linked calendar',layout:ViewLayoutPB.Calendar,meta:{database_id:database.id}});
          const linkedDb=await call('GetDatabase',DatabasePBSchema,DatabaseViewIdPBSchema,{value:linked.id});if(linkedDb.id!==database.id)throw Error('Fixture must use actual linked views');
          initial={root:support,user,workspaceId:workspace.workspaceId,view,linked,databaseId:database.id};
          const fields=await call('GetFields',RepeatedFieldPBSchema,GetFieldPayloadPBSchema,{viewId:view.id}),calendar=await setting(view.id);fieldId=calendar.fieldId;
          const field=fields.items.find(field=>field.id===fieldId),primary=fields.items.find(field=>field.isPrimary);if(!field||!primary)throw Error('Calendar fixture needs date and title fields');
          const options=fromBinary(DateTypeOptionPBSchema,field.typeOptionData);options.timezoneId='America/Los_Angeles';
          await request('UpdateFieldTypeOption',TypeOptionChangesetPBSchema,{viewId:view.id,fieldId,typeOptionData:toBinary(DateTypeOptionPBSchema,options)});
          for(const[target,firstDay,weekends,numbers]of [[view,0,false,true],[linked,1,true,false]]){
            const current=await setting(target.id);await request('SetLayoutSetting',LayoutSettingChangesetPBSchema,{viewId:target.id,layoutType:DatabaseLayoutPB.Calendar,
              oneOfCalendar:{case:'calendar',value:{...current,fieldId,layoutTy:CalendarLayoutPB.MonthLayout,firstDayOfWeek:firstDay,showWeekends:weekends,showWeekNumbers:numbers}}});}
          const instant=(day,time)=>hyperDatabaseDateCandidates(day,time,'America/Los_Angeles')[0];
          for(const[name,start,end,timed]of [['Timed span',instant('2026-11-10','23:30:00'),instant('2026-11-12','00:00:00'),true],['All day',instant('2026-11-11','00:00:00'),instant('2026-11-12','00:00:00'),false]]){
            const row=await call('CreateRow',RowMetaPBSchema,CreateRowPayloadPBSchema,{viewId:view.id,rowPosition:{position:OrderObjectPositionTypePB.End}});rowIds.push(row.id);
            await request('UpdateCell',CellChangesetPBSchema,{viewId:view.id,rowId:row.id,fieldId:primary.id,cellChangeset:name});
            await request('UpdateDateCell',DateCellChangesetPBSchema,{cellId:{viewId:view.id,rowId:row.id,fieldId},oneOfTimestamp:{case:'timestamp',value:start},oneOfEndTimestamp:{case:'endTimestamp',value:end},oneOfIncludeTime:{case:'includeTime',value:timed},oneOfIsRange:{case:'isRange',value:true}});}
          win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
          win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});
          try{console.log(await win.webContents.executeJavaScript(await fs.readFile(${JSON.stringify(checks)},'utf8')));await core.stop();app.exit(0);}
          catch(error){console.error(error.stack);await core.stop();app.exit(1);}
        }).catch(async error=>{console.error(error.stack);await core.stop();app.exit(1);});
      `);
      await build({ input: main, platform: 'node', external: ['electron', /^node:/],
        resolve: { alias: { '@shared': path.join(root, 'src/shared'), '@': path.join(root, 'src/renderer'), '@bufbuild/protobuf': resolvePackage('@bufbuild/protobuf') } },
        output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout, stderr } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')],
        { timeout: 65_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout, stderr).toContain('Hyper calendar week-start Page preload core restart checks passed');
      expect(await binaryHash(), 'This fixture must leave the core binary unchanged.').toBe(before);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 85_000);
});
