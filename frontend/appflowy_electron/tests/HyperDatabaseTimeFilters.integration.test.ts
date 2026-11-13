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
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32'
  ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');

describe('Hyper Time property filters in Electron', () => {
  it('authors exact whole-minute criteria and preserves read-only, future and legacy values', async () => {
    expect(fs.existsSync(executable), 'Install Electron before running this integration test.').toBe(true);
    if (process.platform === 'linux') expect(process.env.DISPLAY, 'A desktop display is required.').toBeTruthy();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-time-filter-ui-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export const useTr=()=>({tr});');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';
        import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {HyperDatabaseFilters} from '@/features/database/HyperDatabaseFilters';
        import {createHyperDatabaseStore} from '@/features/database/HyperDatabaseStore';
        import {FieldPBSchema,FieldType,RepeatedFieldPBSchema} from '@shared/protobuf/flowy-database2/field_entities_pb';
        import {DatabasePBSchema} from '@shared/protobuf/flowy-database2/database_entities_pb';
        import {DatabaseLayoutPB,DatabaseViewSettingPBSchema,DatabaseSettingChangesetPBSchema} from '@shared/protobuf/flowy-database2/setting_entities_pb';
        import {TimeFilterPBSchema} from '@shared/protobuf/flowy-database2/time_filter_pb';
        import {FilterPBSchema,RepeatedFilterPBSchema} from '@shared/protobuf/flowy-database2/util_pb';
        import {ViewPBSchema} from '@shared/protobuf/flowy-folder/view_pb';
        import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';
        import {UserProfilePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {AuthTypePB,WorkspaceTypePB} from '@shared/protobuf/flowy-user/workspace_pb';
        window.hyperTimeFilterChecks=(async()=>{
          const assert=(ok,label)=>{if(!ok)throw Error(label)};
          const wait=async(check,label='Time filter state')=>{const end=performance.now()+7000;while(!check()){
            if(performance.now()>end)throw Error('Timed out '+label+' DOM '+document.body.textContent.slice(-4000));
            await new Promise(resolve=>setTimeout(resolve,10));}};
          const pause=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const host=document.createElement('div');document.body.append(host);
          const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent===label);
          const input=()=>host.querySelector('[aria-label="Filter value"]');
          const condition=()=>host.querySelector('[aria-label="Filter condition"]');
          const field=create(FieldPBSchema,{id:'duration',name:'Duration',fieldType:FieldType.Time});
          const bytes=(condition,content)=>toBinary(TimeFilterPBSchema,create(TimeFilterPBSchema,{condition,content}));
          const leaf=(id,data)=>create(FilterPBSchema,{id,oneOfData:{case:'data',value:{fieldId:field.id,fieldType:FieldType.Time,data}}});
          let filters=[],canWrite=true,locked=false;const writes=[];
          const reply=(schema,value)=>({status:0,payload:toBinary(schema,create(schema,value))});
          // Fake only the native wire boundary. The production store, repository,
          // decoder, write guards, list and editor are used without substitution.
          window.appflowy={core:{onNotification:()=>()=>{},request:async(event,payload)=>{
            if(event==='GetDatabase')return reply(DatabasePBSchema,{id:'database',layoutType:DatabaseLayoutPB.Grid});
            if(event==='GetFields')return reply(RepeatedFieldPBSchema,{items:[field]});
            if(event==='GetDatabaseSetting')return reply(DatabaseViewSettingPBSchema,{layoutType:DatabaseLayoutPB.Grid,filters:{items:filters}});
            if(event==='GetAllFieldSettings'||event==='GetAllCalculations')return{status:0,payload:new Uint8Array()};
            if(event==='GetAllFilters')return reply(RepeatedFilterPBSchema,{items:filters});
            if(event==='GetView')return reply(ViewPBSchema,{id:'view',oneOfIsLocked:{case:'isLocked',value:locked}});
            if(event==='GetUserProfile')return reply(UserProfilePBSchema,{id:1n,userAuthType:AuthTypePB.Local,workspaceType:WorkspaceTypePB.LocalW});
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});
            if(event==='UpdateDatabaseSetting'){
              const change=fromBinary(DatabaseSettingChangesetPBSchema,payload);writes.push(change);
              if(change.oneOfInsertFilter.case){const data=change.oneOfInsertFilter.value.data;filters=[...filters,leaf('time-'+writes.length,data.data)];}
              else if(change.oneOfUpdateFilterData.case){const update=change.oneOfUpdateFilterData.value;filters=filters.map(value=>value.id===update.filterId?leaf(value.id,update.data.data):value);}
              else if(change.oneOfDeleteFilter.case)filters=filters.filter(value=>value.id!==change.oneOfDeleteFilter.value.filterId);
              return{status:0,payload:new Uint8Array()};
            }
            throw Error('Unexpected fixture event '+event);
          }}};
          const store=createHyperDatabaseStore('view'),stop=store.start();await wait(()=>store.getState().snapshot);
          const owner={contextKey:'disposable-time-ui',workspaceId:'workspace',actorId:'1',isCurrent:()=>true};
          const app=createRoot(host);function Harness(){const state=useStore(store);return <HyperDatabaseFilters store={store} owner={owner} editable={canWrite&&!state.writing} canWrite={canWrite}/>;}
          const render=()=>app.render(<Harness/>);render();await wait(()=>host.querySelector('[aria-label="Filter property"]'));
          host.querySelector('[aria-label="Filter property"]').click();await wait(()=>document.querySelector('[role="option"]'));
          [...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='Duration').click();await wait(()=>!button('Add property filter').disabled);
          const operators=['Equals','Does not equal','Is greater than','Is less than','Is greater than or equal to','Is less than or equal to','Is empty','Is not empty'];
          const choose=async label=>{condition().click();await wait(()=>document.querySelector('[role="listbox"]'));
            const options=[...document.querySelectorAll('[role="option"]')];assert(options.map(node=>node.textContent).join('|')===operators.join('|'),'all eight Time comparison/presence operators are exposed');
            options.find(node=>node.textContent===label).click();await wait(()=>!document.querySelector('[role="listbox"]'));};
          const openNew=async()=>{button('Add property filter').click();await wait(()=>condition()&&input());
            assert(host.textContent.includes('Enter whole minutes, for example 90 for 1h 30m.'),'Time explains integer-minute units');
            assert(input().type==='text'&&input().inputMode==='numeric','Time input retains exact text while requesting a numeric keyboard');};
          const expected=['9007199254740993','-90','89','91','9223372036854775807','-9223372036854775808','',''];
          for(let index=0;index<operators.length;index++){
            await openNew();enter(input(),index<6?expected[index]:'ignored prior value');await pause();await choose(operators[index]);
            if(index>=6)assert(!input(),'presence operators hide the minute value');
            await wait(()=>!button('Add property filter').disabled);button('Add property filter').click();
            await wait(()=>writes.length===index+1&&!button('Save filter')&&!condition(),'successful Time filter authoring');
            const saved=fromBinary(TimeFilterPBSchema,writes[index].oneOfInsertFilter.value.data.data);
            assert(saved.condition===index&&saved.content===expected[index],'exact Time condition/content '+operators[index]);
            assert(writes[index].oneOfInsertFilter.value.data.fieldType===FieldType.Time,'Time remains its own property type');
          }
          assert(host.textContent.includes('9007199254740993 min'),'saved large Time criterion displays its exact minute unit');
          assert(filters.length===8&&writes.length===8,'each supported choice sends exactly one setting mutation');

          await openNew();
          const invalid=[['Equals',''],['Equals','1.5'],['Equals','1e3'],['Equals','1E3'],['Equals','NaN'],['Equals','Infinity'],['Equals',' 90'],['Equals','90 '],
            ['Equals','9223372036854775808'],['Equals','-9223372036854775809'],['Is greater than','9223372036854775807'],['Is less than','-9223372036854775808']];
          for(const[operator,value]of invalid){
            await choose(operator);enter(input(),value);await wait(()=>button('Add property filter').disabled&&host.textContent.includes('Enter whole minutes within the supported range.'),'invalid criterion '+operator+' '+value);
            host.querySelector('form').requestSubmit();await pause();assert(writes.length===8,'invalid integer/boundary criteria never dispatch a setting write');
          }
          button('Cancel').click();await wait(()=>!condition());
          canWrite=false;render();await pause();host.querySelector('[aria-label="Edit property filter: Duration"]').click();await wait(()=>button('Save filter'));
          assert(input().disabled&&input().value==='9007199254740993'&&condition().disabled&&button('Save filter').disabled&&button('Remove filter').disabled,'read-only inspection preserves precise input and disables every mutation');
          button('Cancel').click();await wait(()=>!condition());assert(writes.length===8,'read-only inspection sends no write');

          canWrite=true;render();await pause();
          host.querySelector('[aria-label="Edit property filter: Duration"]').click();await wait(()=>button('Save filter'));enter(input(),'9007199254740995');await wait(()=>!button('Save filter').disabled);
          locked=true;button('Save filter').click();await wait(()=>host.textContent.includes('read-only'));assert(writes.length===8,'fresh permission guard blocks a stale enabled Time editor');
          locked=false;button('Cancel').click();await wait(()=>!condition());
          const future=new Uint8Array([...bytes(0,'90'),0x98,0x06,0x01]);
          const legacy=[future,bytes(300,'90'),bytes(0,'1.5'),bytes(0,'1e3'),bytes(0,'9223372036854775808'),bytes(2,'9223372036854775807'),bytes(3,'-9223372036854775808'),bytes(6,'90'),bytes(7,'leftover'),new Uint8Array([0xff])];
          filters=legacy.map((data,index)=>leaf('legacy-'+index,data));const originals=filters.map(value=>Array.from(toBinary(FilterPBSchema,value)).join(','));
          await store.refresh();await wait(()=>host.querySelectorAll('[aria-label="Edit property filter: Duration"]').length===10);
          for(let index=0;index<legacy.length;index++){
            const summary=host.querySelectorAll('[aria-label="Edit property filter: Duration"]')[index];
            assert(summary.textContent.includes('cannot safely edit'),'legacy summary does not misstate the native predicate '+index);
            summary.click();await wait(()=>button('Cancel'));
            assert(host.textContent.includes('cannot safely edit')&&(!button('Save filter')||button('Save filter').disabled),'unknown/legacy Time criterion is inspect-only '+index);
            if(input())assert(input().disabled,'legacy minute text cannot be normalized by editing');if(condition())assert(condition().disabled,'legacy condition cannot be reinterpreted');
            button('Cancel').click();await wait(()=>!button('Cancel'));
            assert(Array.from(toBinary(FilterPBSchema,filters[index])).join(',')===originals[index],'inspection preserves exact unknown/legacy protobuf bytes '+index);
          }
          assert(writes.length===8,'all unsupported inspections preserve existing criteria without a write');
          app.unmount();stop();return 'Hyper Time filter editor and list checks passed';
        })();
      `);
      const bundle = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'time-filter-locale', resolveId(source) {
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand', 'zustand/vanilla'].includes(source)) return resolvePackage(source);
          return null;
        } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundle.output.find(chunk => chunk.type === 'chunk');
      if (code?.type !== 'chunk') throw Error('No Time filter fixture bundle.');
      const checks = path.join(temporary, 'checks.js'); fs.writeFileSync(checks, code.code + '\nwindow.hyperTimeFilterChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `
        const{app,BrowserWindow}=require('electron'),fs=require('node:fs');
        app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
          await window.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});
          try{console.log(await window.webContents.executeJavaScript(fs.readFileSync(${JSON.stringify(checks)},'utf8')));app.exit(0);}
          catch(error){console.error(error.stack);app.exit(1);}
        }).catch(error=>{console.error(error);app.exit(1);});
      `);
      const { stdout, stderr } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main],
        { timeout: 55_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout, stderr).toContain('Hyper Time filter editor and list checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 70_000);
});
