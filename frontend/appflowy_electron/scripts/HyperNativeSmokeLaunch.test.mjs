import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('owned-process guard refuses another checkout, profile, prefix neighbor or debug port', () => {
  const test = `import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('hyper_launcher',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
app=Path('/checkout/frontend');profile=Path('/private/smoke')
args=['electron',str(app),'--user-data-dir=/private/smoke/electron','--remote-debugging-port=9222']
assert m.owns_command(args,app,profile,9222)
assert m.owns_command([' '.join(args)],app,profile,9222)
assert not m.owns_command([' '.join(args)],Path('/checkout/front'),profile,9222)
assert not m.owns_command([' '.join(args)],app,Path('/private/smok'),9222)
assert not m.owns_command(args,Path('/checkout/other'),profile,9222)
assert not m.owns_command(args,app,Path('/private/real-user'),9222)
assert not m.owns_command(args,Path('/checkout/front'),profile,9222)
assert not m.owns_command(args,app,profile,9223)
print('owned-process-guard-pass')`;
  const result = spawnSync('python3', ['-B', '-c', test, fileURLToPath(new URL('./HyperNativeSmokeLaunch.py', import.meta.url))], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'owned-process-guard-pass');
});
test('restart waits only for its owned core and refuses a replacement while it remains alive', () => {
  const code = `import importlib.util,sys,subprocess,time,signal
from pathlib import Path
spec=importlib.util.spec_from_file_location('hyper_launcher',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
unrelated=subprocess.Popen([sys.executable,'-c','import time;time.sleep(10)'])
owned=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,lambda *_:(time.sleep(.2),exit(0)));print("ready",flush=True);time.sleep(10)'],stdout=subprocess.PIPE,text=True)
try:
 assert owned.stdout.readline().strip()=='ready'
 owned.terminate();start=time.monotonic();m.wait_for_cores([Path('/proc')/str(owned.pid)],timeout=2)
 assert time.monotonic()-start>=.1
 assert unrelated.poll() is None
 try:
  m.wait_for_cores([Path('/proc')/str(unrelated.pid)],timeout=.05)
  raise AssertionError('Live core accepted')
 except RuntimeError:pass
finally:
 for process in [owned,unrelated]:
  if process.poll() is None:process.kill()
  process.wait()
print('core-exit-barrier-pass')`;
  const result = spawnSync('python3', ['-B', '-c', code, fileURLToPath(new URL('./HyperNativeSmokeLaunch.py', import.meta.url))], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'core-exit-barrier-pass');
});
