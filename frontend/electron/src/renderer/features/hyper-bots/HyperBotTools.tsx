// Ported from bot-hq (web/src/components/DetailsPanel.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import { HYPER_BOTS_TOOLS, HYPER_BOTS_TOOL_GROUPS, hyperBotsPermissions, hyperBotsToolPolicy, hyperBotSetPermissionLevel, type HyperBotConfig, type HyperBotsSettings, type HyperBotsToolGroup, type HyperBotsToolName } from '@shared/HyperBots';
import { cn } from '@/lib/utils';
import { HyperBotToolLogo } from './HyperBotBrandLogos';
import { HYPER_BOT_TOOL_ORDER, hyperBotUpdate } from './HyperBotSettings';
import { HyperBotPermissions } from './HyperBotPermissions';
export function HyperBotToggle({ on, onChange, label, disabled }: { on: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cn('toggle', on && 'is-on')} onClick={() => onChange(!on)}><span className="toggle__knob" /></button>;
}
export function HyperBotToolsForm({ settings, bot, disabled, onChange }: { settings: HyperBotsSettings; bot: HyperBotConfig; disabled?: boolean; onChange: (settings: HyperBotsSettings) => void }) {
  const update = (next: HyperBotConfig) => onChange(hyperBotUpdate(settings, next));
  const toggle = (name: HyperBotsToolName, ask: boolean) => update({ ...bot, toolPolicies: { ...bot.toolPolicies, [name]: ask ? 'ask' : 'allow' } });
  return <div className="details__sections tools">
    <HyperBotPermissions disabled={disabled} selection={{ permissions: hyperBotsPermissions(settings, bot), onChange: level => update(hyperBotSetPermissionLevel(bot, level)) }} />
    <p className="tools__intro">{bot.tools.length ? 'Turn on a switch to ask for approval before using that tool.' : 'Enable a connection in Bot settings to add tools.'}</p>
    {(Object.keys(HYPER_BOTS_TOOL_GROUPS) as HyperBotsToolGroup[]).map(group => {
      const names = HYPER_BOT_TOOL_ORDER.filter(name => HYPER_BOTS_TOOLS[name].group === group && bot.tools.includes(name));
      if (!names.length) return null;
      return <section key={group} role="group" aria-label={HYPER_BOTS_TOOL_GROUPS[group] + ' tools of @' + bot.id}>
        <h3 className="section-label">{HYPER_BOTS_TOOL_GROUPS[group]}</h3>
        <div className="panel-card">{names.map(name => {
          const tool = HYPER_BOTS_TOOLS[name];
          return <div key={name} className="panel-row tool-row">
            <span className="panel-row__text"><span className="tool-label hb-tool-name"><HyperBotToolLogo tool={name} />{tool.label}</span></span>
            <span className={cn('tool-tag', tool.access === 'write' && 'is-write')}>{tool.access === 'read' ? 'Read' : 'Write'}</span>
            <HyperBotToggle label={'Ask before: ' + tool.label} on={hyperBotsToolPolicy(settings, bot, name) === 'ask'} onChange={ask => toggle(name, ask)} disabled={disabled} />
          </div>;
        })}</div>
      </section>;
    })}
  </div>;
}
export function HyperBotTools({ settings, bot, saving, error, onSave }: { settings: HyperBotsSettings; bot: HyperBotConfig; saving: boolean; error?: string; onSave: (settings: HyperBotsSettings) => Promise<boolean> }) {
  const [optimistic, setOptimistic] = useState<HyperBotsSettings | null>(null);
  const current = optimistic ?? settings;
  return <><HyperBotToolsForm settings={current} bot={current.bots.find(row => row.id === bot.id) ?? bot} disabled={saving || !!optimistic} onChange={next => {
    setOptimistic(next); void onSave(next).finally(() => setOptimistic(null));
  }} />{error && <p role="alert" className="card__error">{error}</p>}</>;
}
