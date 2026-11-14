import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

it.skipIf(process.platform !== 'linux')('reports missing prerequisites without changing them or leaking provider data', () => {
  const test = `import importlib.util,sys,io,json,subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('hyper_readiness',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fault='';calls=[]
def command(args,timeout=15):
 calls.append(args)
 if fault=='docker': raise subprocess.CalledProcessError(1,args)
 return '29'
def inspect(name):
 node=name==m.NODE
 labels=['','',m.STACK] if node else [m.PROJECT,name[len(m.PROJECT)+1:-2],'']
 if fault=='owner' and node: labels[-1]='unrelated'
 current={'Running':fault!='stopped','Health':{'Status':'unhealthy' if fault=='health' else 'healthy'}}
 return current,{'api':[{'HostIp':'0.0.0.0' if fault=='public' else '127.0.0.1'}]},labels
def urlopen(url,timeout):
 if fault=='runtime': raise OSError('private diagnostic with secret')
 response=io.StringIO(json.dumps({'mode':'intelligence','licenseStatus':'missing' if fault=='license' else 'valid','secret':'never serialize this'}))
 response.status=200
 return response
m.command=command;m.inspect=inspect;m.urllib.request.urlopen=urlopen
expected={'':'none','docker':'docker_unavailable','setup':'setup_required','owner':'unsafe_deployment','public':'unsafe_deployment','stopped':'services_stopped','health':'services_unhealthy','runtime':'runtime_unavailable','license':'license_required','provider':'provider_required'}
with patch.object(Path,'exists',lambda p:fault!='setup'),patch.object(Path,'is_file',lambda p:fault!='provider'),patch.object(Path,'stat',lambda p:SimpleNamespace(st_size=10)):
 for fault,problem in expected.items():
  result=m.readiness()
  assert result['problem']==problem,(fault,result)
  assert result['ready']==(not fault)
  assert len(result['checks'])==10 and 'secret' not in json.dumps(result)
 for fault in ['docker','setup','owner','public']:
  before=len(calls);m.operate('start')
  assert all(args[:2]==['docker','info'] for args in calls[before:])
print('ten-readiness-scenarios-pass')
`;
  const result = spawnSync('python3', ['-B', '-c', test, path.join(__dirname, 'HyperOpenBotBackend.py')], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('ten-readiness-scenarios-pass');
});
