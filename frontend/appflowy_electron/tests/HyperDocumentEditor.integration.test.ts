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
(available ? describe : describe.skip)('Hyper document editor in Electron', () => {
  it('edits, formats and splits text, inserts and opens atomic page links, handles IME and paste, and enforces read-only state', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-document-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), scope = path.join(temporary, 'scope.ts'), appearance = path.join(temporary, 'appearance.ts'), banner = path.join(temporary, 'banner.ts'), access = path.join(temporary, 'access.ts');
      fs.writeFileSync(i18n, `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))}; export function tr(key, options={}) { let text = key.split('.').reduce((value, part)=>value?.[part],en) ?? key; for(const [name,value] of Object.entries(options.namedArgs??{})) text=text.replaceAll('{'+name+'}',String(value)); return text; } export function useTr(){ return {tr}; }`);
      fs.appendFileSync(i18n, '\nexport const resolveLocale=value=>value;export const setLocale=()=>{};');
      fs.writeFileSync(scope, 'export const usePageAccessLevel=()=>null; export const useViewPluginNotifier=()=>null; export const useViewScope=()=>null; export const ViewScopeProvider=({children})=>children;');
      fs.writeFileSync(appearance, 'export const useDocumentFontSize=()=>({fontSize:16});');
      fs.writeFileSync(banner, 'export const DocumentBanner=()=>null; export const deletePermanently=async()=>true; export const restorePage=async()=>true;');
      fs.writeFileSync(access, 'export const ShareAccessLevel={fullAccess:"fullAccess",readAndWrite:"readAndWrite",readAndComment:"readAndComment",readOnly:"readOnly"}; export const isEditable=state=>!state.isLocked; export const viewIsLocked=view=>view.oneOfIsLocked.case==="isLocked"&&view.oneOfIsLocked.value;');
      const tabs = path.join(temporary, 'tabs.ts');
      fs.writeFileSync(tabs, 'export const tabsActions={openView:view=>{window.hyperOpenedViews.push(view)}};');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';
        import {ViewIdPBSchema,ViewPBSchema,RepeatedViewPBSchema} from '@shared/protobuf/flowy-folder/view_pb';
        import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';
        import {UserProfilePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {FlowyErrorSchema} from '@shared/protobuf/flowy-error/errors_pb';
        import {HyperDocumentEditor} from '@/features/document/HyperDocumentPage';
        import {HyperDocumentSession} from '@/features/document/HyperDocumentSession';
        import {hyperBlockText,hyperPlainText,hyperEditText} from '@/features/document/HyperDocumentModel';
        import {hyperPageMention} from '@/features/document-links/HyperDocumentLinkService';
        import {hyperSetSelection,hyperWriteText,hyperReadText} from '@/features/document/HyperDocumentDom';
        import {HyperDocumentMentionResolver} from '@/features/document/HyperDocumentMentions';
        window.hyperInteractionResult=(async()=>{
          const assert=(ok,message)=>{if(!ok) throw Error(message)};
          const wait=async(check)=>{ const end=Date.now()+5000; while(!check()){if(Date.now()>end)throw Error('Timed out: '+check);await new Promise(r=>setTimeout(r,10));} };
          let allowed=true;
          const target=create(ViewPBSchema,{id:'linked-page',name:'A long linked page title 🌍',parentViewId:'workspace'});
          window.hyperOpenedViews=[];
          window.appflowy={core:{onNotification:()=>()=>{},request:async(event,payload)=>{
            const reply=(schema,values)=>({status:0,payload:toBinary(schema,create(schema,values))});
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});
            if(event==='GetUserProfile')return reply(UserProfilePBSchema,{id:1n});
            if(event==='GetAllViews')return reply(RepeatedViewPBSchema,{items:[target]});
            if(event==='GetView'){
              const id=fromBinary(ViewIdPBSchema,payload).value;
              if(allowed&&id===target.id)return reply(ViewPBSchema,target);
              return {status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:'Unavailable'}))};
            }
            throw Error('Unexpected native test event: '+event);
          }}};
          const doc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'},p:{id:'p',ty:'paragraph',data:'{}',childrenId:'pchildren',parentId:'root'}},meta:{childrenMap:{children:{children:['p']},pchildren:{children:[]}}}});
          const writes=[];
          const session=new HyperDocumentSession('test',{open:async()=>doc,read:async()=>doc,apply:async(id,actions)=>{writes.push(actions)},close:async()=>{},history:async()=>{},listen:()=>()=>{}});
          await session.flush();
          const container=document.createElement('div');document.body.append(container);
          const app=createRoot(container); app.render(<HyperDocumentEditor session={session} title="Test page" editable={true}/>);
          await wait(()=>container.querySelector('[data-hyper-text="p"]'));
          const first=container.querySelector('[data-hyper-text="p"]'); first.focus();first.textContent='Hello world';hyperSetSelection(first,{start:5,end:5});first.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Hello world'}));await session.flush();
          assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))==='Hello world','typing persisted: '+JSON.stringify({state:session.store.getState(),content:first.textContent,editable:first.contentEditable,writes}));
          first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
          await wait(()=>container.querySelectorAll('[data-hyper-text]').length===2);await session.flush();
          const editors=[...container.querySelectorAll('[data-hyper-text]')];
          assert(editors[0].textContent==='Hello','split left'); assert(editors[1].textContent===' world','split right');
          first.focus();hyperSetSelection(first,{start:0,end:5});first.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          container.querySelector('[aria-label="Bold"]').click();await session.flush();
          assert(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p)[0].attributes.bold===true,'bold persisted');
          const second=editors[1];second.focus();second.textContent='/';hyperSetSelection(second,{start:1,end:1});second.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'/'}));
          await wait(()=>document.querySelector('[role="menu"]'));
          const heading=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='Heading 1'); assert(heading,'slash heading command');heading.click();
          await session.flush();await wait(()=>!document.querySelector('[role="menu"]'));
          const secondId=second.dataset.hyperText;assert(session.store.getState().document.blocks[secondId].ty==='heading','slash converted block');
          container.querySelector('[role="toolbar"] [data-slot="dropdown-menu-trigger"]').click();
          await wait(()=>document.querySelector('[role="menu"]'));
          const tableCommand=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='Table');assert(tableCommand,'table insert command');tableCommand.click();
          await wait(()=>container.querySelectorAll('tbody tr').length===3);await session.flush();
          const cell=container.querySelector('tbody [data-hyper-text]');cell.focus();cell.textContent='Edited cell';hyperSetSelection(cell,{start:11,end:11});cell.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Edited cell'}));await session.flush();
          const cellId=cell.dataset.hyperText;assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks[cellId]))==='Edited cell','table cell persisted');
          [...container.querySelectorAll('button')].find(button=>button.textContent==='Add row').click();await wait(()=>container.querySelectorAll('tbody tr').length===4);
          [...container.querySelectorAll('button')].find(button=>button.textContent==='Add column').click();await wait(()=>container.querySelector('tbody tr').children.length===4);await session.flush();
          session.change(doc=>hyperEditText(doc,'p',[{insert:'See ',attributes:{bold:true}},...hyperPageMention(target.id),{insert:' tail',attributes:{italic:true}}]));
          await wait(()=>first.querySelector('a')?.textContent===target.name);
          first.focus();hyperSetSelection(first,{start:5,end:5});document.execCommand('insertText',false,'typed');await session.flush();
          let saved=hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p);
          assert(hyperPlainText(saved)==='See $typed tail','typing after long mention uses logical offsets');
          assert(JSON.stringify(saved).includes('page_id'),'native typing preserves upstream mention');
          hyperSetSelection(first,{start:10,end:10});first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await session.flush();
          await wait(()=>first.textContent==='See '+target.name+'typed');
          const splitId=session.store.getState().document.meta.childrenMap.children.children[1];
          assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks[splitId]))===' tail','split after mention preserves suffix');
          const anchor=first.querySelector('a');anchor.click();await wait(()=>window.hyperOpenedViews.length===1);
          assert(window.hyperOpenedViews[0].id===target.id,'mention opens exact core view');
          const beforeKeyboard=container.querySelectorAll('[data-hyper-text]').length;
          anchor.focus();anchor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>window.hyperOpenedViews.length===2);
          assert(container.querySelectorAll('[data-hyper-text]').length===beforeKeyboard,'keyboard link activation does not split editor');
          allowed=false;anchor.click();await wait(()=>anchor.getAttribute('aria-disabled')==='true');
          assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))==='See $typed','unavailable target preserves original delta');
          allowed=true;session.change(doc=>hyperEditText(doc,'p',[{insert:'🌍abc'}]));await wait(()=>first.textContent==='🌍abc');
          first.focus();hyperSetSelection(first,{start:2,end:2});first.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          const linkButton=[...container.querySelectorAll('button')].find(button=>button.textContent==='Link to page');assert(linkButton,'mounted page links toolbar');linkButton.focus();linkButton.click();
          await wait(()=>document.querySelector('[role="dialog"]')&&[...document.querySelectorAll('[role="dialog"] button')].some(button=>button.textContent===target.name));
          [...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent===target.name).click();
          await wait(()=>!document.querySelector('[role="dialog"]'));await session.flush();
          saved=hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p);
          assert(hyperPlainText(saved)==='🌍$abc','picker inserts at UTF-16 selection: '+JSON.stringify(saved));
          assert(saved.some(run=>run.insert==='$'&&run.attributes?.mention?.page_id===target.id),'picker writes upstream mention');
          await wait(()=>first.querySelector('a')?.textContent===target.name);
          first.focus();
          const labelRange=document.createRange();labelRange.setStart(first.querySelector('a').firstChild,3);labelRange.collapse(true);
          window.getSelection().removeAllRanges();window.getSelection().addRange(labelRange);
          first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));await session.flush();
          assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))==='🌍$\\nabc','soft Enter normalizes position inside atomic label');
          const pasteRange=document.createRange();pasteRange.setStart(first.querySelector('a').firstChild,2);pasteRange.setEnd(first.querySelector('a').firstChild,5);
          window.getSelection().removeAllRanges();window.getSelection().addRange(pasteRange);
          const clipboard=new DataTransfer();clipboard.setData('text/plain','P\\r\\nQ');first.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));await session.flush();
          assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))==='🌍P\\nQ\\nabc','paste replaces complete atomic token and preserves surrounding text');
          const beforeIME=hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p));
          first.focus();hyperSetSelection(first,{start:beforeIME.length,end:beforeIME.length});first.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'漢'}));document.execCommand('insertText',false,'漢');
          assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))===beforeIME,'composition input waits for commit');
          first.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'漢'}));await session.flush();
          assert(hyperPlainText(hyperBlockText(session.store.getState().document,session.store.getState().document.blocks.p))===beforeIME+'漢','composition commit persists');
          app.render(<HyperDocumentEditor session={session} title="Test page" editable={false}/>);
          await wait(()=>container.querySelector('[data-hyper-text="p"]').contentEditable==='false');
          assert(container.querySelector('[aria-label="Bold"]').disabled,'read-only formatting');
          assert(writes.length>=4,'core action writes');await session.dispose();
          const outlineDoc=create(DocumentDataPBSchema,{pageId:'outline-root',blocks:{
            'outline-root':{id:'outline-root',ty:'page',data:'{}',childrenId:'outline-children'},
            outer:{id:'outer',ty:'toggle_list',parentId:'outline-root',childrenId:'outer-children',data:JSON.stringify({delta:[{insert:'Outer toggle'}]})},
            inner:{id:'inner',ty:'toggle_list',parentId:'outer',childrenId:'inner-children',data:JSON.stringify({delta:[{insert:'Inner toggle'}]})},
            hidden:{id:'hidden',ty:'heading',parentId:'inner',childrenId:'hidden-children',data:JSON.stringify({level:2,delta:[{insert:'Nested heading 🌍'}]})},
            ending:{id:'ending',ty:'heading',parentId:'outline-root',childrenId:'ending-children',data:JSON.stringify({level:6,delta:[]})},
          },meta:{childrenMap:{'outline-children':{children:['outer','ending']},'outer-children':{children:['inner']},'inner-children':{children:['hidden']}}}});
          const outlineWrites=[];
          const outlineSession=new HyperDocumentSession('outline-test',{open:async()=>outlineDoc,read:async()=>outlineDoc,apply:async(id,actions)=>outlineWrites.push(actions),close:async()=>{},history:async()=>{},listen:()=>()=>{}});
          await outlineSession.flush();
          app.render(<HyperDocumentEditor key="outline" session={outlineSession} title="Outline page" editable={false}/>);
          await wait(()=>container.querySelector('[data-hyper-text="hidden"]'));
          const outlineTrigger=()=>[...container.querySelectorAll('[role="toolbar"] button')].find(button=>button.textContent==='Outline');
          const headingButton=label=>[...document.querySelectorAll('nav[aria-label="Outline"] button')].find(button=>button.getAttribute('aria-label')===label);
          const toggleButtons=[...container.querySelectorAll('button[aria-expanded]')].filter(button=>button.getAttribute('aria-label')==='Toggle children');
          assert(toggleButtons.length===2,'nested outline fixture has two toggles');
          toggleButtons[1].click();await wait(()=>!container.querySelector('[data-hyper-text="hidden"]'));
          const noWritesBefore=outlineWrites.length;
          outlineTrigger().click();await wait(()=>headingButton('Heading 2: Nested heading 🌍'));
          const nestedButton=headingButton('Heading 2: Nested heading 🌍');nestedButton.focus();nestedButton.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
          assert(document.activeElement===headingButton('Heading 6: Untitled heading'),'outline End moves to final heading');
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
          assert(document.activeElement===nestedButton,'outline Home returns to first heading');
          nestedButton.click();await wait(()=>document.activeElement?.getAttribute('data-hyper-text')==='hidden');
          assert(container.querySelector('[data-hyper-text="hidden"]').contentEditable==='false','outline navigates read-only headings');
          assert(outlineWrites.length===noWritesBefore,'revealing a hidden heading writes no content');
          const outerToggle=[...container.querySelectorAll('button[aria-expanded]')].find(button=>button.getAttribute('aria-label')==='Toggle children');
          outerToggle.click();await wait(()=>!container.querySelector('[data-hyper-text="inner"]'));
          outlineTrigger().click();await wait(()=>headingButton('Heading 2: Nested heading 🌍'));headingButton('Heading 2: Nested heading 🌍').click();
          await wait(()=>document.activeElement?.getAttribute('data-hyper-text')==='hidden');
          assert(outlineWrites.length===noWritesBefore,'nested reveal stays local');
          outlineTrigger().click();await wait(()=>headingButton('Heading 2: Nested heading 🌍'));
          outlineSession.change(doc=>hyperEditText(doc,'hidden',[{insert:'Renamed nested'}]));await outlineSession.flush();
          await wait(()=>headingButton('Heading 2: Renamed nested'));
          assert(!headingButton('Heading 2: Nested heading 🌍'),'outline title follows document updates');
          document.querySelector('nav[aria-label="Outline"] button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
          await wait(()=>!document.querySelector('nav[aria-label="Outline"]'));
          await wait(()=>document.activeElement===outlineTrigger());
          await outlineSession.dispose();
          const legacyDoc=create(DocumentDataPBSchema,{pageId:'legacy-root',blocks:{
            'legacy-root':{id:'legacy-root',ty:'page',data:'{}',childrenId:'legacy-children'},
            legacy:{id:'legacy',ty:'paragraph',parentId:'legacy-root',childrenId:'legacy-inline',data:JSON.stringify({delta:[{insert:{future_embed:{keep:true}}},{insert:'$',attributes:{mention:{type:'date',date:'2030-01-01T12:00:00.000Z',include_time:true}}}]})},
            neighbor:{id:'neighbor',ty:'paragraph',parentId:'legacy-root',childrenId:'neighbor-children',data:JSON.stringify({delta:[{insert:'Editable neighbor'}]})},
          },meta:{childrenMap:{'legacy-children':{children:['legacy','neighbor']}}}});
          const legacyWrites=[],originalLegacy=legacyDoc.blocks.legacy.data;
          const legacySession=new HyperDocumentSession('legacy-test',{open:async()=>legacyDoc,read:async()=>legacyDoc,apply:async(id,actions)=>legacyWrites.push(actions),close:async()=>{},history:async()=>{},listen:()=>()=>{}});
          await legacySession.flush();app.render(<HyperDocumentEditor key="legacy" session={legacySession} title="Legacy page" editable={true}/>);
          await wait(()=>container.querySelector('[data-hyper-text="legacy"]')?.contentEditable==='false'&&container.querySelector('[data-hyper-text="neighbor"]')?.contentEditable==='true');
          const legacyEditor=container.querySelector('[data-hyper-text="legacy"]'),neighbor=container.querySelector('[data-hyper-text="neighbor"]');
          assert(legacyEditor.getAttribute('aria-description'),'unsupported inline content has an accessible explanation');
          legacyEditor.querySelector('[data-hyper-date-mention]').click();await new Promise(resolve=>setTimeout(resolve,20));
          assert(!document.querySelector('[role="dialog"]'),'date inside unsupported inline content stays read-only');
          legacyEditor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
          legacyEditor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'blocked'}));await legacySession.flush();
          assert(legacyWrites.length===0&&legacySession.store.getState().document.blocks.legacy.data===originalLegacy,'read-only input and Enter preserve unsupported stored content');
          neighbor.focus();neighbor.textContent='Neighbor still edits';hyperSetSelection(neighbor,{start:20,end:20});neighbor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Neighbor still edits'}));await legacySession.flush();
          assert(legacyWrites.length===1&&hyperPlainText(hyperBlockText(legacySession.store.getState().document,legacySession.store.getState().document.blocks.neighbor))==='Neighbor still edits','unsupported text does not disable other blocks');
          assert(legacySession.store.getState().document.blocks.legacy.data===originalLegacy,'neighbor edits leave legacy data intact');
          app.unmount();await legacySession.dispose();
          const atomicHost=document.createElement('div');document.body.append(atomicHost);
          const atomicRuns=[...Array.from({length:12},(_,i)=>hyperPageMention('page-'+i)).flat(),...hyperPageMention('page-0'),...hyperPageMention('missing')];
          hyperWriteText(atomicHost,atomicRuns);
          let reading=0,maximum=0,listening=0;
          const reads=[],listeners=new Map();
          const resolver=new HyperDocumentMentionResolver({view:async id=>{
            reads.push(id);reading++;maximum=Math.max(maximum,reading);await new Promise(resolve=>setTimeout(resolve,10));reading--;
            if(id==='missing')throw Error('Forbidden title must never render');
            return create(ViewPBSchema,{id,name:'Permitted title '+id});
          },listen:(id,refresh,unavailable)=>{listening++;listeners.set(id,{refresh,unavailable});return()=>{listening--;listeners.delete(id)}},open:()=>{}});
          const stop=resolver.watch(atomicHost);
          assert(reading===4,'mention title lookup concurrency starts bounded');
          await wait(()=>atomicHost.querySelectorAll('[aria-disabled="false"]').length===13&&atomicHost.querySelector('[data-hyper-mention-id="missing"]').getAttribute('aria-disabled')==='true');
          assert(maximum===4&&reads.filter(id=>id==='page-0').length===1,'bounded lookup and repeated-target deduplication');
          assert(JSON.stringify(hyperReadText(atomicHost))===JSON.stringify(atomicRuns),'resolved labels preserve every raw run');
          const renamed=atomicHost.querySelector('[data-hyper-mention-id="page-1"]');listeners.get('page-1').refresh();listeners.get('page-1').unavailable();
          await new Promise(resolve=>setTimeout(resolve,30));assert(renamed.textContent==='Page unavailable','late title response cannot restore inaccessible label');
          resolver.dispose();stop();assert(listening===0,'all mounted mention observers released');
          return 'Hyper editor interaction checks passed';
        })()
      `);
      const bundled = await build({ input: entry,
        onwarn(warning, defaultHandler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') defaultHandler(warning); },
        plugins: [{ name: 'isolated-document-context', resolveId(source) {
          if (source.endsWith('/view-scope')) return scope;
          if (source.endsWith('/document-appearance-store')) return appearance;
          if (source.endsWith('/DocumentBanner')) return banner;
          if (source.endsWith('/page-access-level-store')) return access;
          if (source.endsWith('/tabs-store')) return tabs;
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
          return null;
        } }],
        resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false,
      });
      const code = bundled.output.find(chunk => chunk.type === 'chunk');
      if (code?.type !== 'chunk') throw new Error('No interaction test bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperInteractionResult`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"></head><body></body></html>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log('Hyper editor interaction checks passed');app.exit(0);}catch(e){console.error(e.stack);app.exit(1);}}).catch(e=>{console.error(e);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper editor interaction checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
