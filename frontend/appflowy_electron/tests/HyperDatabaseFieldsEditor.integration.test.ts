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
(available ? describe : describe.skip)('Hyper database field editors in Electron', () => {
  it('edits checklists, removes unavailable relations, imports local/cloud media safely and retries without duplicating prepared files', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-fields-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), workspace = path.join(temporary, 'workspace.ts');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export const useTr=()=>({tr});export const resolveLocale=value=>value||"en-US";export const setLocale=()=>{};');
      fs.writeFileSync(workspace, "import {create} from 'zustand';export const useWorkspaceStore=create(()=>({currentWorkspace:null}));");
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
        import {create,fromBinary,toBinary} from '@bufbuild/protobuf';
        import {HyperDatabaseCell} from '@/features/database/HyperDatabaseCell';
        import {FieldPBSchema,FieldType} from '@shared/protobuf/flowy-database2/field_entities_pb';
        import {CellPBSchema} from '@shared/protobuf/flowy-database2/cell_entities_pb';
        import {ChecklistCellDataPBSchema} from '@shared/protobuf/flowy-database2/checklist_entities_pb';
        import {RelationCellDataPBSchema,RelationTypeOptionPBSchema} from '@shared/protobuf/flowy-database2/relation_entities_pb';
        import {MediaCellDataPBSchema,MediaFileTypePB} from '@shared/protobuf/flowy-database2/media_entities_pb';
        import {FileUploadTypePB} from '@shared/protobuf/flowy-database2/file_entities_pb';
        import {UploadFileParamsPBSchema,UploadedFilePBSchema} from '@shared/protobuf/flowy-document/entities_pb';
        import {WorkspaceTypePB} from '@shared/protobuf/flowy-user/workspace_pb';
        import {useWorkspaceStore} from '@/features/sidebar/stores/workspace-store';
        window.hyperFieldChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Timed out: '+check);await new Promise(r=>setTimeout(r,10));}};
          const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          let files=[],options=[{id:'task',name:'Draft'}],completed=[],rowIds=['deleted-row'];
          const imports=[],uploads=[],commits=[],changes=[],opens=[];
          let paths=['/selected/Local.pdf','/selected/Diagram.png'],failSecond=true,failCommit=false,pickerResolve=null,pendingPicker=false;
          window.appflowy={dialog:{pickFiles:async()=>pendingPicker?await new Promise(resolve=>{pickerResolve=resolve}):paths,saveFile:async()=>'/download/path'},assets:{importFile:async source=>{
            imports.push(source);if(source.endsWith('Diagram.png')&&failSecond){failSecond=false;throw Error('Temporary copy failure')}
            return {path:'/managed/files/'+source.split('/').at(-1),name:source.split('/').at(-1),size:12,previewUrl:'appflowy-file://local/files/a'};
          }},shell:{openPath:async path=>{opens.push(path);return ''},openExternal:async url=>{opens.push(url)}},core:{request:async(event,payload)=>{
            assert(event==='UploadFile','only native UploadFile expected');const params=fromBinary(UploadFileParamsPBSchema,payload);uploads.push(params);
            return {status:0,payload:toBinary(UploadedFilePBSchema,create(UploadedFilePBSchema,{url:'https://selfhost.example/assets/'+params.localFilePath.split('/').at(-1),localFilePath:params.localFilePath}))};
          }}};
          const repository={cell:async()=>{
            const schema=currentField.fieldType===FieldType.Checklist?ChecklistCellDataPBSchema:currentField.fieldType===FieldType.Relation?RelationCellDataPBSchema:MediaCellDataPBSchema;
            const data=currentField.fieldType===FieldType.Checklist?{options,selectedOptions:options.filter(option=>completed.includes(option.id))}:currentField.fieldType===FieldType.Relation?{rowIds}:{files};
            return create(CellPBSchema,{rowId:'row',fieldId:currentField.id,data:toBinary(schema,create(schema,data))});
          },checklist:async(view,row,field,change)=>{
            changes.push(change);if(change.completedTasks)for(const id of change.completedTasks)completed=completed.includes(id)?completed.filter(item=>item!==id):[...completed,id];
            if(change.insertTask)options=[...options,...change.insertTask.map((task,index)=>({id:'new-'+index,name:task.name}))];
          },relatedRows:async()=>{throw Error('Related database unavailable')},relation:async(view,row,field,id,selected)=>{rowIds=selected?[...rowIds,id]:rowIds.filter(item=>item!==id)},attachMediaFiles:async(view,row,field,prepared)=>{
            commits.push(prepared.map(file=>({...file})));if(failCommit){failCommit=false;throw Error('Temporary cell failure')}files=[...files,...prepared.filter(file=>!files.some(existing=>existing.id===file.id))];
          },renameMedia:async(view,row,field,id,name)=>{files=files.map(file=>file.id===id?{...file,name}:file)},removeMedia:async(view,row,field,id)=>{files=files.filter(file=>file.id!==id)}};
          const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
          let currentField=null,editable=true,epoch=0;
          function Harness(){const[revision,setRevision]=useState(0);return <HyperDatabaseCell repository={repository} viewId="view" rowId="row" field={currentField} revision={revision} editable={editable} onSaved={()=>setRevision(value=>value+1)}/>}
          const render=async(type,name,canEdit=true)=>{currentField=create(FieldPBSchema,{id:'field-'+type,name,fieldType:type,typeOptionData:type===FieldType.Relation?toBinary(RelationTypeOptionPBSchema,create(RelationTypeOptionPBSchema,{databaseId:'related'})):new Uint8Array()});editable=canEdit;app.render(<Harness key={++epoch}/>);await wait(()=>container.querySelector('button[aria-label="'+name+'"]'));container.querySelector('button[aria-label="'+name+'"]').click();await wait(()=>document.querySelector('[data-slot="popover-content"]'));};
          useWorkspaceStore.setState({currentWorkspace:{workspaceId:'local-workspace',workspaceType:WorkspaceTypePB.LocalW}});
          await render(FieldType.Checklist,'Steps');document.querySelector('[aria-label="Complete task: Draft"]').click();await wait(()=>completed.includes('task'));
          const taskInput=document.querySelector('[aria-label="New task"]');enter(taskInput,'Review');await wait(()=>taskInput.value==='Review');taskInput.closest('form').requestSubmit();await wait(()=>options.some(task=>task.name==='Review'));
          assert(changes.length===2,'native checklist operations');
          await render(FieldType.Relation,'Project');await wait(()=>document.querySelector('[role="alert"]'));const missing=document.querySelector('[aria-label="deleted-row"]');assert(missing,'missing relation remains removable when target cannot load');missing.click();await wait(()=>rowIds.length===0);
          await render(FieldType.Media,'Attachments');button('Attach files').click();await wait(()=>container.querySelector('[role="alert"]'));
          assert(imports.length===2&&commits.length===0,'failed second import retains first prepared file without partial cell mutation');
          container.querySelector('[role="alert"]').parentElement.querySelector('button').click();await wait(()=>files.length===2);
          assert(imports.filter(path=>path.endsWith('Local.pdf')).length===1,'retry does not recopy completed local file');
          assert(files.every(file=>file.uploadType===FileUploadTypePB.LocalFile&&file.url.startsWith('/managed/files/')),'local media stores copied paths');
          assert(files.find(file=>file.name==='Diagram.png').fileType===MediaFileTypePB.Image,'typed local image metadata');
          await wait(()=>document.querySelector('[aria-label="Open file: Local.pdf"]'));document.querySelector('[aria-label="Open file: Local.pdf"]').click();await wait(()=>opens.length===1);assert(opens[0]==='/managed/files/Local.pdf','open uses managed path');
          paths=['/selected/Retry.txt'];failCommit=true;button('Attach files').click();await wait(()=>container.querySelector('[role="alert"]'));const firstCommit=commits.at(-1)[0];container.querySelector('[role="alert"]').parentElement.querySelector('button').click();await wait(()=>files.length===3);
          assert(imports.filter(path=>path.endsWith('Retry.txt')).length===1&&commits.at(-1)[0].id===firstCommit.id,'cell retry reuses upload and attachment ID');
          useWorkspaceStore.setState({currentWorkspace:{workspaceId:'server-workspace',workspaceType:WorkspaceTypePB.ServerW}});files=[];paths=['/selected/Cloud.pdf'];await render(FieldType.Media,'Cloud attachments');button('Attach files').click();await wait(()=>files.length===1);
          assert(uploads.length===1&&uploads[0].workspaceId==='server-workspace'&&uploads[0].documentId==='row','self-hosted upload receives workspace and document');assert(files[0].uploadType===FileUploadTypePB.CloudFile&&files[0].url.startsWith('https://selfhost.example/'),'self-hosted media keeps remote URL');
          files=[];pendingPicker=true;await render(FieldType.Media,'Pending attachment');button('Attach files').click();await wait(()=>pickerResolve);const before=imports.length+uploads.length;useWorkspaceStore.setState({currentWorkspace:{workspaceId:'different-workspace',workspaceType:WorkspaceTypePB.LocalW}});pickerResolve(['/selected/Stale.pdf']);await wait(()=>document.querySelector('[role="alert"]'));assert(imports.length+uploads.length===before&&files.length===0,'workspace change while picker open prevents import and cell mutation');
          pickerResolve=null;await render(FieldType.Media,'Pending permission');button('Attach files').click();await wait(()=>pickerResolve);const beforePermission=imports.length+uploads.length;editable=false;app.render(<Harness key={epoch}/>);await wait(()=>!button('Attach files'));pickerResolve(['/selected/Locked.pdf']);await new Promise(resolve=>setTimeout(resolve,30));assert(imports.length+uploads.length===beforePermission&&files.length===0,'permission loss while picker is open prevents import and mutation');
          currentField={...currentField,name:'Changed property',fieldType:FieldType.Checklist};app.render(<Harness key={epoch}/>);await wait(()=>container.querySelector('[aria-label="Changed property"]'));container.querySelector('[aria-label="Changed property"]').click();await wait(()=>document.querySelector('[aria-label="Complete task: Draft"]'));const beforeChangedProperty=changes.length;document.querySelector('[aria-label="Complete task: Draft"]').click();await new Promise(resolve=>setTimeout(resolve,20));assert(changes.length===beforeChangedProperty,'same property ID can receive a different field type without reusing stale media data or enabling read-only writes');
          pendingPicker=false;await render(FieldType.Media,'Read-only attachments',false);assert(!button('Attach files')&&!document.querySelector('[aria-label="File address"]'),'read-only media has no write controls');
          app.unmount();return 'Hyper field editor checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); },
        plugins: [{ name: 'isolated-fields-context', resolveId(source) {
          if (source.endsWith('/workspace-store')) return workspace;
          if (source.endsWith('/i18n')) return i18n;
          if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source);
          return null;
        } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } },
        transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk');
      if (code?.type !== 'chunk') throw new Error('No field editor integration bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperFieldChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{const result=await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log(result);app.exit(0);}catch(error){console.error(error.stack);app.exit(1);}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper field editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 35_000);
});
