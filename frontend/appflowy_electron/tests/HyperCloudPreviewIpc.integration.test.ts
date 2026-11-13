import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { DownloadFilePBSchema } from '@shared/protobuf/flowy-document/entities_pb';
const root = path.resolve(__dirname, '..'), resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
const supportsCompletion = DownloadFilePBSchema.fields.some(field => field.name === 'wait_for_completion');
(available ? describe : describe.skip)('Hyper protected image actual preload and Electron IPC', () => {
  it(supportsCompletion ? 'requires captured owner, awaits complete native downloads and invalidates late actor/cache state' : 'uses actual preload IPC and refuses the legacy acknowledgement-only descriptor before download', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-cloud-ipc-'));
    try {
      const storage = path.join(temporary, 'storage'), staging = path.join(temporary, 'staging'); fs.mkdirSync(storage); fs.mkdirSync(staging);
      const preload = path.join(temporary, 'preload.cjs');
      await build({ input: path.join(root, 'src/preload/index.ts'), platform: 'node', external: ['electron', /^node:/], resolve: { alias: { '@shared': path.join(root, 'src/shared') } }, output: { file: preload, format: 'cjs' } });
      fs.appendFileSync(preload, `\n(()=>{const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',Object.fromEntries(['state','hold','release','actor','error','staging'].map(name=>[name,(...args)=>ipcRenderer.invoke('fixture:'+name,...args)])))})();`);
      const main = path.join(temporary, 'entry.ts');
      fs.writeFileSync(main, `
        import{app,BrowserWindow,ipcMain}from'electron';import fs from'node:fs/promises';import{create,fromBinary,toBinary}from'@bufbuild/protobuf';
        import{IpcChannel as C}from${JSON.stringify(path.join(root, 'src/shared/api.ts'))};import{DownloadFilePBSchema}from${JSON.stringify(path.join(root, 'src/shared/protobuf/flowy-document/entities_pb.ts'))};import{UserProfilePBSchema}from${JSON.stringify(path.join(root, 'src/shared/protobuf/flowy-user/user_profile_pb.ts'))};import{WorkspaceLatestPBSchema}from${JSON.stringify(path.join(root, 'src/shared/protobuf/flowy-folder/workspace_pb.ts'))};
        import{HyperCloudPreviews}from${JSON.stringify(path.join(root, 'src/main/HyperCloudPreviews.ts'))};import{createHyperCloudPreviewBackend}from${JSON.stringify(path.join(root, 'src/main/HyperCloudPreviewBackend.ts'))};import{createHyperCloudPreviewDownload,hyperCloudPreviewIpc}from${JSON.stringify(path.join(root, 'src/main/HyperCloudPreviewIpc.ts'))};
        let actor=7n,revision=0,downloads=0,mode='success';const held=[];const server='https://private.example/prefix',workspace='workspace-A',pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=','base64');
        const core={request:async(event,payload)=>{
          if(event==='GetUserProfile')return{status:0,payload:toBinary(UserProfilePBSchema,create(UserProfilePBSchema,{id:actor,token:'PRIVATE_FAKE_NATIVE_TOKEN'}))};
          if(event==='GetCurrentWorkspaceSetting')return{status:0,payload:toBinary(WorkspaceLatestPBSchema,create(WorkspaceLatestPBSchema,{workspaceId:workspace}))};
          if(event!=='DownloadFile')throw Error('Unexpected core event');downloads++;const input=fromBinary(DownloadFilePBSchema,payload);if(input.waitForCompletion!==true)throw Error('Acknowledgement-only download is forbidden');
          const captured=mode;if(captured==='hold')await new Promise(resolve=>held.push(resolve));if(captured==='error')return{status:1,payload:Buffer.from('Bearer PRIVATE_FAKE_NATIVE_TOKEN /private/core/path')};await fs.writeFile(input.localFilePath,pixel);return{status:0,payload:new Uint8Array()};
        }};
        const adapter=createHyperCloudPreviewBackend(core,()=>({root:${JSON.stringify(storage)},server,revision}),createHyperCloudPreviewDownload(core));adapter.temporaryDirectory=${JSON.stringify(staging)};const previews=new HyperCloudPreviews(adapter);
        ipcMain.handle(C.AssetsPreviewCloud,(_,url,owner)=>hyperCloudPreviewIpc(previews,url,owner));
        ipcMain.handle('fixture:state',()=>({downloads,held:held.length,actor:String(actor),revision}));ipcMain.handle('fixture:hold',()=>{mode='hold'});ipcMain.handle('fixture:release',()=>{mode='success';held.splice(0).forEach(resolve=>resolve())});ipcMain.handle('fixture:actor',(_,value)=>{revision++;previews.invalidate();actor=BigInt(value)});ipcMain.handle('fixture:error',()=>{mode='error'});ipcMain.handle('fixture:staging',()=>fs.readdir(${JSON.stringify(staging)}));
        app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{const result=await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)},wait=async check=>{const end=Date.now()+6000;while(!await check()){if(Date.now()>end)throw Error('Timed out '+check);await new Promise(resolve=>setTimeout(resolve,10));}},owner={actorId:'7',workspaceId:'workspace-A'},url='https://private.example/prefix/api/file_storage/workspace-A/v1/blob/page/image.png',preview=(value=url,scope=owner)=>window.appflowy.assets.previewCloud(value,scope),reject=async work=>{try{await work;throw Error('Unexpected success')}catch(error){assert(!String(error).includes('PRIVATE_FAKE_NATIVE_TOKEN')&&!String(error).includes('/private/core/path'),'IPC error contains no token/path');return String(error)}};
          await reject(window.appflowy.assets.previewCloud(url));await reject(preview(url,{actorId:'7',workspaceId:'workspace-A',token:'injected'}));assert((await fixture.state()).downloads===0,'required owner checked before any download');
          if(!${JSON.stringify(supportsCompletion)}){await reject(preview());assert((await fixture.state()).downloads===0,'legacy descriptor fails closed before DownloadFile');return'Hyper actual preload protected IPC legacy gate passed';}
          await fixture.hold();let settled=false;const waiting=preview().then(value=>{settled=true;return value});await wait(async()=>(await fixture.state()).held===1);assert(!settled,'native completion is awaited');await fixture.release();const raster=await waiting;assert(raster.startsWith('data:image/png;base64,')&&!raster.includes('appflowy-file:')&&!raster.includes('hyper-cloud'),'only raster bytes cross preload');assert((await fixture.staging()).length===0,'private staging removed');
          await preview();assert((await fixture.state()).downloads===1,'same owner cache reused');await fixture.actor('8');await reject(preview());assert((await fixture.state()).downloads===1,'old captured actor cannot start a new actor download');const next={actorId:'8',workspaceId:'workspace-A'};await preview(url,next);assert((await fixture.state()).downloads===2,'new actor does not reuse old cache');
          await fixture.hold();const late=preview(url+'-late',next).then(()=>({ok:true}),error=>({ok:false,message:String(error)}));await wait(async()=>(await fixture.state()).held===1);await fixture.actor('7');await fixture.release();const result=await late;assert(!result.ok&&!result.message.includes('PRIVATE_FAKE_NATIVE_TOKEN'),'late actor result is rejected');await wait(async()=>(await fixture.staging()).length===0);
          const before=(await fixture.state()).downloads;await reject(preview(url.replace('workspace-A','workspace-B')));assert((await fixture.state()).downloads===before,'foreign workspace rejected before download');await fixture.error();await reject(preview(url+'-failure'));assert((await fixture.staging()).length===0,'failed native staging removed');return'Hyper actual preload protected IPC checks passed';
        })()`)});console.log(result);app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});
      `);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><body></body>');
      await build({ input: main, platform: 'node', external: ['electron', /^node:/], resolve: { alias: { '@shared': path.join(root, 'src/shared'), '@bufbuild/protobuf': resolvePackage('@bufbuild/protobuf') } }, output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')], { timeout: 35_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); expect(stdout).toContain(supportsCompletion ? 'Hyper actual preload protected IPC checks passed' : 'Hyper actual preload protected IPC legacy gate passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 45_000);
});
