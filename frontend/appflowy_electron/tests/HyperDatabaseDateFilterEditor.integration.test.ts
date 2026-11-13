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
const available = fs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY));
(available ? describe : describe.skip)('Hyper date filters and calendar spans in Electron', () => {
  it('preserves legacy inspection, exposes explicit timezone conversion, and bounds large overlapping calendar ranges', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-date-filter-editor-'));
    try {
      const i18n = path.join(temporary, 'i18n.ts'), entry = path.join(temporary, 'entry.tsx');
      fs.writeFileSync(i18n, 'export const tr=key=>key;export function useTr(){return {tr}}');
      fs.writeFileSync(entry, `
        import React from 'react';import {createRoot} from 'react-dom/client';import {create} from '@bufbuild/protobuf';
        import {HyperDatabaseDateFilterEditor} from '@/features/database/HyperDatabaseDateFilterEditor';
        import {HyperDatabaseCalendarDay} from '@/features/database/HyperDatabaseCalendarDay';
        import {HyperDatabaseCalendarSpanIndex} from '@/features/database/HyperDatabaseCalendarSpans';
        import {hyperDateTimestamp,hyperCalendarDays} from '@/features/database/HyperDatabaseCells';
        import {CalendarEventPBSchema} from '@shared/protobuf/flowy-database2/calendar_entities_pb';
        window.hyperDateFilterChecks=(async()=>{
          const assert=(ok,label)=>{if(!ok)throw Error(label)},wait=async(check)=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed out '+check+'; '+document.body.textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
          const enter=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
          const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent===label);
          const host=document.createElement('div');document.body.append(host);const app=createRoot(host),saved=[];
          let disabled=false,epoch=0;const source={condition:0,timestamp:hyperDateTimestamp('2026-11-11')+12345n,useFieldTimezone:false};
          const render=async(value=source)=>{app.render(<HyperDatabaseDateFilterEditor key={++epoch} value={value} timezoneId="America/New_York" disabled={disabled} onSave={async next=>{saved.push(next);return true}} onCancel={()=>{}}/>);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
          await render();await wait(()=>button('Save filter'));assert(button('Save filter').disabled&&saved.length===0,'unchanged legacy save is disabled');assert(document.querySelector('[aria-label="Date"]').value==='2026-11-11','criterion remains its UTC logical date');assert(host.textContent.includes('legacy system-timezone'),'inspection explains the retained policy');
          document.querySelector('[aria-label="Use property timezone"]').click();await wait(()=>!button('Save filter').disabled);assert(host.textContent.includes('America/New_York'),'explicit policy shows property zone');button('Save filter').click();await wait(()=>saved.length===1);assert(saved[0].useFieldTimezone&&saved[0].timestamp===hyperDateTimestamp('2026-11-11'),'explicit opt-in keeps the selected logical day');
          await render();await wait(()=>button('Save filter').disabled);enter(document.querySelector('[aria-label="Date"]'),'2026-11-12');await wait(()=>!button('Save filter').disabled);assert(document.querySelector('[aria-label="Use property timezone"]').getAttribute('aria-checked')==='true','criterion edit visibly opts in');button('Save filter').click();await wait(()=>saved.length===2);assert(saved[1].timestamp===hyperDateTimestamp('2026-11-12')&&saved[1].useFieldTimezone,'edited criterion is never shifted into the zone');
          await render();await wait(()=>button('Save filter').disabled);document.querySelector('[aria-label="Date condition"]').click();await wait(()=>document.querySelectorAll('[role="option"]').length===16);[...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='End is between').click();await wait(()=>document.querySelector('[aria-label="From date"]'));enter(document.querySelector('[aria-label="From date"]'),'2026-11-12');enter(document.querySelector('[aria-label="Through date"]'),'2026-11-11');await wait(()=>host.textContent.includes('end must be on or after')&&button('Save filter').disabled);assert(saved.length===2,'reversed range never writes');
          disabled=true;await render();await wait(()=>document.querySelector('[aria-label="Date"]').disabled);assert(document.querySelector('[aria-label="Date condition"]').getAttribute('aria-disabled')==='true'||document.querySelector('[aria-label="Date condition"]').disabled,'read-only operator cannot change');
          const days=hyperCalendarDays(2026,10),events=Array.from({length:5000},(_,index)=>create(CalendarEventPBSchema,{rowMeta:{id:'row-'+index},title:'Event '+index,oneOfTimestamp:{case:'timestamp',value:hyperDateTimestamp('1900-01-01')}}));
          let index=new HyperDatabaseCalendarSpanIndex(events,event=>({start:event.oneOfTimestamp.value,end:hyperDateTimestamp('9999-12-31')}),days,'UTC');const opened=[];
          const calendar=()=>app.render(<div role="grid">{days.map(day=><HyperDatabaseCalendarDay key={day} day={day} currentMonth={11} index={index} onOpen={row=>opened.push(row.id)}/>)}</div>);calendar();await wait(()=>host.querySelectorAll('[role="gridcell"]').length===42);
          assert(host.querySelectorAll('[role="gridcell"] button').length===42*12,'calendar renders ten cards and two navigation buttons per visible day');const day=host.querySelector('[aria-label="2026-11-11"]');assert(day.querySelectorAll('button')[0].textContent==='Event 0','native start order retained');day.querySelector('nav button:last-child').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));await wait(()=>day.textContent.includes('Event 4990'));day.querySelector('button').click();assert(opened[0]==='row-4990','keyboard paging opens the correct row');
          index=new HyperDatabaseCalendarSpanIndex(events.slice(0,1),event=>({start:hyperDateTimestamp('2026-11-11'),end:hyperDateTimestamp('2026-11-12')}),days,'UTC');calendar();await wait(()=>day.querySelectorAll('button').length===1&&day.textContent.includes('Event 0'));assert(!host.querySelector('[aria-label="2026-11-13"] button'),'shrinking events clamps pages and removes stale spans');
          app.unmount();return 'Hyper date filter editor checks passed';
        })();
      `);
      const bundled = await build({ input: entry, onwarn(warning, handler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning); }, plugins: [{ name: 'isolated-date-filter-context', resolveId(source) {
        if (source.endsWith('/i18n')) return i18n;
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', '@bufbuild/protobuf'].includes(source)) return resolvePackage(source);
        return null;
      } }], resolve: { alias: { '@/i18n': i18n, '@': path.join(root, 'src/renderer'), '@shared': path.join(root, 'src/shared') } }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, output: { format: 'iife' }, write: false });
      const code = bundled.output.find(chunk => chunk.type === 'chunk'); if (code?.type !== 'chunk') throw Error('No date filter editor bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${code.code}\nwindow.hyperDateFilterChecks`);
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'"><body></body>');
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});try{console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8')));app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});`);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper date filter editor checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 70_000);
});
