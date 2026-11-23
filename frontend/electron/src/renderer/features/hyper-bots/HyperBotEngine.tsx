// Ported from bot-hq (web/src/components/EngineSettings.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useEffect, useState } from 'react';
import type { HyperBotConfig, HyperBotsConnections, HyperBotsSettings } from '@shared/HyperBots';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hyperBotUpdate } from './HyperBotSettings';
import { HyperBotMiniSelect } from './HyperBotMiniSelect';
export function HyperBotModelSelect({ id, model, models, defaultModel, onChange }: { id: string; model: string; models: string[]; defaultModel?: string; onChange: (model: string) => void }) {
  const options = model && !models.includes(model) ? [model, ...models] : models;
  return <HyperBotMiniSelect label={'Model of @' + id} className="engine__model" value={model} onChange={onChange}
    options={[{ value: '', label: defaultModel ? 'Endpoint default (' + defaultModel + ')' : 'Endpoint default' }, ...options.map(option => ({ value: option, label: option }))]} />;
}
export function HyperBotEngine({ bot, settings, connection, models, saving, error, onSave }: { bot: HyperBotConfig; settings: HyperBotsSettings; connection: HyperBotsConnections['model']; models: string[]; saving: boolean; error?: string; onSave: (settings: HyperBotsSettings) => Promise<boolean> }) {
  const [model, setModel] = useState(bot.model);
  useEffect(() => setModel(bot.model), [bot.model]);
  const changed = model !== bot.model;
  return <div className="panel-card engine"><div className="panel-row panel-row--setting engine__provider"><span>Provider</span><span title={connection.ready ? connection.detail : connection.problem}>HyperTask AI endpoint</span></div><p className="engine__detail">{connection.ready ? connection.detail : connection.problem}</p>
    <label className="panel-row panel-row--setting"><span>Model</span><HyperBotModelSelect id={bot.id} model={model} models={models} defaultModel={connection.defaultModel} onChange={setModel} /></label>
    <div className="engine__actions"><Button size="sm" disabled={!changed || saving} onClick={() => void onSave(hyperBotUpdate(settings, { ...bot, model }))}>{saving ? 'Saving…' : 'Save'}</Button><Button size="sm" variant="ghost" disabled={!changed || saving} onClick={() => setModel(bot.model)}>Undo</Button></div>
    <div className="engine__meta"><span className={cn('engine__state', connection.ready ? 'is-ready' : connection.checking ? 'is-starting' : 'is-error')}><i aria-hidden="true" />{connection.ready ? 'Ready' : connection.checking ? 'Checking' : 'Needs setup'}</span></div>{error && <p role="alert" className="engine__error">{error}</p>}
  </div>;
}
