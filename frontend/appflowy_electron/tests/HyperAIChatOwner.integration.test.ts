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

(available ? describe : describe.skip)('Hyper AI chat ownership in Electron', () => {
  it('remounts one chat UUID for each owner and discards disposed history, image and stream replies', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-chat-owner-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), entry = path.join(temporary, 'entry.tsx'), backend = path.join(temporary, 'backend.ts');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export const useTr=()=>({tr});');
      const actualBackend = JSON.stringify(path.join(root, 'src/renderer/features/ai-chat/HyperChatBackend.ts'));
      fs.writeFileSync(backend, `export*from${actualBackend};import{createHyperChatBackend as createActual}from${actualBackend};export const createHyperChatBackend=(...args)=>window.fixtureObserveBackend(createActual(...args));`);
      fs.writeFileSync(entry, `
        import React from'react';import{createRoot}from'react-dom/client';
        import{create,fromBinary,toBinary}from'@bufbuild/protobuf';
        import{ViewPBSchema,ViewLayoutPB}from'@shared/protobuf/flowy-folder/view_pb';
        import{UserProfilePBSchema,UserWorkspacePBSchema}from'@shared/protobuf/flowy-user/user_profile_pb';
        import{ChatMessagePBSchema,ChatMessageListPBSchema,ChatMessageErrorPBSchema,ChatSettingsPBSchema,ModelSelectionPBSchema,LocalAISettingPBSchema,LoadPrevChatMessagePBSchema,StreamChatPayloadPBSchema,StopStreamPBSchema}from'@shared/protobuf/flowy-ai/entities_pb';
        import{SubscribeObjectSchema}from'@shared/protobuf/flowy-notification/subject_pb';
        import{ChatNotification}from'@shared/protobuf/flowy-ai/notification_pb';
        import{HyperAIChatPage}from'@/features/ai-chat/HyperAIChatPage';
        import{useWorkspaceStore}from'@/features/sidebar/stores/workspace-store';
        import{useAppStore}from'@/startup/app-store';
        window.hyperChatOwnerChecks=(async()=>{
          const assert=(condition,message)=>{if(!condition)throw Error(message)};
          const wait=async(check,label)=>{const until=Date.now()+6000;while(!await check()){if(Date.now()>until)throw Error('Timed out '+label+' '+document.body.textContent.slice(-500));await new Promise(resolve=>setTimeout(resolve,10));}};
          const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
          const tag=()=>{const workspace=useWorkspaceStore.getState(),app=useAppStore.getState();return [String(workspace.userProfile?.id),workspace.currentWorkspace?.workspaceId,app.env?.appflowyCloudConfig.base_url||'local',app.dataDirectory].join('|')};
          const profile=id=>create(UserProfilePBSchema,{id:BigInt(id),name:'Actor '+id});
          const workspace=id=>create(UserWorkspacePBSchema,{workspaceId:id,name:id});
          const environment=url=>({authenticatorType:url?3:0,appflowyCloudConfig:{base_url:url,ws_base_url:url.replace(/^http/,'ws'),gotrue_url:url,base_web_domain:'',enable_sync_trace:false}});
          useWorkspaceStore.setState({userProfile:profile(1),currentWorkspace:workspace('workspace-A'),actionResult:null});
          useAppStore.setState({dataDirectory:'/fixture/storage-A',env:environment('')});
          let notification,portListener;const requests=[],histories=[],pendingHistory=[],pendingImages=[],streams=[],stops=[],subscriptions=[],ports=[];
          const success=(schema,value)=>({status:0,payload:schema?toBinary(schema,create(schema,value)):new Uint8Array()});
          const message=(text,id=10n,author=3n)=>create(ChatMessagePBSchema,{messageId:id,createdAt:id,authorType:author,authorId:String(useWorkspaceStore.getState().userProfile.id),content:text});
          const emit=(type,payload=new Uint8Array())=>notification(toBinary(SubscribeObjectSchema,create(SubscribeObjectSchema,{source:'Chat',id:'same-view-uuid',ty:type,oneOfPayload:{case:'payload',value:payload}})));
          window.appflowy={core:{onNotification:listener=>{notification=listener;return()=>{}},onPortMessage:listener=>{portListener=listener;return()=>{}},request:async(event,payload)=>{
            const owner=tag();requests.push({event,owner});
            if(event==='LoadPrevMessage'){
              const query=fromBinary(LoadPrevChatMessagePBSchema,payload);assert(query.chatId==='same-view-uuid','chat UUID is stable');
              if(query.oneOfBeforeMessageId.case==='beforeMessageId')return new Promise(resolve=>pendingHistory.push({owner,resolve}));
              histories.push(owner);const content='History '+owner+(owner.startsWith('1|')?'\\n\\n![generated](file:///fixture/generated.png)':'');
              return success(ChatMessageListPBSchema,{hasMore:true,messages:[message(content)]});
            }
            if(event==='GetChatSettings')return success(ChatSettingsPBSchema,{ragIds:[]});
            if(event==='GetSourceModelSelection')return success(ModelSelectionPBSchema,{});
            if(event==='GetLocalAISetting')return success(LocalAISettingPBSchema,{serverUrl:''});
            if(event==='StreamMessage'){const query=fromBinary(StreamChatPayloadPBSchema,payload);return new Promise(resolve=>streams.push({owner,query,resolve}));}
            if(event==='StopStream'){const query=fromBinary(StopStreamPBSchema,payload);assert(query.chatId==='same-view-uuid','stop uses original chat UUID');stops.push({owner});return success();}
            throw Error('Unexpected fixture event '+event);
          }},assets:{importGeneratedImage:source=>new Promise(resolve=>pendingImages.push({source,owner:tag(),resolve}))},clipboard:{writeText:async()=>{}},shell:{openExternal:async()=>{throw Error('No external links expected')}}};
          // Preserve the real wire decoder and port registry; observe their disposal only.
          window.fixtureObserveBackend=base=>({...base,listen:(chatId,listener)=>{const item={owner:tag(),closed:false,events:0};subscriptions.push(item);const close=base.listen(chatId,event=>{item.events++;listener(event)});return()=>{item.closed=true;close()}},openPort:listener=>{const original=base.openPort(listener),item={port:original.port,closed:false};ports.push(item);return{port:original.port,close:()=>{item.closed=true;original.close()}}}});
          const view=create(ViewPBSchema,{id:'same-view-uuid',name:'Owner chat',layout:ViewLayoutPB.Chat});
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
          let contextProfile=profile(1);
          const mount=async()=>{app.render(<HyperAIChatPage view={view} context={{userProfile:contextProfile}}/>);await frame()};
          const input=()=>host.querySelector('textarea[aria-label="Message"]');
          const button=label=>[...host.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')===label||button.textContent===label);
          const type=value=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input(),value);input().dispatchEvent(new Event('input',{bubbles:true}))};
          const expectOwner=async(label,old=[])=>{await wait(()=>host.textContent.includes('History '+label)&&input()&&!input().disabled,'owner history '+label);for(const text of old)assert(!host.textContent.includes(text),'old owner history removed '+text);assert(input().value==='','owner starts with empty draft')};
          await mount();const first=tag();await expectOwner(first);await wait(()=>pendingImages.length===1,'first owner generated image request');
          type('Private actor draft');await wait(()=>input().value==='Private actor draft','actor draft');
          useWorkspaceStore.setState({userProfile:profile(2)});await wait(()=>host.childElementCount===0,'mismatched context profile hides content');
          assert(subscriptions[0].closed,'old idle listener closes before matching profile appears');assert(histories.length===1,'mismatched profile cannot request another owner history');
          contextProfile=profile(2);await mount();const second=tag();await expectOwner(second,[first,'Private actor draft']);
          pendingImages[0].resolve({path:'/fixture/storage-A/images/old.png',name:'old.png',size:1,width:1,height:1,previewUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='});
          await frame();assert(!host.querySelector('img'),'late image response never appears under new actor');
          type('Private workspace draft');useWorkspaceStore.setState({currentWorkspace:workspace('workspace-B')});
          const third=tag();await expectOwner(third,[first,second,'Private workspace draft']);assert(subscriptions[1].closed,'workspace switch closes previous chat listener');
          button('Load earlier messages').click();await wait(()=>pendingHistory.length===1,'history request held');
          useAppStore.setState({env:environment('https://server-one.internal')});const fourth=tag();await expectOwner(fourth,[third]);
          pendingHistory[0].resolve(success(ChatMessageListPBSchema,{messages:[message('LATE previous-owner history',5n)]}));await frame();assert(!host.textContent.includes('LATE previous-owner history'),'disposed history response ignored');
          type('Old server question');await wait(()=>!button('Send message').disabled,'send enabled');button('Send message').click();await wait(()=>streams.length===1,'pending original question');
          const oldStream=streams[0];portListener(oldStream.query.answerStreamPort,'data:Old server partial');await wait(()=>host.textContent.includes('Old server partial'),'old stream preview');
          type('Old server next draft');await wait(()=>input().value==='Old server next draft','next draft');
          useAppStore.setState({env:environment('https://server-two.internal')});const fifth=tag();await expectOwner(fifth,[fourth,'Old server partial','Old server question','Old server next draft']);
          await wait(()=>subscriptions[3].closed,'stale stream listener released locally');assert(stops.length===0,'old cleanup cannot dispatch StopStream into the new owner core');assert(ports.length===2&&ports.every(port=>port.closed),'old answer and question ports close on owner change');
          portListener(oldStream.query.answerStreamPort,'data:LATE old port fragment');portListener(oldStream.query.questionStreamPort,'error:LATE question failure');
          oldStream.resolve(success(ChatMessagePBSchema,{messageId:99n,createdAt:99n,authorType:1n,authorId:'2',content:'LATE original question'}));
          await frame();await frame();assert(stops.length===0,'late question reply cannot stop the new owner stream');
          assert(!host.textContent.includes('LATE'),'old question reply and closed ports cannot update new owner');
          type('New owner question');await wait(()=>!button('Send message').disabled,'new owner can send');button('Send message').click();await wait(()=>streams.length===2,'new owner stream');
          const newStream=streams[1];portListener(newStream.query.answerStreamPort,'data:New owner partial');await wait(()=>host.textContent.includes('New owner partial'),'new owner stream preview');
          const readsBefore=histories.length;emit(ChatNotification.DidReceiveChatMessage,toBinary(ChatMessagePBSchema,message('LATE old global notification',900n)));
          emit(ChatNotification.FinishStreaming);emit(ChatNotification.StreamChatMessageError,toBinary(ChatMessageErrorPBSchema,create(ChatMessageErrorPBSchema,{errorMessage:'LATE old global failure'})));
          await wait(()=>histories.length>readsBefore,'global payload invalidates current history');await frame();
          assert(!host.textContent.includes('LATE'),'global old-owner payload is never rendered');assert(button('Stop generating')&&!button('Send message'),'unattributed global finish and error cannot stop the new owner stream');
          newStream.resolve(success(ChatMessagePBSchema,{messageId:100n,createdAt:100n,authorType:1n,authorId:'2',content:'New owner question'}));await frame();portListener(newStream.query.answerStreamPort,'finish:');
          await wait(()=>button('Send message'),'private answer port finishes the current stream');assert(stops.length===0,'no cross-owner stop request was sent');
          type('Private storage draft');useAppStore.setState({dataDirectory:'/fixture/storage-B'});const sixth=tag();await expectOwner(sixth,[fifth,'Private storage draft']);
          assert(new Set(histories).size===6,'same view UUID loads history for each actor/workspace/server/storage owner');
          app.unmount();await wait(()=>subscriptions.every(item=>item.closed),'all chat listeners disposed');
          assert(requests.filter(item=>item.event==='StreamMessage').length===2&&streams[0].query.message==='Old server question'&&streams[1].query.message==='New owner question','owner switches do not resend old questions');
          return 'Hyper chat owner interaction passed';
        })();
      `);
      const renderer = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'hyper-chat-owner-fixture', resolveId(source) {
        if (source.endsWith('/i18n')) return i18n;
        if (source.endsWith('/HyperChatBackend')) return backend;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'zustand', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = renderer.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No chat owner renderer bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), code.code + '\nwindow.hyperChatOwnerChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src data:"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper chat owner interaction passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 120_000);
});
