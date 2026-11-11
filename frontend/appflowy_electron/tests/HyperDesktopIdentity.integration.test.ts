import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { HYPER_DESKTOP_APP_ID, HYPER_DESKTOP_FILE } from '../src/shared/HyperDesktopIdentity';
const root = path.resolve(__dirname, '..'), execute = promisify(execFile), electron = path.join(root, 'node_modules/electron/dist/electron');
const available = process.platform === 'linux' && !!process.env.DISPLAY && fs.existsSync(electron) && fs.existsSync('/usr/bin/python3') && fs.existsSync('/usr/bin/desktop-file-validate');
(available ? describe : describe.skip)('Hyper private OS identity and encryption compatibility', () => {
  it('resolves the staged desktop entry, binds its Wayland/X11 identity and decrypts old-identity safeStorage ciphertext in a separate private profile', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-desktop-identity-'));
    try {
      const stage = path.join(temporary, 'stage'); await execute(process.execPath, [path.join(root, 'scripts/hyper-stage-identity.mjs'), 'linux', stage]);
      const bin = path.join(temporary, 'bin'); fs.mkdirSync(bin); const launcher = path.join(bin, 'hypertask');
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      fs.writeFileSync(launcher, '#!/bin/sh\nexec ' + [electron, '--no-sandbox', '--user-data-dir=' + path.join(temporary, 'own-profile'), path.join(temporary, 'own-app')].map(quote).join(' ') + '\n', { mode: 0o755 });
      const environment = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, XDG_DATA_HOME: path.join(stage, 'share') };
      const desktop = path.join(stage, 'share/applications', HYPER_DESKTOP_FILE); await execute('/usr/bin/desktop-file-validate', [desktop]);
      const registry = `import gi,json;gi.require_version('Gio','2.0');from gi.repository import Gio;app=Gio.DesktopAppInfo.new(${JSON.stringify(HYPER_DESKTOP_FILE)});assert app is not None;print(json.dumps({'id':app.get_id(),'name':app.get_name(),'filename':app.get_filename(),'executable':app.get_executable()}))`;
      const registered = JSON.parse((await execute('/usr/bin/python3', ['-c', registry], { env: environment })).stdout);
      expect(registered).toEqual({ id: HYPER_DESKTOP_FILE, name: 'HyperTask', filename: desktop, executable: 'hypertask' });
      const helperEntry = path.join(temporary, 'identity.ts'), helper = path.join(temporary, 'identity.cjs'); fs.writeFileSync(helperEntry, `export{hyperBindDesktopIdentity}from${JSON.stringify(path.join(root, 'src/main/HyperDesktopIdentity.ts'))};export{HYPER_DESKTOP_APP_ID}from${JSON.stringify(path.join(root, 'src/shared/HyperDesktopIdentity.ts'))};`);
      await build({ input: helperEntry, platform: 'node', output: { file: helper, format: 'cjs' } });
      const ciphertext = path.join(temporary, 'disposable.cipher'), nonce = `Disposable identity compatibility ${crypto.randomUUID()}`, reports: Array<{ name: string; backend: string; matched: boolean; isolated: boolean }> = [];
      for (const own of [false, true]) {
        const appDirectory = path.join(temporary, own ? 'own-app' : 'old-app'), profile = path.join(temporary, own ? 'own-profile' : 'old-profile'); fs.mkdirSync(appDirectory);
        fs.writeFileSync(path.join(appDirectory, 'package.json'), JSON.stringify({ name: 'hypertask', productName: 'HyperTask', version: '0.11.4', main: 'main.cjs', ...(own ? { desktopName: HYPER_DESKTOP_FILE } : {}) }));
        const main = `const{app,safeStorage,BrowserWindow}=require('electron'),fs=require('node:fs'),{execFileSync}=require('node:child_process');const{hyperBindDesktopIdentity,HYPER_DESKTOP_APP_ID}=require(${JSON.stringify(helper)});${own ? 'hyperBindDesktopIdentity(app,process.platform);' : ''}app.whenReady().then(async()=>{if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend()==='basic_text')throw Error('Secure OS storage is unavailable');${own ? `const matched=safeStorage.decryptString(fs.readFileSync(${JSON.stringify(ciphertext)}))===${JSON.stringify(nonce)};` : `fs.writeFileSync(${JSON.stringify(ciphertext)},safeStorage.encryptString(${JSON.stringify(nonce)}));const matched=true;`}const win=new BrowserWindow({show:true,title:'HyperTask private identity fixture',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('data:text/html,<title>HyperTask private identity fixture</title><p>Private OS identity fixture</p>');await new Promise(resolve=>setTimeout(resolve,150));if(process.env.XDG_SESSION_TYPE==='x11'){const wm=execFileSync('xprop',['-id','0x'+win.getNativeWindowHandle().readUInt32LE(0).toString(16),'WM_CLASS'],{encoding:'utf8'});console.log('HYPER_WM_CLASS '+JSON.stringify(wm))}console.log('HYPER_IDENTITY_RESULT '+JSON.stringify({name:app.getName(),backend:safeStorage.getSelectedStorageBackend(),matched,isolated:app.getPath('userData')===${JSON.stringify(profile)}}));app.exit(0)}).catch(error=>{console.error(error.message);app.exit(1)});`;
        fs.writeFileSync(path.join(appDirectory, 'main.cjs'), main);
        const { stdout, stderr } = await execute(electron, ['--no-sandbox', `--user-data-dir=${profile}`, appDirectory], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024, env: { ...environment, ELECTRON_RUN_AS_NODE: '', WAYLAND_DEBUG: 'client' } });
        const result = stdout.split('\n').find(line => line.startsWith('HYPER_IDENTITY_RESULT ')); if (!result) throw Error('No native identity result'); reports.push(JSON.parse(result.slice('HYPER_IDENTITY_RESULT '.length)));
        if (own && process.env.XDG_SESSION_TYPE === 'wayland') expect(stderr).toContain(`set_app_id("${HYPER_DESKTOP_APP_ID}")`);
        if (own && process.env.XDG_SESSION_TYPE === 'x11') expect(stdout).toContain(HYPER_DESKTOP_APP_ID);
      }
      expect(reports[0]).toMatchObject({ name: 'HyperTask', matched: true, isolated: true }); expect(reports[1]).toEqual(reports[0]); expect(reports[0].backend).not.toBe('basic_text');
      expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).desktopName).toBe(HYPER_DESKTOP_FILE);
      expect(fs.readFileSync(path.join(root, 'src/main/HyperStartup.ts'), 'utf8')).toContain("const DESKTOP_FILE = 'hypertask.desktop'");
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 50_000);
});
