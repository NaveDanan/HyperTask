// Explicit development seed / screenshot driver. Requires a running web-harness server.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const [mode] = process.argv.slice(2);
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; };
const root = path.resolve('..', '..', '.cache/hyper-views');
const manifest = path.resolve(arg('manifest', path.join(root, 'sample-views.json')));
const steps = [{ waitFor: 'Boolean(window.hyperViews)' }, { eval: 'window.hyperViews.ready()' }];
if (mode === 'seed') steps.push({ eval: `window.hyperViews.seed(${Number(arg('rows', '12'))})`, result: manifest, timeout: 240000 });
else if (mode === 'shot') {
  const requested = arg('view');
  if (!requested) throw new Error('Pass --view <view-id or grid|board|calendar|gantt>');
  const viewId = ['grid', 'board', 'calendar', 'gantt'].includes(requested) ? JSON.parse(fs.readFileSync(manifest, 'utf8')).find(sample => sample.layout === requested)?.viewId : requested;
  if (!viewId) throw new Error(`No seeded ${requested} view in ${manifest}`);
  const theme = arg('theme', 'light'); if (!['light', 'dark'].includes(theme)) throw new Error('--theme must be light or dark');
  steps.push({ eval: `window.hyperViews.theme(${JSON.stringify(theme)}); window.hyperViews.open(${JSON.stringify(viewId)})` }, { waitFor: `document.querySelector('[data-hyper-database="${viewId}"][data-hyper-views-ready="true"]') !== null` }, { eval: 'document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))' }, { shot: path.resolve(arg('out', path.join(root, 'shots', `${requested}-${theme}.png`))) });
} else throw new Error('Usage: hyper-views.mjs seed|shot [--url URL] [--manifest FILE] [--view ID|layout] [--width 1280] [--height 860] [--theme light|dark] [--out PNG]');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-views-'));
try {
  const plan = path.join(temp, 'plan.json'); fs.writeFileSync(plan, JSON.stringify({ width: Number(arg('width', '1280')), height: Number(arg('height', '860')), colorScheme: arg('theme', 'light'), steps }));
  const run = spawnSync(process.execPath, ['scripts/web-harness/screenshot.mjs', arg('url', 'http://127.0.0.1:5199'), plan], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
