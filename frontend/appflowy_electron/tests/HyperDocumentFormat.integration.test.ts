import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..'), resolvePackage = createRequire(path.join(root, 'package.json')).resolve;
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
(available ? describe : describe.skip)('Hyper document formatting in Electron', () => {
  it('keeps selection through link/color popups, preserves atomic runs, restores focus and rejects stale or read-only changes', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-document-format-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'); fs.writeFileSync(i18n, 'export const tr=key=>key;export function useTr(){return {tr}}');
      fs.appendFileSync(i18n, '\nexport const resolveLocale=value=>value;export const setLocale=()=>{};');
      const scope = path.join(temporary, 'scope.ts'), appearance = path.join(temporary, 'appearance.ts'), banner = path.join(temporary, 'banner.ts'), access = path.join(temporary, 'access.ts'), tabs = path.join(temporary, 'tabs.ts');
      fs.writeFileSync(scope, 'export const usePageAccessLevel=()=>null;export const useViewPluginNotifier=()=>null;export const useViewScope=()=>null;export const ViewScopeProvider=({children})=>children;');
      fs.writeFileSync(appearance, 'export const useDocumentFontSize=()=>({fontSize:16});');
      fs.writeFileSync(banner, 'export const DocumentBanner=()=>null;export const deletePermanently=async()=>true;export const restorePage=async()=>true;');
      fs.writeFileSync(access, "export const isEditable=()=>true;export const viewIsLocked=()=>false;export const ShareAccessLevel={fullAccess:'fullAccess',readAndWrite:'readAndWrite'};");
      fs.writeFileSync(tabs, 'export const tabsActions={openView:()=>{}};');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import{createRoot}from'react-dom/client';import{create}from'@bufbuild/protobuf';
        import{DocumentDataPBSchema}from'@shared/protobuf/flowy-document/entities_pb';
        import{HyperDocumentFormat}from'@/features/document-format/HyperDocumentFormat';
        import{hyperApplyDocumentFormat,hyperCaptureDocumentFormat}from'@/features/document-format/HyperDocumentFormatModel';
        import{hyperBlockText,hyperEditText,hyperPlainText}from'@/features/document/HyperDocumentModel';
        import{hyperGetSelection,hyperSetSelection,hyperReadText,hyperWriteText}from'@/features/document/HyperDocumentDom';
        import{HyperDocumentEditor}from'@/features/document/HyperDocumentPage';
        import{HyperDocumentSession}from'@/features/document/HyperDocumentSession';
        window.hyperFormatChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)},equal=(a,b,message)=>assert(JSON.stringify(a)===JSON.stringify(b),message+': '+JSON.stringify({actual:a,expected:b}));
          const wait=async(check)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Timed out: '+check);await new Promise(resolve=>setTimeout(resolve,10));}};
          const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
          const enter=(input,value)=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const original=[{insert:'A🌍B',attributes:{bold:true,custom:{keep:true},bg_color:'0x4dffeb3b'}},{insert:'$',attributes:{mention:{type:'page',page_id:'target'}}},{insert:{custom:'embed'}},{insert:' tail'}];
          // Legacy external snapshot: surrounding edits retain the embed without inserting it through the native text API.
          let doc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'},p:{id:'p',ty:'paragraph',data:'{}',parentId:'root',childrenId:'pchildren',oneOfExternalId:{case:'externalId',value:'text'},oneOfExternalType:{case:'externalType',value:'text'}}},meta:{childrenMap:{children:{children:['p']}},textMap:{text:JSON.stringify(original)}}}),active={id:'p',selection:{start:1,end:3}},editable=true,writes=0;
          const editor=document.createElement('div');editor.contentEditable='true';editor.tabIndex=0;document.body.append(editor);hyperWriteText(editor,original);
          equal(hyperReadText(editor),original,'existing ARGB and atomic attributes round-trip');assert(editor.firstElementChild.style.backgroundColor.includes('255, 235, 59'),'legacy highlight is painted');
          const opened=[];window.appflowy={shell:{openExternal:async url=>{opened.push(url)}}};
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
          const props={editable,onPrepare:()=>hyperCaptureDocumentFormat(doc,active),onApply:async(selection,patch)=>{const changed=hyperApplyDocumentFormat(doc,selection,patch,editable);doc=changed.document;writes++;hyperWriteText(editor,hyperBlockText(doc,doc.blocks.p))},onRestoreSelection:selection=>{editor.focus();hyperSetSelection(editor,{start:selection.start,end:selection.end});return editor}};
          app.render(<HyperDocumentFormat {...props}/>);await wait(()=>button('Link and color'));
          const show=async()=>{editor.focus();hyperSetSelection(editor,active.selection);button('Link and color').focus();button('Link and color').click();await wait(()=>document.querySelector('[aria-label="Link address"]'));};
          await show();enter(document.querySelector('[aria-label="Link address"]'),'javascript:alert(1)');button('Apply formatting').click();await wait(()=>document.querySelector('[role="alert"]'));assert(writes===0,'unsafe link is rejected without writing');
          enter(document.querySelector('[aria-label="Link address"]'),'https://example.org/path');button('Apply formatting').click();await wait(()=>!document.querySelector('[data-slot="dialog-content"]'));
          await wait(()=>document.activeElement===editor);equal(hyperGetSelection(editor),{start:1,end:3},'selection restored after applying through popup');
          let runs=hyperBlockText(doc,doc.blocks.p);assert(runs.some(run=>run.insert==='🌍'&&run.attributes.href==='https://example.org/path'&&run.attributes.bold&&run.attributes.custom.keep),'link affects exact UTF-16 selection and preserves marks');
          const anchor=editor.querySelector('a:not([data-hyper-mention-id])');assert(anchor,'safe link renders as an anchor');anchor.click();assert(opened.length===0,'plain editable click places caret without opening browser');anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));await wait(()=>opened.length===1);
          let bubbledEnter=0;const bodyKey=event=>{if(event.key==='Enter')bubbledEnter++};document.body.addEventListener('keydown',bodyKey);anchor.focus();anchor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>opened.length===2);assert(bubbledEnter===0,'keyboard activation cannot reach editor splitter');document.body.removeEventListener('keydown',bodyKey);
          editor.contentEditable='false';anchor.click();await wait(()=>opened.length===3);editor.contentEditable='true';
          await show();document.querySelector('[aria-label="Text color"]').click();await wait(()=>document.querySelector('[aria-label="Hex color"]'));const hex=document.querySelector('[aria-label="Hex color"]');hex.focus();hex.select();document.execCommand('insertText',false,'#123456');await new Promise(resolve=>requestAnimationFrame(resolve));assert(document.activeElement===hex,'hex input retains focus while choosing a color');hex.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[data-slot="color-picker-trigger"]').textContent.toLowerCase().includes('123456'));document.querySelector('[data-slot="color-picker-trigger"]').click();await wait(()=>!document.querySelector('[aria-label="Hex color"]'));button('Apply formatting').click();await wait(()=>!document.querySelector('[data-slot="dialog-content"]'));
          runs=hyperBlockText(doc,doc.blocks.p);const colored=runs.find(run=>run.insert==='🌍');equal(colored.attributes,{bold:true,custom:{keep:true},bg_color:'0x4dffeb3b',href:'https://example.org/path',font_color:'0xff123456'},'picker writes upstream color and keeps untouched attributes');equal(hyperReadText(editor),runs,'formatted DOM parses without changing stored color representation');
          active={id:'p',selection:{start:3,end:3}};await show();assert(document.querySelector('[aria-label="Link address"]').value==='https://example.org/path','caret edits existing link');button('Remove link').click();await wait(()=>!document.querySelector('[data-slot="dialog-content"]'));assert(!editor.querySelector('a:not([data-hyper-mention-id])'),'remove link keeps mention anchor');assert(editor.querySelector('[data-hyper-mention-id="target"]')&&editor.querySelector('[data-hyper-embed]'),'atomic content remains present');
          active={id:'p',selection:{start:1,end:3}};await show();enter(document.querySelector('[aria-label="Link address"]'),'https://example.org/new');doc=hyperEditText(doc,'p',[{insert:'Changed text'}]).document;hyperWriteText(editor,hyperBlockText(doc,doc.blocks.p));const before=writes;button('Apply formatting').click();await wait(()=>document.querySelector('[role="alert"]'));assert(writes===before&&hyperPlainText(hyperBlockText(doc,doc.blocks.p))==='Changed text','stale formatting cannot overwrite newer text');
          editable=false;app.render(<HyperDocumentFormat {...props} editable={false}/>);await wait(()=>button('Apply formatting').disabled);button('Apply formatting').click();assert(writes===before,'permission change blocks writes');button('Cancel').click();await wait(()=>!document.querySelector('[data-slot="dialog-content"]'));assert(button('Link and color').disabled,'read-only toolbar is disabled');
          const safe=document.createElement('div');hyperWriteText(safe,[{insert:'Unsafe',attributes:{font_color:'url(https://tracker)',bg_color:'red;background:url(x)',href:'javascript:alert(1)',custom:'keep'}}]);assert(safe.firstElementChild.style.length===0&&!safe.querySelector('a'),'unsafe imported URL/CSS never reaches DOM styles or anchors');assert(hyperReadText(safe)[0].attributes.custom==='keep','unknown attributes stay intact');
          const imported=document.createElement('div'),span=document.createElement('span');span.style.color='rgb(255, 0, 0)';span.style.backgroundColor='rgba(0, 0, 255, 0.5)';span.textContent='Imported';imported.append(span);equal(hyperReadText(imported),[{insert:'Imported',attributes:{font_color:'0xffff0000',bg_color:'0x800000ff'}}],'legacy DOM colors parse to compatible attributes');
          app.unmount();
          const nativeDoc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'},p:{id:'p',ty:'paragraph',data:JSON.stringify({delta:[{insert:'Native 🌍 selection'}]}),parentId:'root',childrenId:'pchildren'}},meta:{childrenMap:{children:{children:['p']}}}});
          const nativeWrites=[];const session=new HyperDocumentSession('native-format',{open:async()=>nativeDoc,read:async()=>nativeDoc,apply:async(id,actions)=>{nativeWrites.push(actions)},close:async()=>{},history:async()=>{},listen:()=>()=>{}});await session.flush();const native=createRoot(container);native.render(<HyperDocumentEditor session={session} title="Native page" editable={true}/>);await wait(()=>container.querySelector('[data-hyper-text="p"]'));
          const paragraph=container.querySelector('[data-hyper-text="p"]');paragraph.focus();hyperSetSelection(paragraph,{start:7,end:9});paragraph.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));button('Link and color').click();await wait(()=>document.querySelector('[aria-label="Link address"]'));enter(document.querySelector('[aria-label="Link address"]'),'https://example.org/native');button('Apply formatting').click();await wait(()=>!document.querySelector('[data-slot="dialog-content"]'));await session.flush();await wait(()=>document.activeElement===paragraph);equal(hyperGetSelection(paragraph),{start:7,end:9},'mounted editor restores selected range');
          const persisted=hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p);assert(persisted.some(run=>run.insert==='🌍'&&run.attributes.href==='https://example.org/native'),'mounted editor applies URL to captured UTF-16 text');assert(nativeWrites.length===1,'mounted formatting sends one incremental core write');
          paragraph.querySelector('a').focus();paragraph.querySelector('a').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert(container.querySelectorAll('[data-hyper-text]').length===1,'native page hyperlink activation never splits its block');
          const beforeIME=hyperPlainText(persisted);paragraph.focus();hyperSetSelection(paragraph,{start:beforeIME.length,end:beforeIME.length});paragraph.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'漢'}));document.execCommand('insertText',false,'漢');assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))===beforeIME,'formatting preserves IME commit boundary');paragraph.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'漢'}));await session.flush();assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))===beforeIME+'漢','IME persists after link formatting');native.unmount();await session.dispose();
          return 'Hyper document format checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'isolated-format-context', resolveId(source) {
        if (source.endsWith('/i18n')) return i18n;
        if (source.endsWith('/view-scope')) return scope;
        if (source.endsWith('/document-appearance-store')) return appearance;
        if (source.endsWith('/DocumentBanner')) return banner;
        if (source.endsWith('/page-access-level-store')) return access;
        if (source.endsWith('/tabs-store')) return tabs;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No native formatting bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperFormatChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); expect(stdout).toContain('Hyper document format checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 35_000);
});
