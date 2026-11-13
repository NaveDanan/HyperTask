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
const available = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
(available ? describe : describe.skip)('Hyper searchable slash menu in Electron', () => {
  it('filters commands, preserves dismissals and rejects stale/read-only targets without disrupting IME', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-document-slash-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), scope = path.join(temporary, 'scope.ts'), appearance = path.join(temporary, 'appearance.ts'), banner = path.join(temporary, 'banner.ts'), access = path.join(temporary, 'access.ts'), tabs = path.join(temporary, 'tabs.ts');
      fs.writeFileSync(i18n, `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))};export function tr(key,options={}){let text=key.split('.').reduce((value,part)=>value?.[part],en)??key;for(const [name,value]of Object.entries(options.namedArgs??{}))text=text.replaceAll('{'+name+'}',String(value));return text;}export function useTr(){return{tr}}`);
      fs.appendFileSync(i18n, '\nexport const resolveLocale=value=>value;export const setLocale=()=>{};');
      fs.writeFileSync(scope, 'export const usePageAccessLevel=()=>null;export const useViewPluginNotifier=()=>null;export const useViewScope=()=>null;export const ViewScopeProvider=({children})=>children;');
      fs.writeFileSync(appearance, 'export const useDocumentFontSize=()=>({fontSize:16});');
      fs.writeFileSync(banner, 'export const DocumentBanner=()=>null;export const deletePermanently=async()=>true;export const restorePage=async()=>true;');
      fs.writeFileSync(access, 'export const ShareAccessLevel={fullAccess:"fullAccess",readAndWrite:"readAndWrite"};export const isEditable=state=>!state.isLocked;export const viewIsLocked=view=>view.oneOfIsLocked.case==="isLocked"&&view.oneOfIsLocked.value;');
      fs.writeFileSync(tabs, 'export const tabsActions={openView:async()=>{},updateView:()=>{}};');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create} from '@bufbuild/protobuf';
        import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';
        import {HyperDocumentEditor} from '@/features/document/HyperDocumentPage';
        import {HyperDocumentSession} from '@/features/document/HyperDocumentSession';
        import {hyperBlockData,hyperBlockText,hyperChildren,hyperPlainText,hyperEditText,hyperUpdateBlock,hyperDeleteBlock} from '@/features/document/HyperDocumentModel';
        import {hyperSetSelection} from '@/features/document/HyperDocumentDom';
        window.hyperChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed out: '+check+'; menu='+document.querySelector('[role="menu"]')?.textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
          window.appflowy={core:{onNotification:()=>()=>{},request:async event=>{throw Error('Unexpected event: '+event)}},clipboard:{writeText:()=>{}}};
          const doc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'},p:{id:'p',parentId:'root',ty:'paragraph',childrenId:'pc',data:'{}'},tail:{id:'tail',parentId:'root',ty:'paragraph',childrenId:'tc',data:JSON.stringify({delta:[{insert:'Unrelated 🌍',attributes:{italic:true}}]})}},meta:{childrenMap:{children:{children:['p','tail']},pc:{children:[]},tc:{children:[]}}}});
          const writes=[];let releaseWrite;
          const session=new HyperDocumentSession('slash-test',{open:async()=>doc,read:async()=>doc,apply:async(id,actions)=>{writes.push(actions);if(releaseWrite)await releaseWrite.promise},close:async()=>{},history:async()=>{},listen:()=>()=>{}});await session.flush();
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);const render=editable=>app.render(<HyperDocumentEditor session={session} title="Slash test" editable={editable}/>);render(true);
          const first=()=>host.querySelector('[data-hyper-text="p"]'),tail=()=>host.querySelector('[data-hyper-text="tail"]');await wait(()=>first());
          const text=()=>hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p));
          const key=(element,key,options={})=>element.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
          const type=async value=>{const element=first();element.focus();element.textContent=value;hyperSetSelection(element,{start:value.length,end:value.length});element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));await session.flush();};
          const search=()=>document.querySelector('input[aria-label="Search commands"]');
          const query=async value=>{const input=search();input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));await session.flush();};
          const items=()=>[...document.querySelectorAll('[role="menuitem"]')];
          const reset=async()=>{session.change(doc=>hyperUpdateBlock(doc,'p',{},'paragraph'));await session.flush();await type('');};
          await type('/');await wait(()=>search()&&document.activeElement===search());await query('h2');await wait(()=>items().length===1&&items()[0].textContent==='Heading 2');assert(text()==='/h2','search query persists in originating block');key(search(),'Enter');await wait(()=>!search());await session.flush();assert(session.store.getState().document.blocks.p.ty==='heading'&&hyperBlockData(session.store.getState().document.blocks.p).level===2,'query Enter selects matching heading');assert(text()==='','only slash query cleared');
          await reset();await type('/');await wait(()=>search());await query('heading');await wait(()=>items().length===3);key(search(),'ArrowDown');assert(document.activeElement===items()[0],'Down enters command list');key(document.activeElement,'ArrowDown');assert(document.activeElement===items()[1],'Down selects next command');key(document.activeElement,'End');assert(document.activeElement===items()[2],'End selects last command');key(document.activeElement,'Home');assert(document.activeElement===items()[0],'Home selects first command');key(document.activeElement,'ArrowDown');key(document.activeElement,'Enter');await wait(()=>!search());await session.flush();assert(hyperBlockData(session.store.getState().document.blocks.p).level===2,'keyboard selection applies highlighted command');
          await reset();await type('/');await wait(()=>search());await query('unknown command');await wait(()=>items().length===0&&document.querySelector('[role="status"]')?.textContent);const beforeEmpty=JSON.stringify(session.store.getState().document);key(search(),'Enter');await new Promise(resolve=>setTimeout(resolve,20));assert(JSON.stringify(session.store.getState().document)===beforeEmpty,'Enter on empty results does not split or erase');key(search(),'Escape');await wait(()=>!search()&&document.activeElement===first());assert(text()==='/unknown command','Escape preserves typed query');await type('/unknown command literal');await new Promise(resolve=>setTimeout(resolve,20));assert(!search(),'dismissed literal does not reopen on each keystroke');
          await reset();await type('/');await wait(()=>search());await query('quote');tail().dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));tail().focus();tail().dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse'}));tail().click();await wait(()=>!search());assert(text()==='/quote','outside dismissal preserves query');assert(document.activeElement===tail(),'outside dismissal keeps clicked focus');
          await reset();await type('/');await wait(()=>search());await query('table');key(search(),'Enter');await wait(()=>!search()&&host.querySelectorAll('tbody tr').length===3);await session.flush();assert(text()==='','table conversion clears only query');assert(hyperChildren(session.store.getState().document,session.store.getState().document.blocks.root).some(id=>session.store.getState().document.blocks[id].ty==='simple_table'),'table inserted');
          await reset();let releasePending;releaseWrite={promise:new Promise(resolve=>{releasePending=resolve})};first().focus();first().textContent='/';hyperSetSelection(first(),{start:1,end:1});first().dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'/'}));await wait(()=>search());Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search(),'h2');search().dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'h2'}));await wait(()=>items().length===1&&text()==='/h2');key(search(),'Enter');await wait(()=>!search()&&session.store.getState().document.blocks.p.ty==='heading');assert(session.store.getState().status==='saving','command updates the optimistic document while earlier edits are pending');releaseWrite=null;releasePending();await session.flush();assert(session.store.getState().status==='ready'&&text()==='','pending text/query/command writes finish in order');
          await reset();await type('/');await wait(()=>search());await query('heading');const staleItem=items()[0];session.change(doc=>hyperEditText(doc,'p',[{insert:'Remote update 🌍'}]));staleItem.click();await session.flush();await wait(()=>!search());assert(text()==='Remote update 🌍'&&session.store.getState().document.blocks.p.ty==='paragraph','stale command cannot erase changed block');
          await reset();await type('/');await wait(()=>search());const readOnlyItem=items()[1];render(false);await wait(()=>first().contentEditable==='false'&&!search());readOnlyItem.click();await session.flush();assert(text()==='/'&&session.store.getState().document.blocks.p.ty==='paragraph','readonly transition prevents command application');render(true);await wait(()=>first().contentEditable==='true');
          await type('');first().focus();first().dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'/'}));first().textContent='/';hyperSetSelection(first(),{start:1,end:1});first().dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'/'}));key(first(),'Enter',{isComposing:true});assert(text()===''&&!search(),'editor composition does not open or apply slash before commit');first().dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'/'}));await session.flush();await wait(()=>search());
          search().dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'h2'}));await query('h2');key(search(),'Enter',{isComposing:true});assert(search()&&text()==='/','menu composition does not apply command');search().dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'h2'}));await session.flush();await wait(()=>text()==='/h2');key(search(),'Enter');await wait(()=>!search());await session.flush();assert(session.store.getState().document.blocks.p.ty==='heading','committed composition can select a command');
          await reset();await type('/');await wait(()=>search());const removedItem=items()[1];session.change(doc=>hyperDeleteBlock(doc,'p'));removedItem.click();await session.flush();await wait(()=>!search());assert(!session.store.getState().document.blocks.p,'deleted slash target is never recreated');assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.tail))==='Unrelated 🌍'&&hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.tail)[0].attributes.italic,'other block text and formatting preserved throughout');
          app.unmount();await session.dispose();return 'Hyper slash editor checks passed';
        })();
      `);
      const result = await build({ input: entry, onwarn(warning, fallback) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') fallback(warning); }, plugins: [{ name: 'isolated-slash-context', resolveId(source) {
        if (source.endsWith('/view-scope')) return scope;
        if (source.endsWith('/document-appearance-store')) return appearance;
        if (source.endsWith('/DocumentBanner')) return banner;
        if (source.endsWith('/page-access-level-store')) return access;
        if (source.endsWith('/tabs-store')) return tabs;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = result.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No slash editor bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper slash editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
