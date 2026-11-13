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

(available ? describe : describe.skip)('Hyper document column controls in Electron', () => {
  it('creates columns with Insert and slash commands, edits text, resizes safely and enforces stale/read-only/owner guards', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-columns-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), scope = path.join(temporary, 'scope.ts'), appearance = path.join(temporary, 'appearance.ts'), banner = path.join(temporary, 'banner.ts'), access = path.join(temporary, 'access.ts'), tabs = path.join(temporary, 'tabs.ts');
      fs.writeFileSync(i18n, `import en from${JSON.stringify(path.resolve(root, '../resources/translations/en-US.json'))};export function tr(key,options={}){let value=key.split('.').reduce((value,key)=>value?.[key],en)??key;for(const[key,arg]of Object.entries(options.namedArgs??{}))value=value.replaceAll('{'+key+'}',String(arg));return value}export const useTr=()=>({tr});export const resolveLocale=value=>value||'en-US';export const setLocale=async()=>{};`);
      fs.writeFileSync(scope, 'export const usePageAccessLevel=()=>null;export const useViewPluginNotifier=()=>null;export const useViewScope=()=>null;export const ViewScopeProvider=({children})=>children;');
      fs.writeFileSync(appearance, 'export const useDocumentFontSize=()=>({fontSize:16});');
      fs.writeFileSync(banner, 'export const DocumentBanner=()=>null;export const deletePermanently=async()=>true;export const restorePage=async()=>true;');
      fs.writeFileSync(access, 'export const ShareAccessLevel={fullAccess:"fullAccess",readAndWrite:"readAndWrite"};export const isEditable=state=>!state.isLocked;export const viewIsLocked=view=>view.oneOfIsLocked.case==="isLocked"&&view.oneOfIsLocked.value;');
      fs.writeFileSync(tabs, 'export const tabsActions={openView:async()=>{},updateView:()=>{}};');
      const entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(entry, `
        import React from'react';import{createRoot}from'react-dom/client';import{create}from'@bufbuild/protobuf';
        import{DocumentDataPBSchema}from'@shared/protobuf/flowy-document/entities_pb';
        import{HyperDocumentEditor}from'@/features/document/HyperDocumentPage';
        import{HyperDocumentSession}from'@/features/document/HyperDocumentSession';
        import{hyperBlockText,hyperPlainText,hyperChildren,hyperInsertBlock,hyperUpdateBlock}from'@/features/document/HyperDocumentModel';
        import{hyperCaptureDocumentColumns,hyperReadDocumentColumns,hyperResizeDocumentColumns}from'@/features/document-columns/HyperDocumentColumnsModel';
        import{hyperExportDocument}from'@/features/document/HyperDocumentExport';
        import{hyperSetSelection}from'@/features/document/HyperDocumentDom';
        window.hyperColumnEditorChecks=(async()=>{
          const assert=(condition,message)=>{if(!condition)throw Error(message)};
          const wait=async(check,label)=>{const until=Date.now()+6000;while(!check()){if(Date.now()>until)throw Error('Timed out '+label+' '+document.body.textContent.slice(-600));await new Promise(resolve=>setTimeout(resolve,10));}};
          const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
          window.appflowy={core:{onNotification:()=>()=>{},request:async event=>{throw Error('Unexpected event '+event)}},clipboard:{writeText:()=>{}}};
          const doc=create(DocumentDataPBSchema,{pageId:'root',blocks:{root:{id:'root',ty:'page',data:'{}',childrenId:'children'},p:{id:'p',ty:'paragraph',parentId:'root',childrenId:'pc',data:JSON.stringify({delta:[{insert:'Existing content',attributes:{bold:true}}],custom:{keep:true}})},tail:{id:'tail',ty:'paragraph',parentId:'root',childrenId:'tc',data:'{}'}},meta:{childrenMap:{children:{children:['p','tail']},pc:{children:[]},tc:{children:[]}}}});
          const writes=[];let owned=true,pendingWrite=null;
          const session=new HyperDocumentSession('columns-document',{open:async()=>doc,read:async()=>doc,apply:async(id,actions)=>{writes.push(actions);if(pendingWrite)await pendingWrite},close:async()=>{},history:async()=>{},listen:()=>()=>{}},{workspaceId:'workspace',actorId:'actor',contextKey:'fixture',isCurrent:()=>owned});await session.flush();
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
          const mount=async editable=>{app.render(<HyperDocumentEditor session={session} title="Columns page" editable={editable}/>);await frame()};
          const current=()=>session.store.getState().document;
          const text=id=>host.querySelector('[data-hyper-text="'+id+'"]');
          const columns=()=>Object.values(current().blocks).filter(block=>block.ty==='simple_columns');
          const button=label=>[...host.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')===label||button.textContent===label);
          const menuItem=label=>[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent===label);
          const widthInput=id=>host.querySelector('[data-hyper-column-widths="'+id+'"] input');
          const typeInput=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const typeText=async(id,value)=>{const element=text(id);element.focus();element.textContent=value;hyperSetSelection(element,{start:value.length,end:value.length});element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));await session.flush()};
          await mount(true);await wait(()=>text('p'),'document ready');text('p').focus();hyperSetSelection(text('p'),{start:0,end:0});text('p').dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));
          button('Insert block').click();await wait(()=>menuItem('Two columns'),'two-column insert option');menuItem('Two columns').click();await wait(()=>columns().length===1,'columns inserted');await session.flush();
          const first=columns()[0],layout=hyperReadDocumentColumns(current(),first.id),leftText=hyperChildren(current(),current().blocks[layout.columns[0].id])[0],rightText=hyperChildren(current(),current().blocks[layout.columns[1].id])[0];
          await wait(()=>document.activeElement===text(leftText),'first column receives text focus');
          await typeText(leftText,'Left <column> 🌍');await typeText(rightText,'Right column');
          const width=widthInput(first.id);width.focus();await wait(()=>document.activeElement===width,'width control focused');typeInput(width,'60');await frame();assert(width.value==='60','width draft accepts typing');assert(width.isConnected&&document.activeElement===width,'width input keeps its node and focus while typing');width.blur();await session.flush();await wait(()=>hyperReadDocumentColumns(current(),first.id).columns[0].ratio===0.6,'width persisted');
          assert(hyperReadDocumentColumns(current(),first.id).columns[1].ratio===0.4,'neighbor width adjusted');
          const grid=host.querySelector('[data-hyper-columns="'+first.id+'"] > .grid');assert(grid.style.gridTemplateColumns.includes('0.6fr')&&grid.style.gridTemplateColumns.includes('0.4fr'),'renderer uses persisted ratios');
          const boxes=[...grid.children].map(column=>column.getBoundingClientRect());assert(Math.abs(boxes[0].width/boxes[1].width-1.5)<0.02,'rendered column widths follow60/40');
          const count=writes.length;const narrow=widthInput(first.id);narrow.focus();typeInput(narrow,'5');await frame();narrow.blur();await wait(()=>host.textContent.includes('at least 10%'),'minimum width error');assert(writes.length===count,'invalid resize sends no action');
          const stale=widthInput(first.id);stale.focus();typeInput(stale,'65');await frame();session.change(doc=>hyperResizeDocumentColumns(doc,hyperCaptureDocumentColumns(doc,first.id),0,0.55));await session.flush();const afterRemote=writes.length;stale.blur();
          await wait(()=>host.textContent.includes('layout changed'),'stale width edit rejected');assert(writes.length===afterRemote&&hyperReadDocumentColumns(current(),first.id).columns[0].ratio===0.55,'stale control cannot overwrite updated ratios');
          for(const[count,label]of[[3,'Three columns'],[4,'Four columns']]){
            await typeText('tail','/'+count+' columns');await wait(()=>document.querySelector('input[aria-label="Search commands"]'),'column slash search');
            const search=document.querySelector('input[aria-label="Search commands"]');await wait(()=>menuItem(label),'matching slash column option');search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
            await wait(()=>!document.querySelector('input[aria-label="Search commands"]')&&columns().some(block=>hyperReadDocumentColumns(current(),block.id).columns.length===count),'slash creates'+count+'columns');await session.flush();
            const created=columns().find(block=>hyperReadDocumentColumns(current(),block.id).columns.length===count),firstParagraph=hyperChildren(current(),current().blocks[hyperReadDocumentColumns(current(),created.id).columns[0].id])[0];
            await wait(()=>document.activeElement===text(firstParagraph),'slash moves focus into column');assert(hyperPlainText(hyperBlockText(current(),current().blocks.tail))==='','slash clears only its query');
          }
          const triple=columns().find(block=>hyperReadDocumentColumns(current(),block.id).columns.length===3);let releaseWrite;pendingWrite=new Promise(resolve=>{releaseWrite=resolve});
          const pairInputs=[...host.querySelectorAll('[data-hyper-column-widths="'+triple.id+'"] input')];pairInputs[0].focus();typeInput(pairInputs[0],'40');await frame();pairInputs[0].blur();await wait(()=>session.store.getState().status==='saving','width save pending');
          pairInputs[1].focus();await frame();assert(!pairInputs[1].disabled&&document.activeElement===pairInputs[1],'adjacent width stays keyboard focusable while saving');pendingWrite=null;releaseWrite();await session.flush();
          assert(hyperPlainText(hyperBlockText(current(),current().blocks.p))==='Existing content','creation preserves unrelated paragraph');
          const html=hyperExportDocument(current(),'html');assert(html.includes('display:flex')&&html.includes('Left &lt;column&gt; 🌍')&&html.includes('Right column'),'HTML export preserves content and columns');
          text('p').focus();hyperSetSelection(text('p'),{start:0,end:0});text('p').dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));button('Insert block').click();await wait(()=>menuItem('Two columns'),'capture insertion menu');
          session.change(doc=>hyperInsertBlock(doc,'root','p'));await session.flush();const beforeStale=writes.length;menuItem('Two columns').click();await wait(()=>!document.querySelector('[role="menu"]'),'stale insert dismissed');assert(columns().length===3&&writes.length===beforeStale,'stale insertion anchor cannot create misplaced columns');
          const pending=widthInput(first.id);pending.focus();typeInput(pending,'60');await frame();const readOnlyCount=writes.length;await mount(false);pending.blur();await frame();assert(writes.length===readOnlyCount&&!host.querySelector('[data-hyper-column-widths]'),'read-only transition blocks pending resize');assert(button('Insert block').disabled&&text(leftText).contentEditable==='false','read-only blocks creation and text editing');
          session.change(doc=>hyperUpdateBlock(doc,first.id,{version:2}));await session.flush();await wait(()=>host.textContent.includes('stored content is preserved'),'unsupported version warning');assert(text(leftText).textContent==='Left <column> 🌍','unsupported layout preserves visible content');
          session.change(doc=>hyperUpdateBlock(doc,first.id,{version:1}));await session.flush();await mount(true);await wait(()=>widthInput(first.id),'widths restored for supported layout');
          const ownerInput=widthInput(first.id);ownerInput.focus();typeInput(ownerInput,'60');await frame();const ownerCount=writes.length;owned=false;ownerInput.blur();await wait(()=>session.store.getState().status==='error','owner change detected');assert(writes.length===ownerCount,'owner change prevents ratio writes');
          app.unmount();await session.dispose();return 'Hyper document column editor checks passed';
        })();
      `);
      const result = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'hyper-column-editor-fixture', resolveId(source) {
        if (source.endsWith('/view-scope')) return scope;
        if (source.endsWith('/document-appearance-store')) return appearance;
        if (source.endsWith('/DocumentBanner')) return banner;
        if (source.endsWith('/page-access-level-store')) return access;
        if (source.endsWith('/tabs-store')) return tabs;
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = result.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw new Error('No column editor fixture bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), code.code + '\nwindow.hyperColumnEditorChecks');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><style>body{width:1000px}.grid{display:grid}.gap-4{gap:16px}</style><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});win.webContents.focus();try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error.stack);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper document column editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 120_000);
});
