import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { hyperDecodeDevelopmentJwt } from '../../../deploy/self-hosted/HyperDevJwtExchange.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag, fallback) => { const index = args.indexOf(flag); if (index < 0) return fallback; if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing value for ' + flag); return args[index + 1]; };
const shellQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";

async function main() {
  if (args.includes('--help')) { console.log('npm run dev:jwt -- [--jwt-file path] [--enable-server] [--no-launch] [--no-watch] [--host user@host] [--remote-dir path]'); return; }
  const host = value('--host', process.env.HYPER_DEV_JWT_SSH_HOST || 'agent@MMEMS-mems01');
  const remoteDir = value('--remote-dir', process.env.HYPER_DEV_JWT_REMOTE_DIR || '~/appflowy-self-host');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/.test(host)) throw new Error('Use an SSH host or user@host without options.');
  const source = await fs.readFile(path.resolve(root, '../../deploy/self-hosted/HyperDevJwtExchange.mjs'), 'utf8');
  const remoteCode = 'const helper = await import("data:text/javascript;base64,' + Buffer.from(source).toString('base64') + '"); await helper.hyperDevJwtRemoteMain();';
  const remote = (action, input = {}) => {
    const command = ['node', '--input-type=module', '-e', remoteCode, '--', remoteDir, action].map(shellQuote).join(' ');
    try {
      return JSON.parse(execFileSync('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 65000, maxBuffer: 131072, stdio: ['pipe', 'pipe', 'pipe'] }));
    } catch (error) {
      const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
      throw new Error(stderr.startsWith('Development') || stderr.startsWith('This development') ? stderr : 'Development SSH authentication helper failed. Check the SSH host and deployment directory.');
    }
  };
  if (args.includes('--enable-server')) remote('enable');
  const file = value('--jwt-file', '');
  const token = file ? (await fs.readFile(path.resolve(file), 'utf8')).trim()
    : Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: 'hyper-development-user', email: 'dev-jwt@hypertask.test', name: 'Development JWT user' })).toString('base64url') + '.';
  hyperDecodeDevelopmentJwt(token);
  const session = await remote('exchange', { jwt: token });
  if (!session.access_token || !session.refresh_token || typeof session.server_origin !== 'string') throw new Error('Development authentication returned no usable session.');
  const directory = path.resolve(process.env.HYPER_DEV_JWT_PROFILE_DIR || path.join(root, '.cache/hyper-dev-jwt'));
  const support = path.join(directory, 'support');
  await fs.mkdir(support, { recursive: true, mode: 0o700 });
  const sessionFile = path.join(directory, 'session-' + randomUUID() + '.json');
  await fs.writeFile(sessionFile, JSON.stringify({ ...session, development: true }), { mode: 0o600, flag: 'wx' });
  const prefsFile = path.join(support, 'shared_preferences.json');
  let prefs = {};
  try { prefs = JSON.parse(await fs.readFile(prefsFile, 'utf8')); } catch { /* First isolated development launch. */ }
  prefs['flutter.kCloudType'] = '3';
  prefs['flutter.kHypertaskCloudBaseURL'] = session.server_origin;
  prefs['flutter.kHypertaskBaseShareDomain'] = session.server_origin;
  await fs.writeFile(prefsFile, JSON.stringify(prefs), { mode: 0o600 });
  console.log('DEV JWT MODE: token signature, issuer, audience and expiry are not verified.');
  console.log('Server: ' + session.server_origin + '; isolated desktop profile: ' + directory);
  if (args.includes('--no-launch')) { console.log(JSON.stringify({ success: true, session_file: sessionFile })); return; }
  const electronArgs = process.env.ELECTRON_CLI_ARGS ? JSON.parse(process.env.ELECTRON_CLI_ARGS) : [];
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev', ...(args.includes('--no-watch') ? [] : ['--watch']), '--', ...electronArgs.filter(arg => !arg.startsWith('--user-data-dir=')), '--user-data-dir=' + path.join(directory, 'electron')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, HYPER_DEV_JWT_ENABLED: '1', HYPER_DEV_JWT_SESSION_FILE: sessionFile, HYPERTASK_SUPPORT_DIR: support, HYPER_DEV_JWT_VITE_CACHE: path.join(directory, 'vite-cache') },
  });
  const cleanup = () => fs.unlink(sessionFile).catch(() => {});
  child.once('error', async () => { await cleanup(); console.error('Could not launch the development app.'); process.exitCode = 1; });
  child.once('exit', async (code, signal) => { await cleanup(); process.exitCode = code ?? (signal ? 1 : 0); });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
