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
(available ? describe : describe.skip)('Hyper endpoint discovery in Electron main', () => {
  it('uses real Chromium networking, all model pages, transient credentials and safe cancellation', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-endpoint-discovery-'));
    try {
      const entry = path.join(temporary, 'entry.ts');
      fs.writeFileSync(entry, `
        import { app } from 'electron';
        import http from 'node:http';
        import assert from 'node:assert/strict';
        import { randomBytes } from 'node:crypto';
        import { discoverEndpoint, testEndpoint } from ${JSON.stringify(path.join(root, 'src/main/openai-endpoint.ts'))};
        import { toIpcResult } from ${JSON.stringify(path.join(root, 'src/main/settings-error.ts'))};
        app.whenReady().then(async()=>{
          const credential='fixture-'+randomBytes(12).toString('hex');
          let mode='pages',trapRequests=0,requests=0,trapUrl='';
          const trap=http.createServer((req,res)=>{trapRequests++;res.end('bad');});
          await new Promise(resolve=>trap.listen(0,'127.0.0.1',resolve));
          trapUrl='http://127.0.0.1:'+trap.address().port+'/v1/models';
          const endpoint=http.createServer((req,res)=>{
            requests++; const url=new URL(req.url,'http://localhost');
            if(req.headers.authorization!=='Bearer '+credential){res.writeHead(401);res.end(credential);return;}
            if(mode==='redirect'){res.writeHead(302,{Location:trapUrl});res.end();return;}
            if(mode==='unsafe'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[],next:trapUrl}));return;}
            if(mode==='hang'){return;}
            if(mode==='empty'){res.end(JSON.stringify({data:[]}));return;}
            if(mode==='malformed'){res.end(credential);return;}
            if(req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{assert.equal(JSON.parse(body).model,'model-b');assert(!body.includes(credential));res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));});return;}
            res.setHeader('Content-Type','application/json');
            res.end(JSON.stringify(url.searchParams.has('after')?{data:[{id:'model-a'},{id:'model-b'}],has_more:false}:{data:[{id:'model-b'}],has_more:true,last_id:'model-b'}));
          });
          await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
          const baseUrl='http://127.0.0.1:'+endpoint.address().port+'/v1';
          try{
            const input={baseUrl,protectedKey:'not-used-on-this-platform',apiKey:credential};
            assert.deepEqual(await discoverEndpoint(input),{models:['model-a','model-b']});assert.equal(requests,2);
            await testEndpoint({...input,model:'model-b'});
            mode='empty';assert.deepEqual(await discoverEndpoint(input),{models:[]});
            for(const variant of ['unsafe','redirect']){mode=variant;const result=await toIpcResult(()=>discoverEndpoint(input));assert.equal(result.ok,false);assert(!JSON.stringify(result).includes(credential));assert.equal(trapRequests,0);}
            mode='malformed';const malformed=await toIpcResult(()=>discoverEndpoint(input));assert.equal(malformed.ok,false);assert(!JSON.stringify(malformed).includes(credential));
            const denied=await toIpcResult(()=>discoverEndpoint({...input,apiKey:''}));assert.equal(denied.ok,false);assert(denied.message.includes('401'));assert(!JSON.stringify(denied).includes(credential));
            mode='hang';const controller=new AbortController();const cancelled=toIpcResult(()=>discoverEndpoint(input,controller.signal));setTimeout(()=>controller.abort(),50);assert.equal((await cancelled).ok,false);
            console.log('Hyper endpoint main-process checks passed');
          }finally{endpoint.closeAllConnections();trap.closeAllConnections();await Promise.all([new Promise(resolve=>endpoint.close(resolve)),new Promise(resolve=>trap.close(resolve))]);}
          app.exit(0);
        }).catch(error=>{console.error(error.message);app.exit(1);});
      `);
      const result = await build({ input: entry, platform: 'node', external: ['electron', /^node:/], resolve: { alias: { '@shared': path.join(root, 'src/shared') } }, output: { format: 'cjs' }, write: false });
      const code = result.output.find(chunk => chunk.type === 'chunk');
      if (code?.type !== 'chunk') throw new Error('No endpoint integration bundle');
      const main = path.join(temporary, 'main.cjs'); fs.writeFileSync(main, code.code);
      const { stdout, stderr } = await promisify(execFile)(executable, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      expect(stdout).toContain('Hyper endpoint main-process checks passed'); expect(stdout + stderr).not.toContain('fixture-');
      expect(fs.existsSync(path.join(temporary, 'profile/local_ai/openai-endpoint.json'))).toBe(false);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
