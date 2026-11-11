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

(available ? describe : describe.skip)('Hyper search ownership in Electron', () => {
  it('isolates the actual palette, recents, ancestors, ports and delayed navigation for each session', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-search-owner-'));
    try {
      const entry = path.join(temporary, 'entry.tsx'), i18n = path.join(temporary, 'i18n.ts');
      const notifications = path.join(temporary, 'notifications.ts'), ports = path.join(temporary, 'ports.ts');
      const iconUrl = path.join(temporary, 'icon-url.ts');
      fs.writeFileSync(iconUrl, 'export default "icons.json";');
      fs.writeFileSync(i18n, "export const tr=(key,options)=>key+(options?.args?.length?' '+options.args.join(' '):'');export const useTr=()=>({tr});export const resolveLocale=locale=>locale||'en';export const setLocale=()=>{};");
      const notificationSource = JSON.stringify(path.join(root, 'src/renderer/backend/notifications.ts'));
      const portSource = JSON.stringify(path.join(root, 'src/renderer/backend/ports.ts'));
      fs.writeFileSync(notifications, `export*from${notificationSource};import{listen as actual}from${notificationSource};export const listen=(source,callback,id)=>{const close=actual(source,callback,id),item={source,id,callback,closed:false};window.fixtureSubscriptions.push(item);return()=>{item.closed=true;close()}};`);
      fs.writeFileSync(ports, `export*from${portSource};import{openReceivePort as actual}from${portSource};export const openReceivePort=callback=>{const port=actual(callback),item={port:port.port,callback,closed:false};window.fixturePorts.push(item);return{port:port.port,close:()=>{item.closed=true;port.close()}}};`);
      fs.writeFileSync(entry, `
        import React from'react';import{createRoot}from'react-dom/client';import{create,fromBinary,toBinary}from'@bufbuild/protobuf';
        import{CommandPaletteHost}from'@/features/search/CommandPalette';import{DialogHost}from'@/ui/Dialog';
        import{toggleCommandPalette}from'@/features/home/notifiers';
        import{refreshCachedViews,useCommandPaletteStore}from'@/features/search/command-palette-store';
        import{useRecentViewsStore}from'@/features/search/recent-views-store';
        import{useWorkspaceStore}from'@/features/sidebar/stores/workspace-store';import{useAppStore}from'@/startup/app-store';
        import{registerViewExpander,useTabsStore}from'@/features/tabs/tabs-store';import{loadKeyValueStorage}from'@/startup/kv';
        import{hyperGetDocumentOwner}from'@/features/document/HyperDocumentOwner';
        import{UserProfilePBSchema,UserWorkspacePBSchema}from'@shared/protobuf/flowy-user/user_profile_pb';
        import{ViewPBSchema,ViewIdPBSchema,RepeatedViewPBSchema,RepeatedRecentViewPBSchema}from'@shared/protobuf/flowy-folder/view_pb';
        import{SearchQueryPBSchema}from'@shared/protobuf/flowy-search/query_pb';import{SearchStatePBSchema}from'@shared/protobuf/flowy-search/notification_pb';
        import{SubscribeObjectSchema}from'@shared/protobuf/flowy-notification/subject_pb';
        window.hyperSearchOwnerChecks=(async()=>{
          const assert=(condition,message)=>{if(!condition)throw Error(message)};
          const wait=async(check,label)=>{const until=Date.now()+7000;while(!await check()){if(Date.now()>until)throw Error('Timed out '+label+' '+document.body.textContent.slice(-500));await new Promise(resolve=>setTimeout(resolve,10));}};
          const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
          const profile=id=>create(UserProfilePBSchema,{id:BigInt(id),name:'Actor '+id});
          const workspace=id=>create(UserWorkspacePBSchema,{workspaceId:id,name:'Workspace '+id});
          const environment=url=>({authenticatorType:url?3:0,appflowyCloudConfig:{base_url:url,ws_base_url:url.replace(/^http/,'ws'),gotrue_url:url,base_web_domain:'',enable_sync_trace:false}});
          useWorkspaceStore.setState({userProfile:profile(1),currentWorkspace:workspace('same-workspace'),actionResult:null});
          useAppStore.setState({dataDirectory:'/fixture/storage-A',env:environment(''),launchId:1});
          let serial=0;const tag=()=>{const ws=useWorkspaceStore.getState(),app=useAppStore.getState();return [ws.userProfile?.id,ws.currentWorkspace?.workspaceId,app.env?.appflowyCloudConfig.base_url||'local',app.dataDirectory,app.launchId,serial].join('|')};
          const page=(label='Page '+tag())=>create(ViewPBSchema,{id:'same-view',parentViewId:'ancestor',name:label});
          const success=(schema,value)=>({status:0,payload:schema?toBinary(schema,create(schema,value)):new Uint8Array()});
          let notification,portMessage;const requests=[],streams=[],pendingViews=[],pendingRecents=[],pendingAncestors=[],pendingNavigation=[],preferences=[],latest=[];
          let holdViews=false,holdRecents=false,holdAncestors=false,holdNavigation=false,holdPreference=false;
          let preferenceReply,expansions=0;window.fixtureSubscriptions=[];window.fixturePorts=[];
          window.appflowy={prefs:{getAll:async()=>({}),set:async(key,value)=>{preferences.push({key,value,owner:tag()});if(holdPreference)return new Promise(resolve=>{preferenceReply=resolve})},remove:async()=>{}},core:{
            onNotification:listener=>{notification=listener;return()=>{}},onPortMessage:listener=>{portMessage=listener;return()=>{}},request:async(event,payload)=>{
              const owner=tag();requests.push({event,owner});
              if(event==='GetAllViews'){if(holdViews)return new Promise(resolve=>pendingViews.push({owner,resolve}));return success(RepeatedViewPBSchema,{items:[page()]})}
              if(event==='ReadRecentViews'){if(holdRecents)return new Promise(resolve=>pendingRecents.push({owner,resolve}));return success(RepeatedRecentViewPBSchema,{items:[{item:page('Recent '+owner)}]})}
              if(event==='GetViewAncestors'){const query=fromBinary(ViewIdPBSchema,payload);assert(query.value==='same-view','ancestor uses stable view UUID');if(holdAncestors)return new Promise(resolve=>pendingAncestors.push({owner,resolve}));return success(RepeatedViewPBSchema,{items:[{id:'root',name:'Root',parentViewId:''},{id:'ancestor',name:'Ancestor '+owner,parentViewId:'root'},page()]})}
              if(event==='GetView'){if(holdNavigation)return new Promise(resolve=>pendingNavigation.push({owner,resolve}));return success(ViewPBSchema,page())}
              if(event==='SetLatestView'){latest.push(owner);return success()}
              if(event==='StreamSearch'){const query=fromBinary(SearchQueryPBSchema,payload);return new Promise(resolve=>streams.push({owner,query,resolve}))}
              throw Error('Unexpected fixture event '+event);
            }
          }};
          await loadKeyValueStorage();
          const emitRecent=()=>notification(toBinary(SubscribeObjectSchema,create(SubscribeObjectSchema,{source:'Workspace',id:'recent_views',ty:0,oneOfPayload:{case:'payload',value:new TextEncoder().encode('PRIVATE unrelated notification payload')}})));
          const result=(stream,name)=>toBinary(SearchStatePBSchema,create(SearchStatePBSchema,{searchId:stream.query.searchId,oneOfResponse:{case:'response',value:{oneOfLocalSearchResult:{case:'localSearchResult',value:{items:[{id:'same-view',displayName:name,workspaceId:'same-workspace'}]}}}}}));
          const input=()=>document.querySelector('.command-palette input');const palette=()=>document.querySelector('.command-palette');
          const type=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input(),value);input().dispatchEvent(new Event('input',{bubbles:true}))};
          const row=()=>document.querySelector('[data-search-cell]');
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);let mounted=false;function Mounted(){React.useEffect(()=>{mounted=true},[]);return null}app.render(<><CommandPaletteHost/><DialogHost/><Mounted/></>);await wait(()=>mounted,'host effects mounted');assert(hyperGetDocumentOwner()?.isCurrent(),'fixture owner is current');
          const open=async()=>{toggleCommandPalette.emit();await wait(()=>input()&&document.body.textContent.includes('Recent '+tag()),'fresh owner recent '+tag());assert(input().value==='','fresh owner input is empty');assert(useCommandPaletteStore.getState().combinedResponseItems.size===0,'fresh owner has no previous results');assert(!document.body.textContent.includes('PRIVATE'),'previous private content is absent');};
          await open();row().focus();await wait(()=>document.body.textContent.includes('Ancestor '+tag()),'initial ancestor path');
          holdViews=holdRecents=holdAncestors=true;void refreshCachedViews();emitRecent();
          const oldOwner=tag(),oldListener=window.fixtureSubscriptions.find(item=>item.id==='recent_views');
          type('PRIVATE previous actor query');await wait(()=>streams.length===1,'old actor stream');const oldStream=streams[0];
          portMessage(oldStream.query.streamPort,result(oldStream,'PRIVATE previous actor result'));await wait(()=>document.body.textContent.includes('PRIVATE previous actor result'),'old result');
          await wait(()=>pendingViews.length===1&&pendingRecents.length===1&&pendingAncestors.length>=1,'held previous owner reads');
          holdNavigation=true;row().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(()=>pendingNavigation.length===1,'held navigation');
          useWorkspaceStore.setState({userProfile:profile(2)});holdViews=holdRecents=holdAncestors=holdNavigation=false;
          assert(oldListener.closed,'actor switch closes recent listener');assert(window.fixturePorts[0].closed,'actor switch closes search receive port');
          await open();const newOwner=tag();row().focus();await wait(()=>document.body.textContent.includes('Ancestor '+newOwner),'new actor ancestor');assert(!document.body.textContent.includes('Ancestor '+oldOwner),'same view UUID never reuses previous actor ancestors');
          pendingViews[0].resolve(success(RepeatedViewPBSchema,{items:[page('PRIVATE late view cache')]}));pendingRecents[0].resolve(success(RepeatedRecentViewPBSchema,{items:[{item:page('PRIVATE late recent')}]}));
          pendingAncestors.splice(0).forEach(item=>item.resolve(success(RepeatedViewPBSchema,{items:[{id:'ancestor',parentViewId:'root',name:'PRIVATE late ancestor'}]})));
          pendingNavigation[0].resolve(success(ViewPBSchema,page('PRIVATE late navigation')));oldStream.resolve(success());
          portMessage(oldStream.query.streamPort,result(oldStream,'PRIVATE closed port reply'));window.fixturePorts[0].callback(result(oldStream,'PRIVATE queued port reply'));
          const oldReadCount=requests.filter(item=>item.event==='ReadRecentViews').length;oldListener.callback(0,{ok:true,value:new Uint8Array()});
          await frame();await frame();assert(latest.length===0&&useTabsStore.getState().latestOpenView===null,'late navigation cannot open a tab or announce latest view');
          assert(requests.filter(item=>item.event==='ReadRecentViews').length===oldReadCount,'queued old recent callback cannot refresh new owner');
          assert(!document.body.textContent.includes('PRIVATE'),'late results, recents, paths and navigation remain hidden');assert(useRecentViewsStore.getState().views[0].item.name==='Recent '+newOwner,'new actor cache retained');
          type('Current actor query');await wait(()=>streams.length===2,'new actor stream');const currentStream=streams[1];
          portMessage(currentStream.query.streamPort,result(currentStream,'Current actor result'));await wait(()=>document.body.textContent.includes('Current actor result'),'new actor result');
          window.fixturePorts[0].callback(toBinary(SearchStatePBSchema,create(SearchStatePBSchema,{searchId:oldStream.query.searchId})));
          assert(useCommandPaletteStore.getState().searching,'previous actor completion cannot finish the new actor search');
          portMessage(currentStream.query.streamPort,toBinary(SearchStatePBSchema,create(SearchStatePBSchema,{searchId:currentStream.query.searchId})));
          assert(!useCommandPaletteStore.getState().searching,'current private port finishes its own search');currentStream.resolve(success());
          document.querySelector('button[aria-label="commandPalette.clearSearchTooltip"]').click();await wait(()=>input().value===''&&document.body.textContent.includes('Recent '+newOwner),'clear returns to current actor recents');
          const switches=[
            ()=>useWorkspaceStore.setState({currentWorkspace:workspace('workspace-B')}),
            ()=>useAppStore.setState({env:environment('https://one.internal')}),
            ()=>useAppStore.setState({env:environment('https://two.internal')}),
            ()=>useAppStore.setState({dataDirectory:'/fixture/storage-B'}),
            ()=>useAppStore.setState({launchId:2}),
          ];
          for(const change of switches){const count=streams.length;type('PRIVATE debounced query');change();await wait(()=>!palette(),'owner change closes palette');await sleep(320);assert(streams.length===count,'owner change cancels queued search');await open();row().focus();await wait(()=>document.body.textContent.includes('Ancestor '+tag()),'scoped ancestor after switch');}
          holdNavigation=true;row().click();await wait(()=>pendingNavigation.length===2,'ABA pending navigation');
          useWorkspaceStore.setState({userProfile:profile(3)});useWorkspaceStore.setState({userProfile:profile(2)});serial++;holdNavigation=false;
          await open();pendingNavigation[1].resolve(success(ViewPBSchema,page('PRIVATE ABA navigation')));await frame();await frame();assert(latest.length===0,'A to B to A still discards previous navigation');
          type('PRIVATE pending-open draft');const streamCount=streams.length;useWorkspaceStore.setState({actionResult:{actionType:'open',isLoading:true,result:null}});
          await wait(()=>!palette(),'pending-open closes palette');toggleCommandPalette.emit();await frame();assert(!palette(),'cannot open palette during workspace switch');await sleep(320);assert(streams.length===streamCount,'pending-open cancels query');
          useWorkspaceStore.setState({actionResult:null});await open();
          const closeExpander=registerViewExpander('ancestor',{isExpanded:()=>false,expand:()=>{expansions++}});
          holdAncestors=true;const heldBefore=pendingAncestors.length,prefsBefore=preferences.length;row().click();await wait(()=>pendingAncestors.length>heldBefore,'navigation ancestor load');
          useAppStore.setState({dataDirectory:'/fixture/storage-C'});holdAncestors=false;
          pendingAncestors.splice(heldBefore).forEach(item=>item.resolve(success(RepeatedViewPBSchema,{items:[{id:'ancestor',parentViewId:'root',name:'PRIVATE prior navigation ancestor'}]})));
          await frame();await frame();assert(preferences.length===prefsBefore&&expansions===0,'late ancestor read cannot persist preferences or expand old tree');
          await open();holdPreference=true;row().click();await wait(()=>preferenceReply,'preference write is pending');
          useAppStore.setState({dataDirectory:'/fixture/storage-D'});holdPreference=false;preferenceReply();await frame();await frame();assert(expansions===0,'completion of old preference write cannot expand new owner tree');
          closeExpander();await open();app.unmount();await frame();
          assert(window.fixtureSubscriptions.filter(item=>item.id==='recent_views').every(item=>item.closed),'all recent listeners close on disposal');assert(window.fixturePorts.every(item=>item.closed),'all search ports close on disposal');
          toggleCommandPalette.emit();await frame();assert(!palette(),'disposed host removes toggle listener');
          return 'Hyper search owner interaction passed';
        })();
      `);
      const renderer = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'hyper-search-owner-fixture', resolveId(source) {
        if (source.endsWith('/i18n')) return i18n;
        if (source.endsWith('/backend/notifications')) return notifications;
        if (source.endsWith('/backend/ports')) return ports;
        if (source.endsWith('icons.json?url')) return iconUrl;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'zustand', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      }, transform(code, id) {
        // Vite resolves these asset globs in the app; fixture views have no SVG icons.
        if (id.endsWith('/icons/FlowySvg.tsx') || id.endsWith('/sidebar/icon-picker/icon-groups.ts')) return code.replace(/import\.meta\.glob\([\s\S]*?\}\)/, '({})');
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = renderer.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No search owner renderer bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), code.code + '\nwindow.hyperSearchOwnerChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src data:"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',(...args)=>console.error(args[1]?.message??args[2]??args[1]));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper search owner interaction passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 120_000);
});
