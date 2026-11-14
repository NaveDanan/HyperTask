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
