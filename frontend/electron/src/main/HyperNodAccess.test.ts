import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { hyperNodReadAccess } from './HyperNodAccess';
const target = () => ({ command: 'ssh', host: 'agent@vm' });
function child() {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  mocks.spawn.mockReturnValueOnce(process);
  return process;
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
const finish = (process: ReturnType<typeof child>, output: string, code = 0) => { process.stdout.end(output); process.emit('close', code); };
it('runs only the bundled program with a fixed action and returns the token', async () => {
  const process = child();
  const script: Buffer[] = []; process.stdin.on('data', chunk => script.push(chunk));
  const token = hyperNodReadAccess(new AbortController().signal, target);
  finish(process, `{"version":1,"problem":"none","token":"${'b'.repeat(64)}"}\n`);
  await expect(token).resolves.toBe('b'.repeat(64));
  expect(mocks.spawn).toHaveBeenCalledWith('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'agent@vm', 'python3 - access'], expect.objectContaining({ stdio: ['pipe', 'pipe', 'ignore'] }));
  expect(Buffer.concat(script).toString()).toContain("ENV = '/home/agent/HyperTask-Nod/deployment/self-host/.env'");
});
it('keeps the deployment reason and maps SSH failures', async () => {
  let process = child();
  let result = hyperNodReadAccess(new AbortController().signal, target);
  finish(process, '{"version":1,"problem":"unsafe_deployment","detail":"PORT must be 4311 in the Nod .env."}');
  await expect(result).rejects.toMatchObject({ problem: 'unsafe_deployment', detail: 'PORT must be 4311 in the Nod .env.' });
  process = child(); result = hyperNodReadAccess(new AbortController().signal, target);
  finish(process, '', 255);
  await expect(result).rejects.toMatchObject({ problem: 'ssh_unavailable' });
  process = child(); result = hyperNodReadAccess(new AbortController().signal, target);
  finish(process, 'Traceback', 1);
  await expect(result).rejects.toMatchObject({ problem: 'operation_failed', detail: 'Reading the Nod installation failed with exit code 1.' });
});
it('refuses malformed reports, including a token with a problem or a short token', async () => {
  for (const output of ['{"version":1,"problem":"none"}', `{"version":1,"problem":"setup_required","token":"${'c'.repeat(43)}"}`, '{"version":1,"problem":"none","token":"short"}', 'not json', '{"version":2,"problem":"none"}']) {
    const process = child();
    const result = hyperNodReadAccess(new AbortController().signal, target);
    finish(process, output);
    await expect(result).rejects.toMatchObject({ problem: 'operation_failed' });
  }
});
it('kills SSH on abort and on an oversized report', async () => {
  let process = child();
  const controller = new AbortController();
  let result = hyperNodReadAccess(controller.signal, target);
  controller.abort();
  await expect(result).rejects.toMatchObject({ problem: 'signed_out' });
  expect(process.kill).toHaveBeenCalledWith('SIGTERM');
  process = child(); result = hyperNodReadAccess(new AbortController().signal, target);
  process.stdout.write('x'.repeat(5000));
  await expect(result).rejects.toMatchObject({ problem: 'operation_failed' });
  expect(process.kill).toHaveBeenCalled();
});
