import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
it.skipIf(process.platform !== 'linux')('the bundled Python controller rejects public bindings and keeps operations in the existing deployment', () => {
  const source = path.join(__dirname, 'HyperOpenBotBackend.py');
  const test = `import importlib.util,sys\nspec=importlib.util.spec_from_file_location('hyper_fixture',sys.argv[1])\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nassert m.private_ports({'api':[{'HostIp':'127.0.0.1'},{'HostIp':'::1'}]})\nfor host in ['0.0.0.0','::','',None]:\n assert not m.private_ports({'api':[{'HostIp':host}]})\ncalls=[]\nm.command=lambda args,timeout=15:calls.append(args)\ndef status(ready=False,problem='services_stopped',stopped=False):\n r=m.report();r.update(ready=ready,problem=problem)\n for row in r['checks']:\n  row['state']='stopped' if stopped and row['id'] in ('deployment',*m.SERVICES) else 'ready'\n return r\nm.readiness=lambda:status(True,'none')\nassert m.operate('start')['ready'] and not calls\nm.readiness=lambda:status(problem='unsafe_deployment')\nm.operate('start');m.operate('stop');assert not calls\nm.readiness=lambda:status(stopped=True)\nm.operate('stop');assert not calls\nresponses=iter([status(stopped=True),status(True,'none')])\nm.readiness=lambda:next(responses)\nassert m.operate('start')['ready']\nassert calls[0]==['docker','start',m.NODE]\nassert calls[1]==m.CLI+['start','--stack',m.STACK,'--json']\nassert calls[2]==m.COMPOSE+['start','postgres','agent-computer','agent-harness','server','worker']\nassert all('down' not in args and 'prune' not in args and '--volumes' not in args for args in calls)\nprint('scoped-controller-policy-pass')\n`;
  const result = spawnSync('python3', ['-B', '-c', test, source], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0); expect(result.stdout.trim()).toBe('scoped-controller-policy-pass');
});
it.skipIf(process.platform !== 'linux')('refuses host and shared-container namespaces before any node or service lifecycle operation', () => {
  const test = `import importlib.util,sys,json,io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('hyper_network',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
target='';mode='';calls=[]
def command(args,timeout=15):
 calls.append(args)
 if args[:2]==['docker','info']: return '29'
 assert args[:2]==['docker','inspect'],('unexpected mutation',args)
 name=args[-1];node=name==m.NODE
 fields=[json.dumps({'Running':True}),'{}']
 if '.HostConfig.NetworkMode' in args[3]: fields.append(json.dumps(mode if name==target else 'bridge'))
 fields+=['','',m.STACK] if node else [m.PROJECT,name[len(m.PROJECT)+1:-2],'']
 return '\\n'.join(fields)+'\\n'
def urlopen(url,timeout):
 response=io.StringIO(json.dumps({'mode':'intelligence','licenseStatus':'valid'}));response.status=200;return response
m.command=command;m.urllib.request.urlopen=urlopen
with patch.object(Path,'exists',lambda p:True),patch.object(Path,'is_file',lambda p:True),patch.object(Path,'stat',lambda p:SimpleNamespace(st_size=10)):
 for target in [m.NODE]+[m.PROJECT+'-'+service+'-1' for service in m.SERVICES.values()]:
  for mode in ['host','container:unrelated-container']:
   result=m.readiness()
   assert result['problem']=='unsafe_deployment' and not result['ready'],(target,mode,result)
   for action in ['start','stop','restart']:
    assert m.operate(action)['problem']=='unsafe_deployment'
print('twelve-shared-namespace-scenarios-pass')
`;
  const result = spawnSync('python3', ['-B', '-c', test, path.join(__dirname, 'HyperOpenBotBackend.py')], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('twelve-shared-namespace-scenarios-pass');
});
