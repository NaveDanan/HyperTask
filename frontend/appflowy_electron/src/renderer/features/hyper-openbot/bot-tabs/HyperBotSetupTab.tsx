import { useState } from 'react';
import type { HyperCallbackKeyAction } from '@shared/api';
import { hyperCallbackKey } from '../HyperNativeCredentials';
// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { HyperBotHandoffTab } from './HyperBotHandoffTab';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { HyperAgentPath, type HyperBotProfile } from '../bots/HyperBotsApi';
import { useHyperBotResource } from './HyperBotResource';
export function HyperBotSetupTab({ agentId }: { agentId: string }) {
  const state = useHyperBotResource(async () => {
    const [result, deployment] = await Promise.all([
      request<{ agent: HyperBotProfile }>(HyperAgentPath(agentId)),
      request<{ edition: string }>('/api/capabilities'),
    ]);
    if (deployment.edition === 'personal') return { bot: result.agent, personal: true, available: false, allowed: false };
    const [capabilities, mine] = await Promise.all([request<{ capabilities: { isolationAvailable: boolean } }>('/api/agents/capabilities'), request<{ capabilities: { isolatedComputers?: boolean } }>('/api/admin/enterprise/me')]);
    return { bot: result.agent, personal: false, available: capabilities.capabilities.isolationAvailable, allowed: mine.capabilities.isolatedComputers !== false };
  }, agentId);
  const [keyStatus, setKeyStatus] = useState('');
  const keyAction = (action: HyperCallbackKeyAction) => state.run(async () => {
    setKeyStatus('Waiting for native confirmation…');
    try {
      const result = await hyperCallbackKey(agentId, action);
      setKeyStatus(result.status === 'issued' ? 'Key issued and shown in the native dialog.' : result.status === 'revoked' ? 'Callback key revoked.' : 'Callback key action cancelled.');
    } catch { setKeyStatus('Callback key action failed. Check refreshed status before retrying.'); throw new Error('Callback key action failed'); }
  });
  const bot = state.data?.bot;
  return <section className="grid gap-3"><h3>Setup</h3>{state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}<Button variant="outline" disabled={state.pending} onClick={state.refresh}>Refresh</Button>
    {bot && <><p>{bot.builtIn ? 'Built in' : bot.endpoint ? `Runs at ${bot.endpoint}` : 'Built in'}</p><p className="text-sm text-muted-foreground">Profile and instructions can be edited above. External endpoint settings are on External agents.</p>
      {!state.data?.personal && <><label className="flex gap-2"><input type="checkbox" checked={Boolean(bot.isolated)} disabled={state.pending || !bot.canManage || bot.systemOwned || (!bot.isolated && !(state.data?.available && state.data.allowed))} onChange={e => { const isolated = e.target.checked; void state.run(async isCurrent => { const { agent: fresh } = await request<{ agent: HyperBotProfile }>(HyperAgentPath(agentId)); if (!isCurrent() || fresh.id !== agentId || !fresh.canManage || fresh.systemOwned) return; await request(HyperAgentPath(agentId), 'PATCH', { name: fresh.name, title: fresh.title, roleDescription: fresh.roleDescription, visibility: fresh.visibility, endpoint: fresh.builtIn ? '' : fresh.endpoint ?? '', isolated }); }); }} />Computer of its own</label>
      <p>{bot.systemOwned ? 'This included Bot runs on the computer of whoever is using it.' : bot.isolated ? bot.isolationActive ? 'Isolation is active.' : `Isolation is requested but unavailable: ${bot.isolationOffReason ?? 'waiting for deployment'}.` : !state.data?.available ? 'This deployment cannot create isolated computers.' : !state.data.allowed ? 'An administrator has disabled isolated computers for you.' : 'Runs on a shared computer.'}</p><HyperBotHandoffTab agentId={agentId} /></>}
    {bot.canManage && !bot.builtIn && bot.endpoint && <section className="grid gap-2"><h4>Key for tools</h4>{keyStatus && <p role="status">{keyStatus}</p>}{bot.keyFromOpenBot ? <p>OpenBot runs this Bot, so it can use its tools without a key.</p> : <><p>{bot.hasCallbackToken ? 'This Bot has a callback key.' : 'This Bot has no callback key.'} The key is shown only in a native dialog.</p><Button disabled={state.pending} onClick={() => void keyAction(bot.hasCallbackToken ? 'rotate' : 'create')}>{bot.hasCallbackToken ? 'Rotate callback key' : 'Create callback key'}</Button>{bot.hasCallbackToken && <Button variant="outline" disabled={state.pending} onClick={() => void keyAction('revoke')}>Revoke callback key</Button>}</>}</section>}
    </>}
  </section>;
}
