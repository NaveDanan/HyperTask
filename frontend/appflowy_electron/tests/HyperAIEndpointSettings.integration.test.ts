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
(available ? describe : describe.skip)('Hyper endpoint model settings in Electron', () => {
  it('discovers models, saves the default, ignores stale endpoint/key results and keeps manual defaults on errors or empty responses', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-endpoint-settings-'));
    try {
      const settings = path.join(temporary, 'settings.ts'), entry = path.join(temporary, 'entry.tsx'), i18n = path.join(temporary, 'i18n.ts');
      fs.writeFileSync(i18n, 'export const useTr=()=>({tr:key=>key});');
      fs.writeFileSync(settings, `
        export class SettingsError extends Error { constructor(message,kind='other'){super(message);this.kind=kind;} }
        export const endpointErrorMessage=error=>error?.message??String(error);
        export const loadEndpointSettings=async()=>({...window.hyperLoadedSettings});
        export const saveEndpointSettings=async settings=>{window.hyperSavedSettings.push({...settings});};
        export const encryptKey=async key=>key?'protected:'+key:'';
        export const testEndpointConnection=async settings=>{window.hyperConnectionTests.push({...settings});};
      `);
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {AIPage} from '@/features/settings/ai/AIPage';
        window.hyperEndpointResult=(async()=>{
          const assert=(condition,message)=>{if(!condition)throw Error(message)};
          const wait=async(test,message)=>{const end=Date.now()+7000;while(!test()){if(Date.now()>end)throw Error('Timed out: '+(message??test));await new Promise(resolve=>setTimeout(resolve,10));}};
          const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
          window.hyperLoadedSettings={baseUrl:'https://first.test/v1',model:'saved-default',embeddingModel:'',imageModel:'',protectedKey:'protected-original',enabled:true};
          window.hyperSavedSettings=[];window.hyperConnectionTests=[];
          const requests=[];
          window.appflowy={aiEndpoint:{discover:input=>new Promise(resolve=>{requests.push({input:{...input},resolve});})}};
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
          app.render(<AIPage user={{}} workspace={null} role={null} closeDialog={()=>{}} didLogout={()=>{}} restartApp={()=>{}}/>);
          const button=label=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===label||button.getAttribute('aria-label')===label);
          const setInput=async(element,value)=>{assert(element,'input exists');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));await frame();};
          const model=()=>document.getElementById('hyper-ai-model')??document.querySelector('input[role="combobox"]');
          const openModels=async()=>{const input=model();input.focus();input.click();input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[role="listbox"]'),'model list opens');};
          const option=value=>[...document.querySelectorAll('[role="option"]')].find(element=>element.textContent.trim()===value);
          const closeModels=async()=>{document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));document.getElementById('hyper-ai-url').focus();await frame();};
          const nextRequest=async(start,predicate)=>{await wait(()=>requests.slice(start).some(request=>predicate(request.input)),'discovery request');return requests.slice(start).find(request=>predicate(request.input));};
          await wait(()=>model()&&requests.length===1,'initial saved-model discovery');
          assert(requests[0].input.protectedKey==='protected-original','saved encrypted credential used for initial discovery');
          requests[0].resolve({ok:true,value:{models:['saved-default','other-model']}});
          await openModels();await wait(()=>option('other-model'),'discovered model option');option('other-model').click();await wait(()=>model().value==='other-model','default model selection');
          button('Save AI settings').click();await wait(()=>window.hyperSavedSettings.length===1,'default saved');
          assert(window.hyperSavedSettings[0].model==='other-model','selected default persisted');
          assert(window.hyperSavedSettings[0].protectedKey==='protected-original','empty key field preserves saved key');

          let start=requests.length;await setInput(document.getElementById('hyper-ai-url'),'https://slow.test/v1');
          const staleURL=await nextRequest(start,input=>input.baseUrl==='https://slow.test/v1');
          start=requests.length;await setInput(document.getElementById('hyper-ai-url'),'https://current.test/v1');
          const currentURL=await nextRequest(start,input=>input.baseUrl==='https://current.test/v1');
          currentURL.resolve({ok:true,value:{models:['fresh-url-model','other-model']}});staleURL.resolve({ok:true,value:{models:['stale-url-only']}});
          await openModels();await wait(()=>option('fresh-url-model'),'current endpoint models');assert(!option('stale-url-only'),'stale endpoint result ignored');await closeModels();
          start=requests.length;await setInput(document.getElementById('hyper-ai-key'),'test-key-one');
          const staleKey=await nextRequest(start,input=>input.apiKey==='test-key-one');
          start=requests.length;await setInput(document.getElementById('hyper-ai-key'),'test-key-two');
          const current=await nextRequest(start,input=>input.apiKey==='test-key-two');
          current.resolve({ok:true,value:{models:['key-model','other-model']}});
          staleKey.resolve({ok:true,value:{models:['stale-key-only']}});
          await openModels();await wait(()=>option('key-model'),'key-dependent models');assert(!option('stale-key-only'),'stale key result ignored');await closeModels();
          assert(model().value==='other-model','refresh preserves the saved default');
          button('Save AI settings').click();await wait(()=>window.hyperSavedSettings.length===2,'new key saved');
          assert(window.hyperSavedSettings[1].protectedKey==='protected:test-key-two','plaintext key encrypted only when saving');
          assert(!Object.values(window.hyperSavedSettings[1]).includes('test-key-two'),'plaintext key is not persisted');

          start=requests.length;await setInput(document.getElementById('hyper-ai-url'),'https://auth.test/v1');
          const unauthorized=await nextRequest(start,input=>input.baseUrl==='https://auth.test/v1');
          unauthorized.resolve({ok:false,kind:'state',message:'Model discovery failed: HTTP 401'});
          await wait(()=>container.textContent.includes('401'),'authorization error displayed');assert(model().value==='other-model','401 preserves default');
          assert(!container.textContent.includes('test-key-two'),'discovery error does not expose the key');
          await setInput(model(),'manual-private-model');await wait(()=>button('Use entered model ID'),'manual fallback control');button('Use entered model ID').click();await frame();
          button('Save AI settings').click();await wait(()=>window.hyperSavedSettings.length===3,'manual default saved');assert(window.hyperSavedSettings[2].model==='manual-private-model','manual model remains usable after discovery failure');

          start=requests.length;await setInput(document.getElementById('hyper-ai-url'),'https://empty.test/v1');
          const empty=await nextRequest(start,input=>input.baseUrl==='https://empty.test/v1');empty.resolve({ok:true,value:{models:[]}});
          await frame();await frame();assert(model().value==='manual-private-model','empty endpoint preserves manual default');
          button('Save AI settings').click();await wait(()=>window.hyperSavedSettings.length===4,'default saved after empty discovery');assert(window.hyperSavedSettings[3].model==='manual-private-model','empty model response does not clear saved default');
          await wait(()=>!button('Refresh models').disabled,'refresh enabled');start=requests.length;button('Refresh models').click();
          const refreshed=await nextRequest(start,input=>input.baseUrl==='https://empty.test/v1');refreshed.resolve({ok:true,value:{models:['manual-private-model','refreshed-model']}});
          await openModels();await wait(()=>option('refreshed-model'),'manual refresh updates available models');await closeModels();
          assert(model().value==='manual-private-model','refresh keeps chosen default');
          button('Test selected model').click();await wait(()=>window.hyperConnectionTests.length===1,'test endpoint called');assert(window.hyperConnectionTests[0].model==='manual-private-model','connection test uses default');
          app.unmount();
        })();
      `);
      const bundled = await build({ input: entry,
        onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'isolated-ai-settings', resolveId(source) {
          if (source.endsWith('/openai-endpoint-settings')) return settings;
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react-dom/client'].includes(source)) return resolvePackage(source);
          return null;
        } }],
        resolve: { alias: { '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false,
      });
      const code = bundled.output.find(item => item.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No AI settings test bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperEndpointResult`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><html><body></body></html>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log('Hyper endpoint settings interaction passed');app.exit(0);}catch(error){console.error(error.stack);app.exit(1);}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 45_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper endpoint settings interaction passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
