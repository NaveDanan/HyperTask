import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY));
function pixel() {
  const chunk = (name: string, bytes: Buffer) => { const body = Buffer.concat([Buffer.from(name), bytes]), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

(available ? describe : describe.skip)('Hyper generated images in Electron', () => {
  it('displays validated assistant images through the managed protocol, saves explicitly, and drops stale-owner replies', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-generated-renderer-'));
    try {
      const storage = path.join(temporary, 'storage'), artifacts = path.join(storage, 'ai_generated_images');
      fs.mkdirSync(artifacts, { recursive: true });
      const source = path.join(artifacts, 'generated.png'), slow = path.join(artifacts, 'slow.png'), bytes = pixel();
      fs.writeFileSync(source, bytes); fs.writeFileSync(slow, bytes);
      const target = path.join(temporary, 'saved.png');
      const entry = path.join(temporary, 'entry.tsx'), i18n = path.join(temporary, 'i18n.ts');
      fs.writeFileSync(i18n, 'export const useTr=()=>({tr:key=>key});');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {HyperChatMessageContent} from '@/features/ai-chat/HyperChatMessageContent';
        window.hyperImageChecks=(async()=>{
          const assert=(value,message)=>{if(!value)throw Error(message)};
          const wait=async(check,label)=>{const until=Date.now()+6000;while(!await check()){if(Date.now()>until)throw Error('Timed out '+label);await new Promise(resolve=>setTimeout(resolve,10));}};
          const fixture=window.fixture;
          window.appflowy={assets:{importGeneratedImage:fixture.importImage,exportFile:fixture.exportImage},dialog:{saveFile:async()=>${JSON.stringify(target)}},shell:{openExternal:async()=>{throw Error('No external navigation expected')}}};
          let active=true;
          const owner={workspaceId:'workspace',actorId:'actor',contextKey:'realm',isCurrent:()=>active};
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
          const markdown=url=>'![generated]('+url+')';
          const mount=(url,enabled=true,scope=owner,key=url)=>app.render(<HyperChatMessageContent key={key} text={markdown(url)} generatedImages={enabled} owner={scope}/>);
          const image=()=>host.querySelector('img');
          mount(${JSON.stringify(pathToFileURL(source).href)});
          await wait(()=>image()?.complete&&image().naturalWidth===1,'managed image loads');
          assert(image().src.startsWith('appflowy-file://local/images/Hyper-generated-'),'raw file URL never reaches image renderer');
          const save=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Save image');
          save().click();await wait(()=>fixture.saved(),'save completes');await wait(()=>!save().disabled,'save button ready');
          assert(await fixture.saved(),'save copies original image bytes');
          save().click();await wait(()=>host.querySelector('[role="alert"]'),'existing target rejected');
          assert(await fixture.saved(),'failed replacement preserves saved image');
          const count=await fixture.count();
          mount(${JSON.stringify(pathToFileURL(source).href)},false);
          await wait(()=>!image(),'user image does not render');
          assert(await fixture.count()===count,'user text cannot start generated-file imports');
          mount('https://example.invalid/tracker.png');await wait(()=>host.querySelector('a'),'remote image becomes deliberate link');
          assert(!image()&&await fixture.count()===count,'remote image never loads or enters local-file bridge');
          mount(${JSON.stringify(pathToFileURL(path.join(temporary, 'outside.png')).href)});
          await wait(()=>host.textContent.includes('Generated image unavailable.'),'outside path rejected');
          assert(!image(),'untrusted file path never becomes image');
          mount(${JSON.stringify(pathToFileURL(slow).href)});
          await wait(async()=>false,'unused');
        })();
      `.replace("await wait(async()=>false,'unused');", `
          while(!await fixture.held())await new Promise(resolve=>setTimeout(resolve,10));
          active=false;mount(${JSON.stringify(pathToFileURL(slow).href)},true,null);
          await wait(()=>host.textContent.includes('Generated image unavailable.'),'owner loss clears preview');
          await fixture.release();await new Promise(resolve=>setTimeout(resolve,100));
          assert(!image(),'late owner reply cannot reveal previous owner image');
          active=true;mount(${JSON.stringify(pathToFileURL(source).href)},true,owner,'remounted');
          await wait(()=>image()?.complete&&image().naturalWidth===1,'remounted image loads');
          assert(await fixture.managedCount()===1,'repeated sources and remounts share one immutable managed image');
          app.unmount();return 'Hyper generated image renderer checks passed';
        `));
      const renderer = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'hyper-image-fixture', resolveId(source) {
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const rendererCode = renderer.output.find(chunk => chunk.type === 'chunk'); if (rendererCode?.type !== 'chunk') throw Error('No image renderer bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), rendererCode.code + '\nwindow.hyperImageChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src appflowy-file:"><body></body>');
      const preload = path.join(temporary, 'preload.cjs');
      fs.writeFileSync(preload, `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',Object.fromEntries(['importImage','exportImage','saved','count','held','release','managedCount'].map(name=>[name,(...args)=>ipcRenderer.invoke(name,...args)])));`);
      const main = path.join(temporary, 'main.ts');
      fs.writeFileSync(main, `
        import{app,BrowserWindow,ipcMain}from'electron';import fs from'node:fs/promises';
        import{HyperAssets}from${JSON.stringify(path.join(root, 'src/main/HyperAssets.ts'))};
        import{HyperGeneratedImages}from${JSON.stringify(path.join(root, 'src/main/HyperGeneratedImages.ts'))};
        import{hyperRegisterAssetScheme,hyperHandleAssetProtocol}from${JSON.stringify(path.join(root, 'src/main/HyperAssetProtocol.ts'))};
        hyperRegisterAssetScheme();const assets=new HyperAssets(()=>${JSON.stringify(storage)});
        const images=new HyperGeneratedImages({applicationRoot:()=>${JSON.stringify(storage)},importImage:(bytes,info)=>assets.importGeneratedImage(bytes,info)});
        let count=0,held=false,release;ipcMain.handle('count',()=>count);ipcMain.handle('held',()=>held);ipcMain.handle('release',()=>{release?.();held=false});
        ipcMain.handle('importImage',async(_,url)=>{count++;if(url===${JSON.stringify(pathToFileURL(slow).href)})await new Promise(resolve=>{held=true;release=resolve});return images.importUrl(url)});
        ipcMain.handle('exportImage',(_,source,target)=>assets.exportFile(source,target));ipcMain.handle('saved',async()=>{try{return(await fs.readFile(${JSON.stringify(target)})).equals(Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64'))}catch{return false}});
        ipcMain.handle('managedCount',async()=>(await fs.readdir(${JSON.stringify(path.join(storage, 'images'))})).length);
        app.whenReady().then(async()=>{hyperHandleAssetProtocol(assets);const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(await fs.readFile(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}});
      `);
      await build({ input: main, platform: 'node', external: ['electron', /^node:/], output: { file: path.join(temporary, 'main.cjs'), format: 'cjs' } });
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, path.join(temporary, 'main.cjs')], { timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper generated image renderer checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 120_000);
});
