import fs from 'node:fs';
import path from 'node:path';
import { validateEndpointUrl } from '@shared/openai-endpoint';
import type { HyperBotsConnections } from '@shared/HyperBots';
import { HyperBotWorkspace, hyperBotWebOrigins, hyperBotWorkspaceTools } from './HyperBotWorkspace';
import { HyperBotVault, hyperBotVaultCipher } from './HyperBotVault';
import { HyperBotFiles } from './HyperBotFiles';
import { hyperBotTranscribe } from './HyperBotSpeech';
import { HyperBotsTools, hyperBotsJiraTool, type HyperBotsJiraAccess } from './HyperBotsConnectors';
import { HyperBotsOpenAIEngine } from './HyperBotsEngine';
import { HYPER_BOTS_HOST_TOKEN_PATTERN } from './HyperBotsHostClient';
import { HyperBotsRuntime } from './HyperBotsRuntime';
import { HyperBotsStore } from './HyperBotsStore';
import { createHyperBotsHost } from './HyperBotsHost';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required.');
  return value;
}

async function main() {
  const token = required('HYPER_BOTS_HOST_TOKEN');
  if (!HYPER_BOTS_HOST_TOKEN_PATTERN.test(token)) throw new Error('Provide a random base64url host token of at least 32 bytes.');
  const key = required('HYPER_BOTS_HOST_OWNER');
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid native account key.');
  const directory = path.resolve(required('HYPER_BOTS_HOST_STATE'));
  const baseUrl = required('HYPER_BOTS_MODEL_URL');
  validateEndpointUrl(baseUrl);
  const defaultModel = required('HYPER_BOTS_MODEL');
  const endpoint = { baseUrl, defaultModel, apiKey: process.env.HYPER_BOTS_MODEL_KEY ?? '' };
  const port = Number(process.env.HYPER_BOTS_HOST_PORT ?? '4320');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid host port.');
  const engine = new HyperBotsOpenAIEngine({ endpoint: async () => endpoint });
  const jiraEndpoint = process.env.HYPER_BOTS_JIRA_URL?.trim();
  let jira: HyperBotsJiraAccess | undefined;
  if (jiraEndpoint) {
    validateEndpointUrl(jiraEndpoint);
    if (!jiraEndpoint.startsWith('https://')) throw new Error('Host Jira requires HTTPS.');
    jira = {
      userId: key, baseUrl: jiraEndpoint.replace(/\/+$/, ''), projectKey: required('HYPER_BOTS_JIRA_PROJECT'),
      username: '', authType: 'personalAccessToken', authorization: 'Bearer ' + required('HYPER_BOTS_JIRA_TOKEN'),
    };
  }
  const jiraTools = jira ? [hyperBotsJiraTool({ access: async () => jira! })] : [];
  const connections: HyperBotsConnections = {
    model: { ready: true, defaultModel, detail: 'Hosted model' },
    outlook: { ready: false, problem: 'Classic Outlook is available through the desktop runtime.' },
    jira: jira ? { ready: true, detail: 'Host Jira project ' + jira.projectKey } : { ready: false, problem: 'Configure Jira on the Hyper-Bot host.' },
  };

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'host.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  let host: ReturnType<typeof createHyperBotsHost> | undefined;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try { await host?.close(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  };
  try {
    fs.writeFileSync(fd, String(process.pid) + '\n');
    const vaultKey = process.env.HYPER_BOTS_VAULT_KEY;
    const vaultCipher = vaultKey ? hyperBotVaultCipher(Buffer.from(vaultKey, 'base64url')) : undefined;
    const workspace = new HyperBotWorkspace(path.join(directory, 'workspace'));
    const workspaceTools = hyperBotWorkspaceTools(workspace, hyperBotWebOrigins(process.env.HYPER_BOTS_WEB_ORIGINS));
    const runtime = new HyperBotsRuntime({
      workspace,
      store: new HyperBotsStore(path.join(directory, 'state.json')),
      vault: vaultCipher && new HyperBotVault(path.join(directory, 'vault.enc'), () => vaultCipher),
      files: new HyperBotFiles(path.join(directory, 'attachments')),
      engine, defaultModel: async () => defaultModel, tools: new HyperBotsTools([...jiraTools, ...workspaceTools]),
      transcribe: (audio, signal) => hyperBotTranscribe(audio, endpoint, fetch, signal),
    });
    host = createHyperBotsHost({ runtime, user: { key, userId: key } }, token, {
      connections: async () => connections,
      models: async () => [defaultModel],
    });
    await new Promise<void>((resolve, reject) => {
      host!.server.once('error', reject);
      host!.server.listen(port, '127.0.0.1', resolve);
    });
    runtime.start();
    process.once('SIGINT', () => void close());
    process.once('SIGTERM', () => void close());
    console.log('Hyper-Bot host listening on 127.0.0.1:' + port);
  } catch (error) {
    await close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error('Hyper-Bot host could not start:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
