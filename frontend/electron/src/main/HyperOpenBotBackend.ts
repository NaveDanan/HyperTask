import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import script from './HyperOpenBotBackend.py?raw';
import { HYPER_OPENBOT_CHECKS, type HyperOpenBotBackendReport, type HyperOpenBotServiceProblem } from '@shared/HyperOpenBotService';
import { HyperOpenBotService, HyperOpenBotServiceError } from './HyperOpenBotService';
import type { HyperOpenBotSession } from './HyperOpenBotSession';
const PROBLEMS = ['none', 'docker_unavailable', 'setup_required', 'unsafe_deployment', 'services_stopped', 'services_unhealthy', 'runtime_unavailable', 'license_required', 'provider_required', 'operation_failed'] as const;
const schema = z.strictObject({ version: z.literal(1), ready: z.boolean(), problem: z.enum(PROBLEMS), checks: z.array(z.strictObject({ id: z.enum(HYPER_OPENBOT_CHECKS), state: z.enum(['ready', 'stopped', 'missing', 'unhealthy', 'unknown']) })).length(HYPER_OPENBOT_CHECKS.length) });
export function hyperParseBackendReport(text: string): HyperOpenBotBackendReport {
  const result = schema.parse(JSON.parse(text));
  if (new Set(result.checks.map(row => row.id)).size !== HYPER_OPENBOT_CHECKS.length || result.ready !== (result.problem === 'none' && result.checks.every(row => row.state === 'ready'))) throw new HyperOpenBotServiceError('operation_failed');
  return result;
}
/** SSH receives one bundled program and a closed action enum, never renderer-supplied code. */
export function hyperRunBackend(action: 'check' | 'start' | 'stop' | 'restart', signal: AbortSignal): Promise<HyperOpenBotBackendReport> {
  if (!['check', 'start', 'stop', 'restart'].includes(action)) return Promise.reject(new HyperOpenBotServiceError('operation_failed'));
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', 'agent@100.104.170.51', `python3 - ${action}`], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', settled = false;
    const timer = setTimeout(() => finish('timeout'), action === 'check' ? 45000 : 360000);
    const abort = () => finish('signed_out');
    function finish(problem?: HyperOpenBotServiceProblem) {
      if (settled) return; settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (problem) { child.kill('SIGTERM'); reject(new HyperOpenBotServiceError(problem)); return; }
      try { resolve(hyperParseBackendReport(output)); } catch { reject(new HyperOpenBotServiceError('operation_failed')); }
    }
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish('ssh_unavailable'));
    child.stdout.on('data', data => { output += data.toString(); if (Buffer.byteLength(output) > 65536) finish('operation_failed'); });
    child.stdin.on('error', () => { /* Exit reports an unavailable remote Python/SSH connection. */ });
    child.on('close', code => finish(code === 0 ? undefined : code === 255 ? 'ssh_unavailable' : 'operation_failed'));
    child.stdin.end(script);
    if (signal.aborted) abort();
  });
}
export function createHyperOpenBotService(userData: string, sessions: HyperOpenBotSession, disconnect: () => void) {
  const directory = path.join(userData, 'hyper-openbot-service'), file = path.join(directory, 'config.json');
  let autoStart = true;
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); autoStart = value.version === 1 && typeof value.autoStart === 'boolean' ? value.autoStart : false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') autoStart = false; }
  const service = new HyperOpenBotService({ supported: process.platform === 'linux', authorize: () => sessions.acquire(), execute: hyperRunBackend, disconnect,
    saveAutoStart: async value => {
      await fsp.mkdir(directory, { recursive: true, mode: 0o700 }); await fsp.chmod(directory, 0o700);
      const temporary = path.join(directory, `config-${randomUUID()}.tmp`);
      try { await fsp.writeFile(temporary, JSON.stringify({ version: 1, autoStart: value }) + '\n', { mode: 0o600, flag: 'wx' }); await fsp.rename(temporary, file); }
      finally { await fsp.rm(temporary, { force: true }); }
    },
  }, autoStart);
  sessions.onInvalidate(() => service.invalidate());
  return service;
}
