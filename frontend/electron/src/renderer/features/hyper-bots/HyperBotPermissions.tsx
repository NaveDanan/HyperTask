import { useEffect, useId, useState } from 'react';
import { LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react';
import { HYPER_BOTS_PERMISSION_LEVELS, type HyperBotsPermissionLevel, type HyperBotsPermissions } from '@shared/HyperBots';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const levels = {
  supervised: { label: 'Supervised', icon: LockKeyhole, detail: 'Ask once per turn before using tools.' },
  elevated: { label: 'Elevated', icon: ShieldCheck, detail: 'Read Outlook email and events automatically. Ask once for other actions.' },
  full: { label: 'Full access', icon: ShieldOff, detail: 'Run enabled tools without asking, including deleting email and canceling meetings.' },
};

export function HyperBotPermissions({ compact = false, disabled = false, botId, selection }: {
  compact?: boolean; disabled?: boolean; botId?: string;
  selection?: { permissions: HyperBotsPermissions; onChange: (level: HyperBotsPermissionLevel) => void };
}) {
  const name = useId();
  const [loaded, setPermissions] = useState<HyperBotsPermissions>();
  const permissions = selection?.permissions ?? loaded;
  const controlled = !!selection;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const api = window.hypertask?.hyperBots;
    if (controlled || !api?.permissions) return;
    let request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        const reply = await api.permissions(botId ? { botId } : undefined);
        if (request === id && reply.ok) setPermissions(reply.value);
      } catch { /* An unavailable bot session leaves the control disabled. */ }
    };
    void refresh();
    const off = api.onEvent?.(event => { if (event.type === 'settings') void refresh(); });
    return () => { ++request; off?.(); };
  }, [botId, controlled]);
  const pick = async (level: HyperBotsPermissionLevel) => {
    if (selection) { selection.onChange(level); return; }
    setSaving(true);
    setError('');
    try {
      const reply = await window.hypertask.hyperBots.permissions(botId ? { botId, level } : level);
      if (reply.ok) setPermissions(reply.value);
      else setError(reply.message);
    } catch { setError('Could not save permissions.'); }
    finally { setSaving(false); }
  };
  const selected = permissions?.level ?? 'supervised';
  const current = levels[selected];
  const Icon = current.icon;
  const controls = <fieldset disabled={disabled || saving || !permissions} className="grid min-w-0 gap-2">
    <legend className="mb-2 text-xs font-medium text-foreground">Permissions</legend>
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
      {HYPER_BOTS_PERMISSION_LEVELS.map(level => {
        const entry = levels[level];
        return <label key={level} title={entry.label} className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-center text-[10px] font-medium text-muted-foreground has-checked:bg-background has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring">
          <input name={name} className="sr-only" type="radio" checked={selected === level && !permissions?.legacyReadOverrides} onChange={() => void pick(level)} />
          <entry.icon aria-hidden="true" size={15} />{entry.label}
        </label>;
      })}
    </div>
    <p className="text-xs text-muted-foreground">{permissions?.legacyReadOverrides ? 'Previous read permissions apply until you select a level.' : current.detail}</p>
    {!selection && <p className="text-[10px] text-muted-foreground">{botId ? 'Applies to this bot in chat and voice.' : 'Default for bots without their own permission level.'}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </fieldset>;
  if (!compact) return <div className="rounded-lg border border-border bg-card p-3">{controls}</div>;
  const label = permissions?.legacyReadOverrides ? 'Permissions' : current.label;
  return <Popover>
    <PopoverTrigger type="button" className="ms-auto inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-accent" title="Permissions" aria-label={`Hyper-Bot permissions: ${label}`}>
      <Icon size={13} aria-hidden="true" />{label}
    </PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={6} className="w-64 max-w-[calc(100vw-1rem)]" aria-label="Hyper-Bot permissions">
      {controls}
    </PopoverContent>
  </Popover>;
}
