import { useEffect, useState } from 'react';
import type { HyperStartupState } from '@shared/api';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/reui/alert';

export function HyperStartupSettings() {
  const [state, setState] = useState<HyperStartupState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.appflowy.app.getStartup().then(
      (value) => { if (active) setState(value); },
      () => { if (active) setError('Could not read startup settings. Reopen Settings to try again.'); },
    );
    return () => { active = false; };
  }, []);

  const change = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      setState(await window.appflowy.app.setStartup(enabled));
    } catch {
      setError('Could not change startup. Check your system login-item settings and try again.');
    } finally {
      setSaving(false);
    }
  };

  return <SettingsSection title="Desktop" description="Closing the window keeps HyperTask running in the tray. To exit, choose Quit HyperTask from the tray menu.">
    <SettingsGroup>
      <SettingsRow label="Start HyperTask when I sign in"
        description={state?.reason ?? 'Start in the background when you sign in to your computer.'}
        control={<Switch aria-label="Start HyperTask when I sign in" checked={state?.enabled ?? false}
          disabled={!state?.available || saving} onCheckedChange={(enabled) => { void change(enabled); }} />} />
    </SettingsGroup>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </SettingsSection>;
}
