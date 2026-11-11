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
(available ? describe : describe.skip)('Hyper inline database editor in Electron', () => {
  it('inserts at the captured page location, links a shared view and combines parent/child read-only state', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-inline-db-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), appearance = path.join(temporary, 'appearance.ts'), banner = path.join(temporary, 'banner.ts'), tabs = path.join(temporary, 'tabs.ts'), body = path.join(temporary, 'body.tsx');
      fs.writeFileSync(i18n, `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))}; export function tr(key,options={}){let text=key.split('.').reduce((value,part)=>value?.[part],en)??key;for(const [name,value]of Object.entries(options.namedArgs??{}))text=text.replaceAll('{'+name+'}',String(value));return text;} export function useTr(){return{tr}}`);
      fs.appendFileSync(i18n, '\nexport const resolveLocale=value=>value;export const setLocale=()=>{};');
      fs.writeFileSync(appearance, 'export const useDocumentFontSize=()=>({fontSize:16});');
      fs.writeFileSync(banner, 'export const DocumentBanner=()=>null;export const deletePermanently=async()=>true;export const restorePage=async()=>true;');
      fs.writeFileSync(tabs, 'export const tabsActions={openView:async view=>{window.openedViews.push(view)},updateView:()=>{}};');
      fs.writeFileSync(body, `import React from 'react';import {usePageAccessLevel} from '@/features/view-header/view-scope';export function HyperDatabasePage({view,readOnly}){const access=usePageAccessLevel();return <button data-inline-view={view.id} data-parent-readonly={String(readOnly)} data-own-locked={String(access?.isLocked)} disabled={readOnly||!access||access.isLoadingLockStatus||access.isLocked}>Nested mutation</button>}`);
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {DocumentDataPBSchema} from '@shared/protobuf/flowy-document/entities_pb';
        import {CreateViewPayloadPBSchema,RepeatedViewPBSchema,SharedViewSectionPB,GetSharedViewSectionResponsePBSchema,ViewIdPBSchema,ViewLayoutPB,ViewPBSchema} from '@shared/protobuf/flowy-folder/view_pb';
        import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';
        import {UserProfilePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {DatabaseIdPBSchema} from '@shared/protobuf/flowy-database2/database_entities_pb';
        import {DatabaseViewRowIdPBSchema,RowMetaPBSchema} from '@shared/protobuf/flowy-database2/row_entities_pb';
        import {FlowyErrorSchema} from '@shared/protobuf/flowy-error/errors_pb';
        import {HyperDocumentEditor} from '@/features/document/HyperDocumentPage';
        import {HyperDocumentSession} from '@/features/document/HyperDocumentSession';
        import {hyperChildren,hyperBlockText,hyperPlainText} from '@/features/document/HyperDocumentModel';
        import {hyperSetSelection} from '@/features/document/HyperDocumentDom';
        import {hyperCaptureDocumentDatabaseAnchor,hyperInsertDocumentDatabase} from '@/features/document-database/HyperDocumentDatabaseModel';
        window.hyperChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed out: '+check+'; '+document.querySelector('[role="dialog"]')?.textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
          const make=(id,name,layout=ViewLayoutPB.Document,parentViewId='workspace')=>create(ViewPBSchema,{id,name,layout,parentViewId});
          const page=make('document','Document'),source=make('source','Source database',ViewLayoutPB.Grid),workspace=make('workspace','Workspace'),locked=make('locked','Locked database',ViewLayoutPB.Grid);
          locked.oneOfIsLocked={case:'isLocked',value:true};workspace.childViews=[page,source,locked];
          const views=new Map([[page.id,page],[source.id,source],[workspace.id,workspace],[locked.id,locked]]),creates=[];let count=0,rowPresent=true;
          const rowId='d487eb1a-cf8d-450c-9519-1e309492940b';
          window.openedViews=[];
          window.appflowy={core:{onNotification:()=>()=>{},request:async(event,payload)=>{
            const reply=(schema,value)=>({status:0,payload:toBinary(schema,create(schema,value))});
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});
            if(event==='GetUserProfile')return reply(UserProfilePBSchema,{id:1n});
            if(event==='GetAllViews')return reply(RepeatedViewPBSchema,{items:[...views.values()]});
            if(event==='GetView'){const id=fromBinary(ViewIdPBSchema,payload).value;return views.has(id)?reply(ViewPBSchema,views.get(id)):{status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:'Unavailable'}))};}
            if(event==='GetSharedViewSection')return reply(GetSharedViewSectionResponsePBSchema,{section:SharedViewSectionPB.PublicSection});
            if(event==='GetDatabaseId')return reply(DatabaseIdPBSchema,{value:'shared-database'});
            if(event==='GetRowMeta'){const values=fromBinary(DatabaseViewRowIdPBSchema,payload);if(rowPresent&&values.viewId==='source'&&values.rowId===rowId)return reply(RowMetaPBSchema,{id:rowId,oneOfDocumentId:{case:'documentId',value:'row-document'},oneOfIsDocumentEmpty:{case:'isDocumentEmpty',value:false}});return {status:1,payload:toBinary(FlowyErrorSchema,create(FlowyErrorSchema,{msg:'Row unavailable'}))};}
            if(event==='CreateView'){const values=fromBinary(CreateViewPayloadPBSchema,payload);creates.push(values);const created=make('new-'+(++count),values.name,values.layout,values.parentViewId);views.set(created.id,created);views.get(values.parentViewId).childViews.push(created);return reply(ViewPBSchema,created);}
            throw Error('Unexpected event: '+event);
          }}};
          const doc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'},p:{id:'p',ty:'paragraph',data:JSON.stringify({delta:[{insert:'Anchor 🌍',attributes:{bold:true}}]}),parentId:'root',childrenId:'pc'},tail:{id:'tail',ty:'paragraph',data:JSON.stringify({delta:[{insert:'Tail'}]}),parentId:'root',childrenId:'tc'}},meta:{childrenMap:{children:{children:['p','tail']},pc:{children:[]},tc:{children:[]}}}});
          const writes=[];const session=new HyperDocumentSession('document',{open:async()=>doc,read:async()=>doc,apply:async(id,actions)=>{writes.push(actions)},close:async()=>{},history:async()=>{},listen:()=>()=>{}});await session.flush();
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
          const render=editable=>app.render(<HyperDocumentEditor session={session} title="Document" editable={editable}/>);render(true);
          await wait(()=>host.querySelector('[data-hyper-text="p"]'));
          const first=host.querySelector('[data-hyper-text="p"]');first.focus();hyperSetSelection(first,{start:2,end:2});first.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          const trigger=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Database');
          trigger().focus();trigger().click();await wait(()=>document.querySelector('[role="dialog"]'));
          await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Create database')?.disabled===false);
          [...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Create database').click();
          await wait(()=>!document.querySelector('[role="dialog"]'));await session.flush();await wait(()=>host.querySelector('[data-inline-view="new-1"]')?.disabled===false);
          let saved=session.store.getState().document,ids=hyperChildren(saved,saved.blocks.root);
          assert(ids[0]==='p'&&ids[2]==='tail','inline insertion uses captured location');
          assert(saved.blocks[ids[1]].ty==='grid','compatible grid block inserted');
          assert(hyperPlainText(hyperBlockText(saved,saved.blocks.p))==='Anchor 🌍'&&hyperBlockText(saved,saved.blocks.p)[0].attributes.bold,'original text and formatting preserved');
          assert(creates[0].parentViewId==='document','new database is child of document');
          const beforeReadonly=writes.length;render(false);await wait(()=>trigger().disabled&&host.querySelector('[data-inline-view="new-1"]').dataset.parentReadonly==='true');assert(host.querySelector('[data-inline-view="new-1"]').disabled,'parent readonly reaches nested database');assert(writes.length===beforeReadonly,'readonly transition does not write');
          render(true);await wait(()=>!trigger().disabled);trigger().click();await wait(()=>document.querySelector('[role="dialog"]'));
          document.querySelector('[aria-label="Database source"]').click();await wait(()=>document.querySelector('[role="option"]'));[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent==='Link existing database').click();
          await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].some(button=>button.textContent==='Source database'));[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Source database').click();
          await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Link existing database')?.disabled===false);
          [...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Link existing database').click();await wait(()=>!document.querySelector('[role="dialog"]'));await session.flush();
          assert(creates[1].parentViewId==='source'&&creates[1].meta.database_id==='shared-database','linked view uses source database metadata');
          session.change(doc=>hyperInsertDocumentDatabase(doc,hyperCaptureDocumentDatabaseAnchor(doc),{type:'grid',parentId:'workspace',viewId:'locked',compact:false}));await session.flush();
          await wait(()=>host.querySelector('[data-inline-view="locked"]')?.dataset.ownLocked==='true');assert(host.querySelector('[data-inline-view="locked"]').disabled,'nested database lock is respected separately');
          app.unmount();await session.dispose();
          const rowSession=new HyperDocumentSession('row-document',{open:async()=>doc,read:async()=>doc,apply:async()=>{},close:async()=>{},history:async()=>{},listen:()=>()=>{}});await rowSession.flush();
          const rowHost=document.createElement('div');document.body.append(rowHost);const rowApp=createRoot(rowHost);
          const rowRender=editable=>rowApp.render(<HyperDocumentEditor session={rowSession} title="Row body" editable={editable} rowScope={{viewId:'source',rowId}}/>);rowRender(true);
          const rowTrigger=()=>[...rowHost.querySelectorAll('button')].find(button=>button.textContent==='Database');await wait(()=>rowTrigger());
          const beforeRowCreate=creates.length;rowTrigger().click();await wait(()=>document.querySelector('[role="dialog"]'));
          await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Create database')?.disabled===false);
          [...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Create database').click();await wait(()=>!document.querySelector('[role="dialog"]'));await rowSession.flush();
          assert(creates.length===beforeRowCreate+1&&creates.at(-1).parentViewId==='source','row body creates backing database under actual owner');
          assert(!views.has('row-document'),'row insertion does not create a folder view for row document');
          assert(hyperPlainText(hyperBlockText(rowSession.store.getState().document,rowSession.store.getState().document.blocks.p))==='Anchor 🌍','row insertion preserves existing body');
          rowRender(false);await wait(()=>rowTrigger().disabled);assert(creates.length===beforeRowCreate+1,'readonly row does not create data');rowRender(true);await wait(()=>!rowTrigger().disabled);
          rowPresent=false;rowTrigger().click();await wait(()=>document.querySelector('[role="dialog"]'));
          await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Create database')?.disabled===false);
          [...document.querySelectorAll('[role="dialog"] button')].findLast(button=>button.textContent==='Create database').click();
          await wait(()=>document.querySelector('[role="dialog"]').textContent.includes('Row unavailable'));
          assert(creates.length===beforeRowCreate+1,'removed row is rejected before creating backing data');
          rowApp.unmount();await rowSession.dispose();return 'Hyper inline database editor checks passed';
        })();
      `);
      const result = await build({ input: entry, onwarn(warning, fallback) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') fallback(warning); }, plugins: [{ name: 'isolated-inline-context', resolveId(source) {
        if (source.endsWith('/document-appearance-store')) return appearance;
        if (source.endsWith('/DocumentBanner')) return banner;
        if (source.endsWith('/tabs-store')) return tabs;
        if (source.endsWith('/HyperDatabasePage')) return body;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = result.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No inline database editor bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper inline database editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
