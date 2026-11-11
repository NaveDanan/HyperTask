import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoreProcess } from './process';
import { Status } from './protocol';

// A disposable authenticated child implements the real bridge frames, with
// controlled teardown timing. It never opens a workspace or contacts a server.
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-sdk-lifecycle-'));
  const binary = path.join(directory, 'core.cjs');
  fs.writeFileSync(binary, `#!${process.execPath}
const net=require('node:net');
const socket=net.connect(Number(process.env.APPFLOWY_CORE_PORT),'127.0.0.1');
const frame=(kind,...parts)=>{const body=Buffer.concat([Buffer.from([kind]),...parts]),head=Buffer.alloc(4);head.writeUInt32LE(body.length);return Buffer.concat([head,body]);};
const send=(kind,...parts)=>socket.write(frame(kind,...parts));
const done=()=>{const value=Buffer.alloc(8);send(0x81,value);};
const reply=(id,value)=>send(0x82,id,Buffer.from([0]),Buffer.from(value));
const port=value=>{const id=Buffer.alloc(8);id.writeBigInt64LE(77n);const text=Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32LE(text.length);send(0x84,id,Buffer.from([4]),size,text);};
let buffer=Buffer.alloc(0),cycles=0,held=null;const requests=[];
socket.on('connect',()=>send(0x80,Buffer.from(process.env.APPFLOWY_CORE_TOKEN)));
socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){const size=buffer.readUInt32LE(0),kind=buffer[4],body=buffer.subarray(5,4+size);buffer=buffer.subarray(4+size);
if(kind===1){cycles++;if(cycles===1)done();else{if(held)reply(held,'late old success');send(0x83,Buffer.from('old notification'));port('old stream');process.stdout.write('initializing\\n');}}
else if(kind===2){const id=Buffer.from(body.subarray(0,8)),length=body.readUInt32LE(8),event=body.toString('utf8',12,12+length);requests.push(event);if(event==='HoldOld'){held=id;process.stdout.write('held\\n');}else reply(id,event==='Inspect'?JSON.stringify(requests):'current result');}
else if(kind===3){done();send(0x83,Buffer.from('current notification'));port('current stream');}
else if(kind===4){socket.end();setTimeout(()=>process.exit(0),5);}
}});
`, { mode: 0o700 });
  const core = new CoreProcess(binary);
  const milestones = new Set<string>(), waiters = new Map<string, () => void>();
  const wait = (name: string) => milestones.has(name) ? Promise.resolve() : new Promise<void>(resolve => { waiters.set(name, resolve); });
  await core.start(chunk => { for (const line of chunk.toString().trim().split('\n')) { milestones.add(line); waiters.get(line)?.(); } });
  return { core, wait, async dispose() { await core.stop(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

describe('Hyper CoreProcess SDK replacement boundary', () => {
  it('retires pending replies, blocks requests during init, drops old events, and never replays a write', async () => {
    const active = await fixture(), notifications: string[] = [], streams: string[] = [];
    active.core.on('notification', bytes => notifications.push(Buffer.from(bytes).toString()));
    active.core.on('portMessage', (_port, value) => streams.push(String(value)));
    try {
      expect(await active.core.init({ cycle: 1 })).toBe(0);
      const pending = active.core.request('HoldOld', new Uint8Array([1, 2, 3]));
      await active.wait('held');
      const replacement = active.core.init({ cycle: 2 });
      const retired = await pending;
      expect(retired.status).toBe(Status.Internal); expect(Buffer.from(retired.payload).toString()).toContain('retired');
      await active.wait('initializing');
      const blocked = await active.core.request('WriteDuringInit', new Uint8Array([4]));
      expect(blocked.status).toBe(Status.Internal); expect(Buffer.from(blocked.payload).toString()).toContain('initializing');
      expect(notifications).toEqual([]); expect(streams).toEqual([]);
      active.core.log(0, 'finish initialization'); expect(await replacement).toBe(0);
      const inspect = await active.core.request('Inspect', new Uint8Array());
      expect(JSON.parse(Buffer.from(inspect.payload).toString())).toEqual(['HoldOld', 'Inspect']);
      expect(notifications).toEqual(['current notification']); expect(streams).toEqual(['current stream']);
      expect((await active.core.request('Current', new Uint8Array())).status).toBe(Status.Ok);
    } finally { await active.dispose(); }
  });
  it('settles an initialization waiter when its child exits and does not hang an init without transport', async () => {
    const active = await fixture();
    try {
      expect(await active.core.init({ cycle: 1 })).toBe(0);
      const pending = active.core.init({ cycle: 2 }); await active.wait('initializing');
      await active.core.stop(); expect(await pending).toBe(-1);
      expect(await active.core.init({ cycle: 3 })).toBe(-1);
    } finally { await active.dispose(); }
  });
});
