// Takes screenshots of a page with headless Chrome over the DevTools protocol, optionally
// running steps (JS to evaluate, waits) in between. Development aid for visual checks.
//
//   node scripts/web-harness/screenshot.mjs <url> <steps.json>
// steps.json: { "width": 1280, "height": 860, "steps": [
//   { "wait": 4000 }, { "shot": "home.png" }, { "eval": "document.querySelector(...).click()" }, ... ] }
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, stepsFile] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(
  (p) => fs.existsSync(p),
);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'af-shot-'));
const port = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${plan.width ?? 1280},${plan.height ?? 860}`,
    '--hide-scrollbars',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) throw new Error('Chrome did not start');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  }
});
const send = (method, params = {}, timeoutMs = 20_000) =>
  new Promise((resolve) => {
    const callId = ++id;
    const timer = setTimeout(() => {
      pending.delete(callId);
      resolve({ timeout: true });
      console.log(`timeout: ${method} (page busy?)`);
    }, timeoutMs);
    pending.set(callId, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: plan.width ?? 1280, height: plan.height ?? 860, deviceScaleFactor: 1, mobile: false });
if (plan.colorScheme) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: plan.colorScheme }] });
await send('Page.navigate', { url });

for (const step of plan.steps) {
  if (step.wait) await sleep(step.wait);
  if (step.eval) {
    const result = await send('Runtime.evaluate', { expression: step.eval, awaitPromise: true, returnByValue: true });
    const value = result.result?.result?.value;
    if (value !== undefined) console.log(`eval → ${JSON.stringify(value)}`);
    if (result.result?.exceptionDetails) console.log(`eval error: ${result.result.exceptionDetails.exception?.description}`);
  }
  if (step.shot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.timeout) continue;
    fs.writeFileSync(step.shot, Buffer.from(shot.result.data, 'base64'));
    console.log(`saved ${step.shot}`);
  }
}
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
ws.close();
browser.kill();
await sleep(300);
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {
  // Chrome may still hold the profile briefly.
}
process.exit(0);
