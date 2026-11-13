import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY));
(available ? describe : describe.skip)('Hyper row activity main renderer-loss lifecycle in Electron', () => {
  it('releases captured activities on reload, crash and destroy without React, SDK reset or another sender reset', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-row-activity-lifecycle-'));
    try {
      const preload = path.join(temporary, 'preload.cjs'), main = path.join(temporary, 'main.ts'), bundledMain = path.join(temporary, 'main.cjs');
      fs.writeFileSync(preload, "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{activity:value=>ipcRenderer.invoke('fixture:activity',value)});");
      const html = path.join(temporary, 'index.html');
      fs.writeFileSync(html, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; frame-src \'self\' about:; script-src \'self\' \'unsafe-eval\'"><body>Disposable lifecycle fixture without React or CoreInit</body>');
      fs.writeFileSync(path.join(temporary, 'child.html'), '<!doctype html><body>Owned child frame</body>');
      fs.writeFileSync(main, `
        import {app,BrowserWindow,ipcMain} from 'electron';import {once} from 'node:events';import {pathToFileURL} from 'node:url';
        import {HyperRowActivityIpc,hyperBindRowActivityRenderer} from ${JSON.stringify(path.join(root, 'src/main/HyperRowActivityIpc.ts'))};
        app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check,label)=>{const end=Date.now()+7000;while(!check()){if(Date.now()>end)throw Error('Timed out '+label);await new Promise(resolve=>setTimeout(resolve,10));}};
          const cleanup=[],dispatches=[],settled=[],pins=new Map(),bindings=new Map();let starts=0,hold=false,releaseStart=null,childNavigations=0,sameNavigations=0,phase='initial';const deadline=setTimeout(()=>{console.error('Lifecycle fixture stalled in '+phase);app.exit(1)},25000);
          const ack=value=>({contextId:value.contextId,activityId:value.activityId,revision:value.revision});
          const tracker=new HyperRowActivityIpc({existingCore:()=>async value=>{cleanup.push(value);pins.delete(value.activityId);return ack(value)}});
          const make=name=>{const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)},partition:'hyper-row-activity-'+name,sandbox:true,contextIsolation:true,nodeIntegration:false}});bindings.set(win.webContents.id,hyperBindRowActivityRenderer(tracker,win.webContents));win.webContents.on('did-start-navigation',details=>{if(!details.isMainFrame)childNavigations++;if(details.isSameDocument)sameNavigations++;});return win};
          const a=make('a'),b=make('b');
          const request=(win,id,revision)=>win.webContents.executeJavaScript('fixture.activity({viewId:"view",contextId:"context",activityId:'+JSON.stringify(id)+',revision:'+revision+'n,rowIds:["row"],closeActivity:false})');
          ipcMain.handle('fixture:activity',async(event,value)=>{
            assert(event.senderFrame===event.sender.mainFrame,'only the private top-level fixture may submit an activity');
            const source=new URL(event.senderFrame.url);source.hash='';assert(source.href===pathToFileURL(${JSON.stringify(html)}).href,'fixture sender URL changed');
            try{return await tracker.forward(bindings.get(event.sender.id).capture(),value,async()=>{starts++;if(hold)await new Promise(resolve=>{releaseStart=resolve})},async sent=>{dispatches.push(sent);if(sent.rowIds.length)pins.set(sent.activityId,sent.rowIds);else pins.delete(sent.activityId);return{value:'accepted',ack:ack(sent)}})}finally{settled.push(value.activityId)};
          });
          const reload=async win=>{const loaded=once(win.webContents,'did-finish-load');win.webContents.reload();await loaded};
          try{
            await Promise.all([a.loadFile(${JSON.stringify(html)}),b.loadFile(${JSON.stringify(html)})]);
            assert(a.webContents.getOSProcessId()!==b.webContents.getOSProcessId(),'crash fixture windows require separate owned renderer processes');
            await request(a,'pane-a',4);await request(b,'pane-b',3);assert(tracker.trackedCount===2,'both sender activities tracked');
            phase='child-frame';await a.webContents.executeJavaScript('new Promise((resolve,reject)=>{const frame=document.createElement("iframe"),timer=setTimeout(()=>reject(Error("Child load timed out")),5000);frame.onload=()=>{clearTimeout(timer);resolve()};frame.src="child.html";document.body.append(frame)})');
            await a.webContents.executeJavaScript('location.hash="same-document"');a.hide();await new Promise(resolve=>setTimeout(resolve,40));
            assert(childNavigations>0&&sameNavigations>0,'actual child and same-document navigation exercised');assert(cleanup.length===0&&pins.size===2,'iframe/hash/tray-like hide keep pane subscriptions');
            phase='reload';const beforeReloadStarts=starts;await reload(a);await wait(()=>cleanup.some(value=>value.activityId==='pane-a'),'reload release');
            assert(starts===beforeReloadStarts,'cleanup never starts or initializes a core');assert(pins.has('pane-b')&&!pins.has('pane-a'),'reload leaves other sender intact');
            assert(cleanup.find(value=>value.activityId==='pane-a').revision===5n,'reload release exceeds accepted revision');
            phase='pending-startup';hold=true;void request(a,'pending-a',8).catch(()=>{});await wait(()=>releaseStart,'tracked startup waiter');assert(tracker.trackedCount===2,'pending request tracked before startup resolves');
            await reload(a);await wait(()=>cleanup.some(value=>value.activityId==='pending-a'),'pending navigation release');hold=false;releaseStart();await wait(()=>settled.includes('pending-a'),'retired main IPC handler settles');await new Promise(resolve=>setTimeout(resolve,30));
            assert(!dispatches.some(value=>value.activityId==='pending-a'),'retired frame cannot dispatch after startup await');assert(pins.has('pane-b'),'pending cleanup preserves other sender');
            phase='crash';await request(a,'crash-a',12);const crashed=once(a.webContents,'render-process-gone');a.webContents.forcefullyCrashRenderer();await crashed;
            await wait(()=>cleanup.some(value=>value.activityId==='crash-a'),'crash release');assert(pins.has('pane-b')&&!pins.has('crash-a'),'crash releases only lost renderer');
            phase='destroy';await a.loadFile(${JSON.stringify(html)});await request(a,'destroy-a',20);a.destroy();await wait(()=>cleanup.some(value=>value.activityId==='destroy-a'),'destroy release');
            assert(pins.has('pane-b')&&tracker.trackedCount===1,'destroy keeps other sender pin');b.destroy();await wait(()=>tracker.trackedCount===0&&pins.size===0,'all owned windows released');
            assert(cleanup.find(value=>value.activityId==='crash-a').revision===13n&&cleanup.find(value=>value.activityId==='destroy-a').revision===21n,'crash/destroy use captured higher revisions');
            clearTimeout(deadline);await new Promise(resolve=>process.stdout.write('Hyper row activity reload crash destroy checks passed\\n',resolve));app.exit(0);
          }catch(error){console.error(error.stack);if(!a.isDestroyed())a.destroy();if(!b.isDestroyed())b.destroy();app.exit(1)}
        }).catch(error=>{console.error(error.stack);app.exit(1)});
      `);
      await build({ input: main, platform: 'node', external: ['electron', /^node:/], output: { file: bundledMain, format: 'cjs' } });
      const { stdout, stderr } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, bundledMain], { timeout: 35_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout, stderr).toContain('Hyper row activity reload crash destroy checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 40_000);
});
