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
(available ? describe : describe.skip)('Hyper retained complex-cell forms in native Electron', () => {
  it('retains unsent task names and media forms across unmounts, and retries prepared attachments from recovery', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-database-draft-forms-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), workspace = path.join(temporary, 'workspace.ts'), backend = path.join(temporary, 'backend.ts');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export function useTr(){return {tr}}');
      fs.writeFileSync(workspace, "import {create} from 'zustand';export const useWorkspaceStore=create(()=>({currentWorkspace:{workspaceId:'workspace',workspaceType:0},userProfile:null,actionResult:null}));");
      fs.writeFileSync(backend, `export {hyperExecuteDatabaseDraft} from ${JSON.stringify(path.join(root, 'src/renderer/features/database/HyperDatabaseDraftBackend.ts'))};export const hyperReadDatabaseDraft=async(repository,viewId,target)=>({field:window.hyperDraftField,cell:await repository.cell(viewId,target.rowId,target.fieldId)});`);
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {create,toBinary} from '@bufbuild/protobuf';
        import {HyperDatabaseCell} from '@/features/database/HyperDatabaseCell';
        import {HyperDatabaseDraftRecovery,useHyperDatabaseDraftRecords} from '@/features/database/HyperDatabaseDraftRecovery';
        import {FieldPBSchema,FieldType} from '@shared/protobuf/flowy-database2/field_entities_pb';
        import {CellPBSchema} from '@shared/protobuf/flowy-database2/cell_entities_pb';
        import {ChecklistCellDataPBSchema} from '@shared/protobuf/flowy-database2/checklist_entities_pb';
        import {MediaCellDataPBSchema,MediaFilePBSchema} from '@shared/protobuf/flowy-database2/media_entities_pb';
        import {WorkspaceTypePB} from '@shared/protobuf/flowy-user/workspace_pb';
        import {useWorkspaceStore} from '@/features/sidebar/stores/workspace-store';
        window.hyperDraftFormChecks=(async()=>{
          const assert=(ok,message)=>{if(!ok)throw Error(message)};
          const wait=async(check,label='')=>{const deadline=Date.now()+7000;while(!check()){if(Date.now()>deadline)throw Error('Timed out '+label+': '+check+'; body='+document.body.textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const button=(container,label)=>[...container.querySelectorAll('button')].find(node=>node.textContent===label);
          const copied=[],imports=[],commits=[];let failCopy=true,shown=true,options=[{id:'task',name:'Saved task'}],files=[create(MediaFilePBSchema,{id:'file',name:'Saved file.pdf',url:'/managed/saved.pdf'})],writes=0;
          window.appflowy={clipboard:{writeText:text=>copied.push(text)},dialog:{pickFiles:async()=>['/first.pdf','/second.png']},assets:{importFile:async source=>{imports.push(source);if(source==='/second.png'&&failCopy){failCopy=false;throw Error('Temporary preparation failure')}return {path:'/managed'+source,name:source.slice(1),size:10}}},core:{onNotification:()=>()=>{},onPortMessage:()=>()=>{}}};
          useWorkspaceStore.setState({currentWorkspace:{workspaceId:'workspace',workspaceType:WorkspaceTypePB.LocalW}});
          const owner={contextKey:'form-native',workspaceId:'workspace',actorId:'actor',isCurrent:()=>true};
          let field=create(FieldPBSchema,{id:'tasks',name:'Tasks',fieldType:FieldType.Checklist}),revision=0;window.hyperDraftField=field;
          const repository={cell:async()=>create(CellPBSchema,{data:field.fieldType===FieldType.Checklist?toBinary(ChecklistCellDataPBSchema,create(ChecklistCellDataPBSchema,{options})):toBinary(MediaCellDataPBSchema,create(MediaCellDataPBSchema,{files}))}),checklist:async(view,row,field,changes)=>{writes++;if(changes.insertTask)options=[...options,...changes.insertTask.map(task=>({id:'new-task',name:task.name}))];if(changes.updateTasks)options=options.map(option=>changes.updateTasks.find(task=>task.id===option.id)??option)},attachMediaLink:async(view,row,field,url,name)=>{writes++;files=[...files,create(MediaFilePBSchema,{id:'link',name,url})]},attachMediaFiles:async(view,row,field,prepared)=>{writes++;commits.push(structuredClone(prepared));files=[...files,...prepared]}};
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
          const render=()=>app.render(<Harness/>);
          function Harness(){const records=useHyperDatabaseDraftRecords(owner,'database');return <><HyperDatabaseDraftRecovery owner={owner} databaseId="database" repository={repository} viewId="view" editable saved={()=>{revision++;render()}} records={records}/>{shown&&<HyperDatabaseCell repository={repository} viewId="view" rowId="row" field={field} editable revision={revision} onSaved={()=>{revision++;render()}} draftScope={{owner,databaseId:'database'}}/>}</>}
          const record=()=>host.querySelector('[data-hyper-draft]');
          const open=async()=>{await wait(()=>host.querySelector('button[aria-label="'+field.name+'"]'));host.querySelector('button[aria-label="'+field.name+'"]').click();await wait(()=>document.querySelector('[data-slot="popover-content"]'));};
          const hide=async()=>{shown=false;render();await wait(()=>!document.querySelector('[data-slot="popover-content"]'));};
          const show=async()=>{shown=true;render();await open()};
          render();await open();let input=document.querySelector('[aria-label="Task name"]');input.focus();enter(input,'Unsent task rename');await hide();assert(writes===0&&record().textContent.includes('Unsent task rename'),'unmount retains an unsent checklist rename without blur saving');button(record(),'Copy draft').click();await wait(()=>copied.length===1);assert(copied[0].includes('Unsent task rename'),'copy includes unsubmitted form input');
          await show();input=document.querySelector('[aria-label="Task name"]');assert(input.value==='Unsent task rename','reopened task editor restores shared form value');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!record(),'escape clears only unsent rename');
          input=document.querySelector('[aria-label="New task"]');enter(input,'Unsent new task');await hide();assert(record().textContent.includes('Unsent new task'),'new task text survives an unsubmitted form unmount');await show();input=document.querySelector('[aria-label="New task"]');assert(input.value==='Unsent new task','new task form restores');input.closest('form').requestSubmit();await wait(()=>!record()&&options.some(option=>option.name==='Unsent new task'),'restored new task saves once');assert(writes===1,'new task invokes exactly one mutation');
          await hide();field=create(FieldPBSchema,{id:'media',name:'Attachments',fieldType:FieldType.Media});window.hyperDraftField=field;await show();input=document.querySelector('[aria-label="File name"]');input.focus();enter(input,'Unsent filename.pdf');await hide();assert(record().textContent.includes('Unsent filename.pdf'),'media filename survives without blur');await show();input=document.querySelector('[aria-label="File name"]');assert(input.value==='Unsent filename.pdf','media filename restores');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!record());
          const url=document.querySelector('[aria-label="File address"]');enter(url,'https://example.com/retained');const name=url.closest('form').querySelector('[aria-label="File name"]');enter(name,'Retained link');await hide();assert(record().textContent.includes('https://example.com/retained')&&record().textContent.includes('Retained link'),'unsent media link form survives');await show();assert(document.querySelector('[aria-label="File address"]').value==='https://example.com/retained','link URL restores');document.querySelector('[aria-label="File address"]').closest('form').requestSubmit();await wait(()=>!record()&&files.some(file=>file.id==='link'),'restored link saves');
          button(document,'Attach files').click();await wait(()=>record()?.querySelector('[role="alert"]'),'failed file preparation');assert(imports.length===2&&commits.length===0,'first prepared copy is retained before the next file fails');await hide();button(record(),'Retry save').click();await wait(()=>!record()&&commits.length===1,'detached upload retry');assert(imports.filter(source=>source==='/first.pdf').length===1&&imports.filter(source=>source==='/second.png').length===2,'recovery retries only the failed copy');assert(commits[0].length===2,'one cell write attaches both prepared files');
          app.unmount();return 'Hyper retained form checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'native-draft-form-context', resolveId(source) {
        if (source.endsWith('/workspace-store')) return workspace;
        if (source.endsWith('/HyperDatabaseDraftBackend')) return backend;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf', 'zustand'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw Error('No database draft forms bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperDraftFormChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});win.webContents.focus();try{const result=await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'));console.log(result);app.exit(0);}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper retained form checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 70_000);
});
