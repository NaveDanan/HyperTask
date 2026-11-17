// Ported from bot-hq (web/src/components/DetailsPanel.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import { HYPER_BOTS_TOOLS, HYPER_BOTS_TOOL_GROUPS, HYPER_BOTS_READ_POLICIES, type HyperBotConfig, type HyperBotsSettings, type HyperBotsToolGroup, type HyperBotsToolName } from '@shared/HyperBots';
import { cn } from '@/lib/utils';
import { HyperBotToolLogo } from './HyperBotBrandLogos';
import { HYPER_BOT_TOOL_ORDER, hyperBotUpdate } from './HyperBotSettings';
export function HyperBotToggle({ on, onChange, label, disabled }: { on: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cn('toggle', on && 'is-on')} onClick={() => onChange(!on)}><span className="toggle__knob" /></button>;
}
export function HyperBotToolsForm({ settings, bot, disabled, onChange }: { settings: HyperBotsSettings; bot: HyperBotConfig; disabled?: boolean; onChange: (settings: HyperBotsSettings) => void }) {
  const toggle = (name: HyperBotsToolName, on: boolean) => onChange(hyperBotUpdate(settings, { ...bot, tools: HYPER_BOT_TOOL_ORDER.filter(tool => tool === name ? on : bot.tools.includes(tool)) }));
  return <div className="details__sections tools"><p className="tools__intro">Tools @{bot.id} can use</p>{(Object.keys(HYPER_BOTS_TOOL_GROUPS) as HyperBotsToolGroup[]).map(group => <section key={group} role="group" aria-label={HYPER_BOTS_TOOL_GROUPS[group] + ' tools of @' + bot.id}><h3 className="section-label">{HYPER_BOTS_TOOL_GROUPS[group]}</h3><div className="panel-card">{HYPER_BOT_TOOL_ORDER.filter(name => HYPER_BOTS_TOOLS[name].group === group).map(name => {
    const tool = HYPER_BOTS_TOOLS[name]; return <div key={name} className="panel-row tool-row"><span className="panel-row__text"><span className="tool-label hb-tool-name"><HyperBotToolLogo tool={name} />{tool.label}</span></span><span className={cn('tool-tag', tool.access === 'write' && 'is-write')}>{tool.access === 'read' ? 'Read' : 'Write'}</span><HyperBotToggle label={tool.label} on={bot.tools.includes(name)} onChange={on => toggle(name, on)} disabled={disabled} /></div>;
  })}</div></section>)}
  <section><h3 className="section-label">Read policies</h3><p className="tools__intro">Applies to all bots</p><div className="panel-card">{HYPER_BOTS_READ_POLICIES.map(group => <fieldset key={group.label} className="policy-group"><legend>{group.label}</legend>{(['ask', 'allow'] as const).map(value => <label key={value}><input type="radio" disabled={disabled} name={'hyper-bot-policy-' + group.tools[0]} checked={(group.tools.every(tool => settings.policy[tool] === 'allow') ? 'allow' : 'ask') === value} onChange={() => onChange({ ...settings, policy: { ...settings.policy, ...Object.fromEntries(group.tools.map(tool => [tool, value])) } })} />{value === 'ask' ? 'Ask me every time' : group.allow}</label>)}</fieldset>)}</div><p className="members__hint">Writes always ask you first: sending, replying, forwarding, answering invitations, creating or editing events, and creating Jira issues.</p></section></div>;
}
export function HyperBotTools({ settings, bot, saving, error, onSave }: { settings: HyperBotsSettings; bot: HyperBotConfig; saving: boolean; error?: string; onSave: (settings: HyperBotsSettings) => Promise<boolean> }) {
  const [optimistic, setOptimistic] = useState<HyperBotsSettings | null>(null);
  const current = optimistic ?? settings;
  return <><HyperBotToolsForm settings={current} bot={current.bots.find(row => row.id === bot.id) ?? bot} disabled={saving || !!optimistic} onChange={next => {
    setOptimistic(next); void onSave(next).finally(() => setOptimistic(null));
  }} />{error && <p role="alert" className="card__error">{error}</p>}</>;
}
