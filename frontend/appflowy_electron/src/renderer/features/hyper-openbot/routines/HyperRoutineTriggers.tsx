// Adapted from app/src/components/responsibilities/triggers.tsx in OpenBot.
// Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import type { TriggerKind, TriggerRecord } from './HyperRoutineTypes';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperRoutineSharedApps } from './HyperRoutineSharedApps';
import { HyperAction, HyperRead, HyperSelect } from './HyperRoutineControls';
import { HyperRoutineWrite as write } from './HyperRoutinesApi';
import { hyperOpenBotRequest as request } from '../transport';
import { hyperRoutineTriggerConfig, hyperRoutineTriggerEndpoint } from './HyperRoutineFlows';

const HyperRoutineWrite: typeof write = async (...args) => {
  try { return await write(...args); }
  catch { throw new Error('The trigger change failed or was refused. Refresh before retrying.'); }
};
const vendors = ['linear', 'sentry', 'pagerduty'];

export function HyperTriggers({ id, agentId, completed = false }: { id: string; agentId: string; completed?: boolean }) {
  const [publicOrigin, setPublicOrigin] = useState('');
  const [revision, setRevision] = useState(0);
  const [kind, setKind] = useState<TriggerKind>('webhook');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState('');
  const [adding, setAdding] = useState(false);
  const refresh = () => setRevision(value => value + 1);
  const field = (key: string, label: string) => <label className="grid gap-1 text-sm">{label}<Input value={fields[key] || ''} onChange={event => { const value = event.target.value; setFields(current => ({ ...current, [key]: value })); }} /></label>;
  return <div className="space-y-3">
    <h2 className="font-semibold">Event triggers</h2>
    <label className="grid max-w-xl gap-1 text-sm">Public OpenBot URL for webhook registration<Input type="url" placeholder="https://openbot.example.com" value={publicOrigin} onChange={event => setPublicOrigin(event.target.value)} /></label>
    <HyperRead<TriggerRecord[]> key={revision} path={`/api/responsibilities/${encodeURIComponent(id)}/triggers`} field="triggers">{triggers => <>{!triggers.length && <p>No triggers.</p>}{triggers.map(trigger => <HyperTriggerRow key={trigger.id} trigger={trigger} refresh={refresh} completed={completed} publicOrigin={publicOrigin} />)}</>}</HyperRead>
    <p className="text-sm text-muted-foreground">Generated or revealed keys are delivered in a native HyperTask dialog, never in this page. Copy the key or Authorization header there.</p>
    <Button variant="outline" onClick={() => { setAdding(!adding); setSecret(''); }}>{adding ? 'Cancel' : 'Add trigger'}</Button>
    {adding && <div className="grid max-w-xl gap-3">
      <HyperSelect label="Trigger" value={kind} options={['webhook', 'github', ...vendors, 'email', 'slack'].map(value => [value, value])} onChange={value => { setKind(value as TriggerKind); setSecret(''); }} />
      {kind === 'slack' ? <>{field('teamId', 'Slack workspace ID')}<HyperSelect label="Starts on" value={fields.mode || 'mention'} options={['mention', 'phrase', 'reaction', 'message'].map(value => [value, value])} onChange={mode => setFields(current => ({ ...current, mode }))} />{field('phrases', 'Phrases, separated by commas')}{field('reactions', 'Reactions, separated by commas')}{field('channels', 'Channel IDs, separated by commas')}</> : <>{field('eventTypes', 'Event types, separated by commas. Blank means any')}{field('fieldPath', 'JSON field path, optional')}{field('fieldEquals', 'Field equals, optional')}{kind === 'github' && field('repository', 'Repository, owner/repo, optional')}{kind === 'email' && field('senders', 'Allowed authenticated senders, separated by commas')}</>}
      {vendors.includes(kind) && <label className="grid gap-1">Provider signing secret<Input type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} /></label>}
      <HyperRoutineSharedApps agentId={agentId} />
      <HyperAction label="Create trigger" run={async () => {
        const submitted = secret; setSecret('');
        await HyperRoutineWrite('responsibilities', id, 'triggers', 'POST', { config: hyperRoutineTriggerConfig(kind, fields), ...(vendors.includes(kind) && submitted ? { secret: submitted } : {}) });
        setAdding(false);
      }} done={refresh} />
    </div>}
  </div>;
}

export function HyperTriggerRow({ trigger, refresh, completed, publicOrigin }: { trigger: TriggerRecord; refresh(): void; completed: boolean; publicOrigin: string }) {
  const [secret, setSecret] = useState('');
  return <article className="space-y-2 rounded border border-border p-3">
    <h3>{trigger.kind}</h3>{completed && <p>This goal is completed. Its triggers will not start it.</p>}
    <p>{trigger.path || trigger.address}</p>
    {(trigger.path || trigger.address) && <HyperAction label={trigger.path && publicOrigin ? 'Copy webhook URL' : 'Copy endpoint path or address'} run={() => navigator.clipboard.writeText(trigger.path && publicOrigin ? hyperRoutineTriggerEndpoint(publicOrigin, trigger.path) : trigger.path || trigger.address || '')} done={() => {}} />}
    <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(trigger.config, null, 2)}</pre>
    {trigger.kind === 'email' && trigger.emailConfigured === false && <p role="alert">Inbound email is not configured on this deployment.</p>}
    <HyperAction label={trigger.enabled ? 'Pause' : 'Resume'} run={() => HyperRoutineWrite('responsibilities/triggers', trigger.id, 'enabled', 'PUT', { enabled: !trigger.enabled })} done={refresh} />
    <HyperAction label="Remove trigger" confirm="Remove this trigger permanently?" run={() => HyperRoutineWrite('responsibilities/triggers', trigger.id, '', 'DELETE')} done={refresh} />
    {(trigger.kind === 'webhook' || trigger.kind === 'github') && <HyperAction label="Reveal key" run={() => request(`/api/responsibilities/triggers/${encodeURIComponent(trigger.id)}/secret`)} done={() => {}} />}
    {vendors.includes(trigger.kind) && <label className="grid gap-1">New provider signing secret<Input type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} /></label>}
    {trigger.kind !== 'email' && trigger.kind !== 'slack' && <HyperAction label={vendors.includes(trigger.kind) ? 'Save signing secret' : 'Rotate key'} run={async () => {
      if (vendors.includes(trigger.kind) && !secret) throw new Error('Paste the provider signing secret.');
      const submitted = secret; setSecret('');
      await HyperRoutineWrite('responsibilities/triggers', trigger.id, 'secret', 'POST', submitted ? { secret: submitted } : {});
    }} done={refresh} />}
  </article>;
}
