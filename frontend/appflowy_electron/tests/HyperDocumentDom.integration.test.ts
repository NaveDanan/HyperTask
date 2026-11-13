import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY));
(available ? describe : describe.skip)('Hyper editor DOM in Electron', () => {
  it('preserves rich text, embedded data and UTF-16 selections in the actual editing engine', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-document-dom-'));
    try {
      const entry = path.join(temporary, 'entry.ts');
      fs.writeFileSync(entry, `
        import { hyperReadText, hyperWriteText, hyperGetSelection, hyperSetSelection } from ${JSON.stringify(path.join(root, 'src/renderer/features/document/HyperDocumentDom.ts'))};
        const equal = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(JSON.stringify({actual:a, expected:b})); };
        const element = document.createElement('div');
        element.contentEditable = 'true'; document.body.append(element); element.focus();
        const runs = [{insert:'A🌍', attributes:{bold:true, custom:'preserve'}}, {insert:{mention:{page:'id'}}}, {insert:'B\\nC'}];
        hyperWriteText(element, runs);
        equal(hyperReadText(element), runs);
        hyperSetSelection(element, {start:1,end:3}); equal(hyperGetSelection(element), {start:1,end:3});
        hyperSetSelection(element, {start:3,end:4}); equal(hyperGetSelection(element), {start:3,end:4});
        hyperSetSelection(element, {start:7,end:7}); equal(hyperGetSelection(element), {start:7,end:7});
        hyperWriteText(element, [{insert:'<script>bad()</script>',attributes:{href:'javascript:bad()',italic:true}}]);
        equal(element.querySelector('script'), null); equal(element.querySelector('a'), null);
        equal(hyperReadText(element)[0].insert, '<script>bad()</script>');
        element.innerHTML = '<br>'; equal(hyperReadText(element), []);
        hyperWriteText(element, []); hyperSetSelection(element,{start:0,end:0}); equal(hyperGetSelection(element), {start:0,end:0});
        const span = document.createElement('span'); span.dataset.hyperAttributes = JSON.stringify({bold:true});
        span.textContent = 'hello'; element.replaceChildren(span); span.append(document.createTextNode(' pasted'));
        equal(hyperReadText(element), [{insert:'hello pasted',attributes:{bold:true}}]);
        const mention = {insert:'$$',attributes:{mention:{type:'page',page_id:'target'},custom:{preserve:true}}};
        const atomicRuns = [{insert:'🌍',attributes:{italic:true}},mention,{insert:{custom:'embed'}},{insert:' tail'}];
        hyperWriteText(element, atomicRuns);
        const anchors = [...element.querySelectorAll('a')]; equal(anchors.length,2);
        anchors.forEach(anchor=>{anchor.textContent='A very long page title 🌍 that differs from its one-character delta';});
        equal(hyperReadText(element), atomicRuns);
        for(let offset=0;offset<=10;offset++){hyperSetSelection(element,{start:offset,end:offset});equal(hyperGetSelection(element),{start:offset,end:offset});}
        hyperSetSelection(element,{start:2,end:5});equal(hyperGetSelection(element),{start:2,end:5});
        const inside=document.createRange(); inside.setStart(anchors[0].firstChild,3);inside.setEnd(anchors[1].firstChild,8);
        window.getSelection().removeAllRanges();window.getSelection().addRange(inside);
        equal(hyperGetSelection(element),{start:2,end:4});
        inside.collapse(true);window.getSelection().removeAllRanges();window.getSelection().addRange(inside);
        equal(hyperGetSelection(element),{start:3,end:3});
        element.focus();hyperSetSelection(element,{start:4,end:4});
        document.execCommand('insertText',false,'typed');
        equal(hyperReadText(element),[{insert:'🌍',attributes:{italic:true}},mention,{insert:'typed'},{insert:{custom:'embed'}},{insert:' tail'}]);
        'Hyper DOM checks passed';
      `);
      const bundled = await build({ input: entry, plugins: [{
        name: 'document-dom-english-locale-loader',
        transform(code, id) {
          if (!id.endsWith('/renderer/i18n/index.ts')) return null;
          // Standalone rolldown does not expand Vite globs. Retain the real translator
          // and its imported English translations without loading unrelated locales.
          return code.replace("import.meta.glob('@resources/translations/*.json', { import: 'default' })", "({ '@resources/translations/en-US.json': async () => en })");
        },
      }], resolve: { alias: { '@shared': path.join(root, 'src/shared') } }, output: { format: 'iife' }, write: false });
      const script = bundled.output.find(chunk => chunk.type === 'chunk')!;
      if (script.type !== 'chunk') throw new Error('No DOM test bundle');
      fs.writeFileSync(path.join(temporary, 'checks.js'), `${script.code}\n'Hyper DOM checks passed'`);
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `
        const {app,BrowserWindow}=require('electron');
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
          win.webContents.on('console-message',event=>{if(event.level==='error')console.error('Renderer error:',event.message)});
          await win.loadURL('data:text/html,<html><body></body></html>');
          try { console.log(await win.webContents.executeJavaScript(require('node:fs').readFileSync(${JSON.stringify(path.join(temporary, 'checks.js'))},'utf8'))); app.exit(0); }
          catch(e) { console.error(e.stack); app.exit(1); }
        }).catch(e=>{console.error(e);app.exit(1)});
      `);
      // Run only the disposable hidden test window. No app profile or real workspace is used.
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper DOM checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
