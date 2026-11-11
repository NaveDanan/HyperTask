import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const available = fs.existsSync(executable) && (process.platform !== 'linux' || !!process.env.DISPLAY);
(available ? describe : describe.skip)('Hyper managed assets in Electron', () => {
  it('loads a copied image in a sandboxed renderer and denies paths outside managed assets', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-assets-electron-'));
    try {
      const storage = path.join(temporary, 'data'); fs.mkdirSync(storage);
      const source = path.join(temporary, 'drawing.svg');
      fs.writeFileSync(source, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>');
      fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src appflowy-file:"><body></body>');
      const entry = path.join(temporary, 'entry.ts');
      fs.writeFileSync(entry, `
        import {app,BrowserWindow,net} from 'electron';
        import fs from 'node:fs/promises'; import assert from 'node:assert/strict';
        import {HyperAssets} from ${JSON.stringify(path.join(root, 'src/main/HyperAssets.ts'))};
        import {hyperRegisterAssetScheme,hyperHandleAssetProtocol} from ${JSON.stringify(path.join(root, 'src/main/HyperAssetProtocol.ts'))};
        hyperRegisterAssetScheme();
        app.whenReady().then(async()=>{
          const assets=new HyperAssets(()=>${JSON.stringify(storage)});
          const imported=await assets.importFile(${JSON.stringify(source)},'image');
          await fs.unlink(${JSON.stringify(source)});
          hyperHandleAssetProtocol(assets);
          const response=await net.fetch(imported.previewUrl);assert.equal(response.status,200);
          assert((await response.text()).includes('<svg'));assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
          assert(response.headers.get('Content-Security-Policy').includes('sandbox'));
          const head=await net.fetch(imported.previewUrl,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
          const rejected=await net.fetch('appflowy-file://local/files/%2e%2e%2fprivate');assert.equal(rejected.status,404);
          const foreign=await net.fetch('appflowy-file://foreign/images/a.svg');assert.equal(foreign.status,404);
          const mutation=await net.fetch(imported.previewUrl,{method:'POST'});assert.equal(mutation.status,405);
          const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
          await win.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});
          const size=await win.webContents.executeJavaScript('(async()=>{const image=new Image();const loaded=new Promise((resolve,reject)=>{image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=()=>reject(Error("Image failed to load"));});image.src='+JSON.stringify(imported.previewUrl)+';document.body.append(image);return loaded;})()');
          assert.deepEqual(size,[40,20]);
          assert.equal(await new HyperAssets(()=>${JSON.stringify(storage)}).resolve(imported.previewUrl),imported.path);
          console.log('Hyper native asset checks passed');app.exit(0);
        }).catch(error=>{console.error(error.stack);app.exit(1)});
      `);
      const result = await build({ input: entry, platform: 'node', external: ['electron', /^node:/], resolve: { alias: { '@shared': path.join(root, 'src/shared') } }, output: { format: 'cjs' }, write: false });
      const code = result.output.find(chunk => chunk.type === 'chunk');
      if (code?.type !== 'chunk') throw new Error('No asset integration bundle');
      const main = path.join(temporary, 'main.cjs'); fs.writeFileSync(main, code.code);
      const { stdout } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper native asset checks passed');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
