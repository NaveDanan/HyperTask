import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { HyperNodProblem } from '@shared/HyperNod';
import { hyperOpenBotSshTarget } from './HyperOpenBotSsh';
import script from './HyperNodAccess.py?raw';
export class HyperNodError extends Error {
  constructor(readonly problem: Exclude<HyperNodProblem, 'none'>, readonly detail?: string, readonly status?: number, readonly code?: string) {
    super(detail ?? problem);
    this.name = 'HyperNodError';
  }
}
const schema = z.strictObject({
  version: z.literal(1),
  problem: z.enum(['none', 'setup_required', 'unsafe_deployment', 'operation_failed']),
  detail: z.string().max(500).optional(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43,512}$/).optional(),
}).refine(value => (value.problem === 'none') === (value.token !== undefined));
/** SSH receives one bundled program and a fixed action, never renderer input. The token stays in main memory. */
export function hyperNodReadAccess(signal: AbortSignal, target = hyperOpenBotSshTarget): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const ssh = target();
    const child = spawn(ssh.command, ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', ssh.host, 'python3 - access'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let output = '', settled = false;
    const timer = setTimeout(() => finish(new HyperNodError('ssh_unavailable', 'Reading the Nod installation on the VM timed out.')), 30000);
    const abort = () => finish(new HyperNodError('signed_out'));
    function finish(error?: HyperNodError) {
      if (settled) return; settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) { child.kill('SIGTERM'); reject(error); return; }
      let value: z.infer<typeof schema>;
      try { value = schema.parse(JSON.parse(output)); }
      catch { reject(new HyperNodError('operation_failed', 'The VM returned an unreadable Nod access report.')); return; }
      if (value.problem === 'none') resolve(value.token!);
      else reject(new HyperNodError(value.problem, value.detail));
    }
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new HyperNodError('ssh_unavailable', 'OpenSSH could not be started.')));
    child.stdout.on('data', data => { output += data.toString(); if (output.length > 4096) finish(new HyperNodError('operation_failed', 'The VM returned an oversized Nod access report.')); });
    child.stdin.on('error', () => { /* The exit code reports an unavailable SSH or Python. */ });
    child.on('close', code => finish(code === 0 ? undefined : new HyperNodError(code === 255 ? 'ssh_unavailable' : 'operation_failed', code === 255 ? undefined : `Reading the Nod installation failed with exit code ${code}.`)));
    child.stdin.end(script);
  });
}
