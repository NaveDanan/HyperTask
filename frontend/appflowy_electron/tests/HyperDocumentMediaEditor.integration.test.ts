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
(available ? describe : describe.skip)('Hyper document media editor in Electron', () => {
  it('inserts local, linked and cloud media through the mounted toolbar and retains copies on save failures', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-document-media-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), scope = path.join(temporary, 'scope.ts'), appearance = path.join(temporary, 'appearance.ts'), banner = path.join(temporary, 'banner.ts'), access = path.join(temporary, 'access.ts');
      fs.writeFileSync(i18n, `import en from ${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))}; export function tr(key, options={}) { let text = key.split('.').reduce((value, part)=>value?.[part],en) ?? key; for(const [name,value] of Object.entries(options.namedArgs??{})) text=text.replaceAll('{'+name+'}',String(value)); return text; } export function useTr(){ return {tr}; }`);
      fs.appendFileSync(i18n, '\nexport const resolveLocale=value=>value;export const setLocale=()=>{};');
      fs.writeFileSync(scope, 'export const usePageAccessLevel=()=>null; export const useViewPluginNotifier=()=>null; export const useViewScope=()=>null;export const ViewScopeProvider=({children})=>children;');
      fs.writeFileSync(appearance, 'export const useDocumentFontSize=()=>({fontSize:16});');
      fs.writeFileSync(banner, 'export const DocumentBanner=()=>null; export const deletePermanently=async()=>true; export const restorePage=async()=>true;');
      fs.writeFileSync(access, 'export const ShareAccessLevel={readOnly:"readOnly",readAndWrite:"readAndWrite",fullAccess:"fullAccess"};export const isEditable=state=>!state.isLocked; export const viewIsLocked=view=>view.oneOfIsLocked.case==="isLocked"&&view.oneOfIsLocked.value;');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create,toBinary,fromBinary} from '@bufbuild/protobuf';
        import {DocumentDataPBSchema,UploadedFilePBSchema,UploadFileParamsPBSchema} from '@shared/protobuf/flowy-document/entities_pb';
        import {ViewIdPBSchema,ViewPBSchema} from '@shared/protobuf/flowy-folder/view_pb';
        import {WorkspacePBSchema} from '@shared/protobuf/flowy-folder/workspace_pb';
        import {UserProfilePBSchema,RepeatedUserWorkspacePBSchema} from '@shared/protobuf/flowy-user/user_profile_pb';
        import {HyperDocumentEditor} from '@/features/document/HyperDocumentPage';import {HyperDocumentSession} from '@/features/document/HyperDocumentSession';
        import {hyperReadDocumentMedia} from '@/features/document-media/HyperDocumentMediaModel';
        import {hyperBlockText,hyperPlainText} from '@/features/document/HyperDocumentModel';
        import {hyperSetSelection} from '@/features/document/HyperDocumentDom';
        window.hyperMediaResult=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check)=>{const until=Date.now()+6000;while(!check()){if(Date.now()>until)throw Error('Timed out '+check);await new Promise(resolve=>setTimeout(resolve,10));}};
          const button=(label,host=document)=>[...host.querySelectorAll('button')].find(element=>element.textContent===label);
          const input=(label,value)=>{const element=document.querySelector('input[aria-label="'+label+'"]');assert(element,'input '+label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};
          const option=async(label,value)=>{const trigger=document.querySelector('[aria-label="'+label+'"]');assert(trigger,'select trigger '+label);trigger.click();await wait(()=>[...document.querySelectorAll('[role="option"]')].some(item=>item.textContent===value));[...document.querySelectorAll('[role="option"]')].find(item=>item.textContent===value).click();};
          let local=true,copied='',imports=0,uploads=0,opens=0,pickerResolve=null,delayPick=false,failWrites=false;const uploaded=[];
          const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>');
          window.appflowy={core:{onNotification:()=>()=>{},request:async(event,payload)=>{
            const reply=(schema,values)=>({status:0,payload:toBinary(schema,create(schema,values))});
            if(event==='ReadCurrentWorkspace')return reply(WorkspacePBSchema,{id:'workspace'});
            if(event==='GetUserProfile')return reply(UserProfilePBSchema,{id:1n,workspaceType:local?0:1});
            if(event==='GetAllWorkspace')return reply(RepeatedUserWorkspacePBSchema,{items:[{workspaceId:'workspace',workspaceType:local?0:1}]});
            if(event==='GetView')return reply(ViewPBSchema,{id:fromBinary(ViewIdPBSchema,payload).value,name:'Document',layout:0,parentViewId:'workspace'});
            if(event==='UploadFile'){uploads++;uploaded.push(fromBinary(UploadFileParamsPBSchema,payload));return reply(UploadedFilePBSchema,{url:'https://self-hosted.example/uploaded.png',localFilePath:'/original/photo.png'});}
            throw Error('Unexpected media event '+event);
          }},dialog:{pickFiles:async()=>delayPick?await new Promise(resolve=>pickerResolve=resolve):['/original/photo.png'],saveFile:async()=>null},assets:{importFile:async(path,kind)=>{imports++;return {path:'/managed/'+kind+'-'+imports+'.png',name:'photo.png',size:4,previewUrl:picture}},previewUrl:async()=>picture},clipboard:{writeText:value=>copied=value},shell:{openPath:async()=>{opens++;return ''},openExternal:async()=>{opens++}}};
          const createSession=id=>new HyperDocumentSession(id,{open:async()=>create(DocumentDataPBSchema,{pageId:'root-'+id,blocks:{['root-'+id]:{id:'root-'+id,ty:'page',data:'{}',childrenId:'children-'+id},p:{id:'p',ty:'paragraph',parentId:'root-'+id,childrenId:'pchildren-'+id,data:JSON.stringify({delta:[{insert:'Before 🌍',attributes:{bold:true}}]})}},meta:{childrenMap:{['children-'+id]:{children:['p']}}}}),read:async()=>{throw Error('unexpected read')},apply:async()=>{if(failWrites)throw Error('Simulated media write failure')},close:async()=>{},history:async()=>{},listen:()=>()=>{}});
          const session=createSession('document');await session.flush();
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
          const render=(session,editable=true)=>app.render(<HyperDocumentEditor session={session} title="Media page" editable={editable}/>);render(session);
          await wait(()=>container.querySelector('[data-hyper-text="p"]'));const paragraph=container.querySelector('[data-hyper-text="p"]');paragraph.focus();hyperSetSelection(paragraph,{start:2,end:2});paragraph.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          const openMedia=async()=>{button('Media',container).click();await wait(()=>button('Choose file')&&!button('Choose file').disabled);};
          await openMedia();button('Choose file').click();await wait(()=>document.querySelector('input[aria-label="File name"]').value==='photo.png');input('Image caption','Caption 🌍');input('Alternative text','Alt 🌍');
          button('Insert media').click();await wait(()=>!document.querySelector('[role="dialog"]'));await session.flush();
          let doc=session.store.getState().document;const image=Object.values(doc.blocks).find(block=>block.ty==='image');assert(image,'local image persisted');
          assert(hyperReadDocumentMedia(doc,image).source==='local','local source enum');assert(JSON.parse(image.data).image_type===0,'upstream local image enum');
          assert(hyperPlainText(hyperBlockText(doc,doc.blocks.p))==='Before 🌍','media insertion preserves existing text');
          await wait(()=>container.querySelector('img')?.alt==='Alt 🌍');const imageElement=container.querySelector('img');imageElement.loading='eager';await imageElement.decode();assert(imageElement.naturalWidth===40,'local preview rendered');assert(container.textContent.includes('Caption 🌍'),'caption rendered');
          render(session,false);await wait(()=>button('Media',container).disabled);assert(!container.querySelector('[aria-label="Remove reference: photo.png"]'),'read-only hides destructive action');
          render(session,true);await wait(()=>!button('Media',container).disabled);await openMedia();await option('Media type','Attachment');await option('Media source','Link from URL');input('Media URL','https://example.org/report.pdf');input('File name','Report');button('Insert media').click();await wait(()=>!document.querySelector('[role="dialog"]'));await session.flush();
          doc=session.store.getState().document;const attachment=Object.values(doc.blocks).find(block=>block.ty==='file');assert(attachment&&JSON.parse(attachment.data).url_type===1,'upstream network attachment enum');assert(imports===1&&uploads===0,'network insertion performs no copy or upload');
          local=false;await openMedia();button('Choose file').click();await wait(()=>document.querySelector('input[aria-label="File name"]').value==='photo.png');button('Insert media').click();await wait(()=>!document.querySelector('[role="dialog"]'));await session.flush();
          doc=session.store.getState().document;assert(Object.values(doc.blocks).some(block=>block.ty==='image'&&JSON.parse(block.data).image_type===1),'upstream cloud image enum');assert(uploads===1&&imports===1,'cloud uses uploader only');assert(uploaded[0].workspaceId==='workspace'&&uploaded[0].documentId==='document','cloud uploader captures exact workspace and document');
          local=true;await openMedia();delayPick=true;button('Choose file').click();await wait(()=>pickerResolve);const beforeStale=imports;render(session,false);await new Promise(resolve=>setTimeout(resolve,20));pickerResolve(['/original/stale.png']);await wait(()=>document.querySelector('[role="alert"]'));assert(imports===beforeStale,'permissions changing during file dialog prevent imports');
          await wait(()=>document.querySelector('[role="dialog"] [data-slot="dialog-close"]'));document.querySelector('[role="dialog"] [data-slot="dialog-close"]').click();await wait(()=>!document.querySelector('[role="dialog"]'));
          delayPick=false;render(session,true);await wait(()=>!button('Media',container).disabled);await openMedia();button('Choose file').click();await wait(()=>document.querySelector('input[aria-label="File name"]').value==='photo.png');failWrites=true;button('Insert media').click();
          await wait(()=>button('Copy saved location'));assert(button('Insert media').disabled,'failed save cannot start another import');const afterFailure=imports;
          button('Copy saved location').click();await wait(()=>copied.includes('/managed/image-'));assert(imports===afterFailure,'recovery reuses original managed copy');button('Open file').click();await wait(()=>opens===1);assert(document.querySelector('[role="dialog"]'),'failed document flush retains recovery dialog');
          app.unmount();await session.dispose();return 'Hyper native document media checks passed';
        })();
      `);
      const bundle = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'media-context', resolveId(source) {
        if (source.endsWith('/view-scope')) return scope;
        if (source.endsWith('/document-appearance-store')) return appearance;
        if (source.endsWith('/DocumentBanner')) return banner;
        if (source.endsWith('/page-access-level-store')) return access;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundle.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No media editor bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperMediaResult`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\';script-src \'self\' \'unsafe-eval\';style-src \'self\' \'unsafe-inline\';img-src data: appflowy-file:"><body></body>');
      const main = path.join(temporary, 'main.cjs'); fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{const result=await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log(result);app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper native document media checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
