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

describe('Hyper advanced filter groups in Electron', () => {
  it('preserves nested criteria and quarantines unconfirmed structural changes without replay', async () => {
    expect(fs.existsSync(executable), 'Install Electron before running this integration test.').toBe(true);
    if (process.platform === 'linux') expect(process.env.DISPLAY, 'A desktop display is required.').toBeTruthy();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-filter-groups-ui-'));
    try {
      const entry = path.join(temporary, 'renderer.tsx'), i18n = path.join(temporary, 'i18n.ts');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export const useTr=()=>({tr});');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';
        import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {HyperDatabaseFilterGroups} from '@/features/database/HyperDatabaseFilterGroups';
        import {createHyperDatabaseStore} from '@/features/database/HyperDatabaseStore';
        import {hyperGetDocumentOwner} from '@/features/document/HyperDocumentOwner';
        import {useWorkspaceStore} from '@/features/sidebar/stores/workspace-store';import {useAppStore} from '@/startup/app-store';
        import {FieldPBSchema,FieldType,RepeatedFieldPBSchema} from '@shared/protobuf/flowy-database2/field_entities_pb';
        import {DatabasePBSchema} from '@shared/protobuf/flowy-database2/database_entities_pb';
        import {DatabaseLayoutPB,DatabaseViewSettingPBSchema,DatabaseSettingChangesetPBSchema} from '@shared/protobuf/flowy-database2/setting_entities_pb';
        import {FilterPBSchema,RepeatedFilterPBSchema,FilterType} from '@shared/protobuf/flowy-database2/util_pb';
        import {TextFilterPBSchema} from '@shared/protobuf/flowy-database2/text_filter_pb';
        import {ViewPBSchema,ViewLayoutPB} from '@shared/protobuf/flowy-folder/view_pb';import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';
        import {UserProfilePBSchema,UserWorkspacePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {AuthTypePB,WorkspaceTypePB} from '@shared/protobuf/flowy-user/workspace_pb';
        import {FlowyErrorSchema} from '@shared/protobuf/flowy-error/errors_pb';
        window.hyperFilterGroupChecks=(async()=>{
          const assert=(ok,label)=>{if(!ok)throw Error(label)};let stage='initial tree';
          const wait=async(check,label=stage)=>{const end=performance.now()+7000;while(!check()){
            if(performance.now()>end)throw Error('Timed out '+label+' DOM '+document.body.textContent.slice(-5000));await new Promise(resolve=>setTimeout(resolve,10));}};
          const pause=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          useAppStore.setState({dataDirectory:'/disposable/filter-groups-A'});
          useWorkspaceStore.setState({userProfile:create(UserProfilePBSchema,{id:1n,userAuthType:AuthTypePB.Local,workspaceType:WorkspaceTypePB.LocalW}),currentWorkspace:create(UserWorkspacePBSchema,{workspaceId:'workspace'}),actionResult:null});
          const field=create(FieldPBSchema,{id:'title',name:'Title',fieldType:FieldType.RichText});
          const text=content=>toBinary(TextFilterPBSchema,create(TextFilterPBSchema,{condition:2,content}));
          const leaf=(id,content)=>create(FilterPBSchema,{id,oneOfData:{case:'data',value:{fieldId:field.id,fieldType:field.fieldType,data:text(content)}}});
          const encode=value=>Array.from(toBinary(FilterPBSchema,value)).join(',');
          let filters=[create(FilterPBSchema,{id:'outer',filterType:FilterType.And,children:[leaf('left','outside 🌍'),create(FilterPBSchema,{id:'inner',filterType:FilterType.Or,children:[leaf('target','existing criterion'),leaf('sibling','untouched sibling')]})]})];
          const walk=(items,id)=>{for(const item of items){if(item.id===id)return item;const found=walk(item.children,id);if(found)return found;}return null;};
          const originalTarget=encode(walk(filters,'target')),originalSibling=encode(walk(filters,'sibling')),originalLeft=encode(walk(filters,'left'));
          let canWrite=true,locked=false,uncertain=false,readGate=null,releaseRead=null,gateHits=0,privateReadError=false,filterReads=0;
          const writes=[],copies=[],reply=(schema,value)=>({status:0,payload:toBinary(schema,create(schema,value))});
          window.appflowy={clipboard:{writeText:value=>copies.push(value)},core:{onNotification:()=>()=>{},request:async(event,payload)=>{
            if(event==='GetDatabase')return reply(DatabasePBSchema,{id:'database',layoutType:DatabaseLayoutPB.Grid});
            if(event==='GetFields')return reply(RepeatedFieldPBSchema,{items:[field]});
            if(event==='GetDatabaseSetting'){filterReads++;return reply(DatabaseViewSettingPBSchema,{layoutType:DatabaseLayoutPB.Grid,filters:{items:filters}});}
            if(event==='GetAllFieldSettings'||event==='GetAllCalculations')return{status:0,payload:new Uint8Array()};
            if(event==='GetAllFilters'){filterReads++;if(readGate){gateHits++;await readGate;}if(privateReadError)return{status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:'Retired owner private details'}))};return reply(RepeatedFilterPBSchema,{items:filters});}
            if(event==='GetView')return reply(ViewPBSchema,{id:'view',layout:ViewLayoutPB.Grid,oneOfIsLocked:{case:'isLocked',value:locked}});
            if(event==='GetUserProfile')return reply(UserProfilePBSchema,{id:1n,userAuthType:AuthTypePB.Local,workspaceType:WorkspaceTypePB.LocalW});
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});
            if(event==='UpdateDatabaseSetting'){
              const change=fromBinary(DatabaseSettingChangesetPBSchema,payload);writes.push(change);
              if(change.oneOfInsertFilter.case){const insert=change.oneOfInsertFilter.value,parent=walk(filters,insert.oneOfParentFilterId.value);
                assert(parent,'criterion insertion keeps its captured native parent');
                if(parent.filterType===FilterType.Data){const old=create(FilterPBSchema,{...parent,id:'retained-'+writes.length});parent.filterType=FilterType.And;parent.oneOfData={case:undefined};parent.children=[old];}
                parent.children.push(create(FilterPBSchema,{id:'inserted-'+writes.length,oneOfData:{case:'data',value:insert.data}}));
              }else if(change.oneOfUpdateFilterType.case){const update=change.oneOfUpdateFilterType.value;walk(filters,update.filterId).filterType=update.filterType;}
              else if(change.oneOfDeleteFilter.case){const id=change.oneOfDeleteFilter.value.filterId;const remove=items=>items.filter(item=>item.id!==id).map(item=>{item.children=remove(item.children);return item;});filters=remove(filters);}
              else throw Error('Unexpected structural mutation type');
              if(uncertain){uncertain=false;return{status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:'Fixture acknowledgement lost after commit'}))};}
              return{status:0,payload:new Uint8Array()};
            }
            throw Error('Unexpected group fixture event '+event);
          }}};
          const store=createHyperDatabaseStore('view'),stop=store.start();await wait(()=>store.getState().snapshot);
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);let mountGeneration=0;
          function Harness(){const state=useStore(store);return <HyperDatabaseFilterGroups store={store} owner={hyperGetDocumentOwner()} editable={canWrite&&!state.writing} canWrite={canWrite}/>;}
          const render=()=>app.render(<Harness key={mountGeneration}/>);render();
          const node=id=>host.querySelector('[data-hyper-filter-node="'+id+'"]');
          const button=(label,container=document)=>[...container.querySelectorAll('button')].find(item=>item.textContent===label);
          const match=id=>node(id)?.querySelector('[aria-label="Group match"]');
          const choose=async(id,label)=>{match(id).click();await wait(()=>document.querySelector('[role="listbox"]'));
            [...document.querySelectorAll('[role="option"]')].find(item=>item.textContent===label).click();await wait(()=>!document.querySelector('[role="listbox"]'));};
          const add=async(id,content)=>{button('Add criterion',node(id)).click();await wait(()=>document.querySelector('[role="dialog"]'));
            const property=document.querySelector('[role="dialog"] [aria-label="Filter property"]');property.click();await wait(()=>document.querySelector('[role="option"]'));
            [...document.querySelectorAll('[role="option"]')].find(item=>item.textContent==='Title').click();
            await wait(()=>document.querySelector('[role="dialog"] [aria-label="Filter value"]'));
            enter(document.querySelector('[role="dialog"] [aria-label="Filter value"]'),content);await wait(()=>!button('Add property filter').disabled);};
          await wait(()=>node('outer')&&node('inner')&&node('target'));
          assert(node('outer').contains(node('inner'))&&node('inner').contains(node('target')),'native ancestors remain visibly nested');
          assert(writes.length===0,'opening nested filters never normalizes source');
          await add('target','new criterion 🌍');button('Add property filter').click();await wait(()=>writes.length===1&&!document.querySelector('[role="dialog"]')&&match('target'));
          assert(writes[0].oneOfInsertFilter.case==='insertFilter'&&writes[0].oneOfInsertFilter.value.oneOfParentFilterId.case==='parentFilterId'&&writes[0].oneOfInsertFilter.value.oneOfParentFilterId.value==='target','one explicit insert uses the exact captured child target');
          assert(!writes[0].oneOfUpdateFilterType.case&&walk(filters,'target').filterType===FilterType.And,'creation does not chain a second OR mutation');
          const retained=walk(filters,'retained-1');assert(retained.id!=='target'&&encode(create(FilterPBSchema,{...retained,id:'target'}))===originalTarget,'old criterion survives under its authoritative fresh child ID');
          assert(walk(filters,'target').children[1].id==='inserted-1'&&fromBinary(TextFilterPBSchema,walk(filters,'inserted-1').oneOfData.value.data).content==='new criterion 🌍','new criterion is read from its authoritative child');
          assert(encode(walk(filters,'left'))===originalLeft&&encode(walk(filters,'sibling'))===originalSibling,'adding a nested child preserves all other source bytes');
          const beforeChildren=walk(filters,'target').children.map(encode).join('|');await choose('target','Match any');
          await wait(()=>writes.length===2&&walk(filters,'target').filterType===FilterType.Or&&!store.getState().writing);
          assert(writes[1].oneOfUpdateFilterType.value.filterId==='target'&&walk(filters,'target').children.map(encode).join('|')===beforeChildren,'AND to OR sends one type-only mutation and preserves child IDs and criteria');
          const outerChildren=walk(filters,'outer').children.map(encode).join('|');match('outer').focus();
          match('outer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[role="listbox"]'));
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]')&&document.activeElement===match('outer'));
          assert(writes.length===2,'keyboard inspection has no mutation');
          match('outer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[role="listbox"]'));
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[role="option"][data-highlighted]')?.textContent==='Match any');
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>writes.length===3&&!store.getState().writing&&document.activeElement===match('outer'));
          assert(walk(filters,'outer').filterType===FilterType.Or&&walk(filters,'outer').children.map(encode).join('|')===outerChildren,'keyboard match change keeps nested child context and source');

          stage='nested removal';const keptSibling=encode(walk(filters,'sibling'));button('Remove filter',node('target')).click();await wait(()=>writes.length===4&&!node('target')&&!store.getState().writing);
          assert(writes[3].oneOfDeleteFilter.case==='deleteFilter'&&writes[3].oneOfDeleteFilter.value.filterId==='target'&&!writes[3].oneOfUpdateFilterType.case&&!writes[3].oneOfInsertFilter.case,'explicit nested removal sends only one exact DeleteFilter action');
          assert(node('inner').contains(node('sibling'))&&encode(walk(filters,'sibling'))===keptSibling&&encode(walk(filters,'left'))===originalLeft,'removing one nested group preserves parent and sibling criteria');

          stage='changed captured child';await add('left','stale draft');walk(filters,'left').oneOfData.value.data=text('remote criterion');await store.refresh();
          button('Add property filter').click();await wait(()=>!store.getState().writing&&document.body.textContent.toLowerCase().includes('changed'));
          assert(writes.length===4&&fromBinary(TextFilterPBSchema,walk(filters,'left').oneOfData.value.data).content==='remote criterion','changed captured child refuses structural edit without overwriting remote criteria');
          button('Cancel').click();await wait(()=>!document.querySelector('[role="dialog"]'));
          stage='read-only inspection';canWrite=false;render();await pause();assert(match('outer').disabled&&[...host.querySelectorAll('button')].filter(item=>item.textContent==='Add criterion').every(item=>item.disabled),'read-only groups have no mutation controls');
          assert([...host.querySelectorAll('button')].filter(item=>item.textContent==='Remove filter').every(item=>item.disabled),'read-only nested groups cannot be removed');
          assert(writes.length===4,'read-only tree inspection sends no writes');canWrite=true;render();await pause();
          stage='fresh lock refusal';locked=true;await choose('outer','Match all');await wait(()=>!store.getState().writing&&host.textContent.toLowerCase().includes('read-only'));
          assert(writes.length===4&&walk(filters,'outer').filterType===FilterType.Or,'fresh permission guard refuses a stale enabled group match control');locked=false;

          stage='owner generation preflight';readGate=new Promise(resolve=>{releaseRead=resolve;});gateHits=0;await choose('outer','Match all');await wait(()=>gateHits>0);
          useAppStore.setState({dataDirectory:'/disposable/filter-groups-B'});useAppStore.setState({dataDirectory:'/disposable/filter-groups-A'});
          useAppStore.setState({launchId:useAppStore.getState().launchId+1});privateReadError=true;readGate=null;releaseRead();
          await wait(()=>!store.getState().writing);assert(writes.length===4&&!document.body.textContent.includes('Retired owner private details'),'realm ABA and launch change retire pending group work and private errors');
          stage='fresh owner remount';privateReadError=false;const oldPanel=node('outer');mountGeneration++;render();await wait(()=>node('outer')!==oldPanel&&match('outer')&&!match('outer').disabled);
          stage='uncertain acknowledgement quarantine';uncertain=true;await choose('outer','Match all');await wait(()=>writes.length===5&&host.textContent.includes('The filter change could not be confirmed'));
          assert(walk(filters,'outer').filterType===FilterType.And,'uncertain wire fixture committed the actual change before losing its ACK');
          assert(match('outer').disabled&&[...host.querySelectorAll('button')].filter(item=>item.textContent==='Add criterion').every(item=>item.disabled),'an accepted uncertain structural action is quarantined');
          button('Copy change details').click();assert(copies.length===1,'recovery details can be copied without a native mutation');
          const recoveryDetails=JSON.parse(copies[0]);assert(recoveryDetails.operation==='change-filter-group-type'&&recoveryDetails.anchor.filter.id==='outer'&&recoveryDetails.anchor.filter.filterType===FilterType.Or&&recoveryDetails.action.filterType===FilterType.And,'recovery retains the exact original target and intended type change');
          const beforeRefresh=filterReads;button('Refresh filters').click();await wait(()=>filterReads>beforeRefresh&&match('outer').textContent.includes('Match all'));
          assert(writes.length===5&&button('Dismiss recovery')&&match('outer').disabled,'refresh reads authoritative filters but never replays a change or clears quarantine');
          button('Dismiss recovery').click();await pause();assert(writes.length===5,'explicit dismissal does not repeat a structural mutation');

          const unknown=leaf('future','kept');unknown.oneOfData.value.data=new Uint8Array([...text('kept'),0x98,0x06,0x01]);filters.push(unknown);
          const saved=filters.map(encode).join('|');await store.refresh();await wait(()=>node('future'));
          assert([...host.querySelectorAll('[aria-label="Group match"]')].every(item=>item.disabled)&&[...host.querySelectorAll('button')].filter(item=>item.textContent==='Add criterion').every(item=>item.disabled),'an unsupported observed forest remains structural read-only');
          assert([...host.querySelectorAll('button')].filter(item=>item.textContent==='Remove filter').every(item=>item.disabled),'unsupported forest inspection cannot remove or rewrite another subtree');
          await pause();assert(filters.map(encode).join('|')===saved&&writes.length===5,'unknown criteria and all siblings stay byte-exact during inspection');
          app.unmount();stop();return 'Hyper advanced filter group controls passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'filter-groups-locale', resolveId(source) {
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand', 'zustand/vanilla'].includes(source)) return resolvePackage(source);
          return null;
        } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const chunk = bundled.output.find(item => item.type === 'chunk');
      if (chunk?.type !== 'chunk') throw Error('No filter group fixture bundle.');
      const checks = path.join(temporary, 'checks.js'); fs.writeFileSync(checks, chunk.code + '\nwindow.hyperFilterGroupChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `
        const{app,BrowserWindow}=require('electron'),fs=require('node:fs');app.whenReady().then(async()=>{
          const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
          await window.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});
          try{console.log(await window.webContents.executeJavaScript(fs.readFileSync(${JSON.stringify(checks)},'utf8')));app.exit(0);}
          catch(error){console.error(error.stack);app.exit(1);}
        }).catch(error=>{console.error(error);app.exit(1)});
      `);
      const { stdout, stderr } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main],
        { timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout, stderr).toContain('Hyper advanced filter group controls passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 75_000);
});
