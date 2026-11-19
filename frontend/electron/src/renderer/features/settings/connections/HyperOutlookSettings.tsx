import { useEffect, useState } from 'react';
import type { HyperOutlookPresenceState, HyperOutlookStatus } from '@shared/api';
import { Button } from '@/components/ui/button';
import { SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { hyperOutlookClient } from '@/features/hyper-outlook/hyper-outlook-client';

export function useHyperOutlookConnection() {
  const [presence, setPresence] = useState<HyperOutlookPresenceState>();
  const [status, setStatus] = useState<HyperOutlookStatus>();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const api = window.hypertask?.outlook;
    if (!api) {
      setChecking(false);
      setError('The Outlook desktop connection is unavailable in this session.');
      return;
    }
    let request = 0;
    let active = true;
    let receivedPresence = false;
    async function check() {
      const current = ++request;
      setChecking(true);
      setError('');
      try {
        const next = await hyperOutlookClient.status();
        if (current === request) setStatus(next);
      } catch (failure) {
        if (current === request) {
          setStatus(undefined);
          setError(failure instanceof Error ? failure.message : 'Could not check Outlook.');
        }
      } finally {
        if (current === request) setChecking(false);
      }
    }
    const unsubscribe = api.onPresence(next => {
      receivedPresence = true;
      setPresence(next);
      if (next.running) void check();
      else {
        request++;
        setStatus(undefined);
        setError('');
        setChecking(false);
      }
    });
    void api.presence().then(result => {
      if (active && !receivedPresence && result.ok) setPresence(result.value);
    }).catch(() => {});
    void check();
    return () => { active = false; request++; unsubscribe(); };
  }, [revision]);

  const label = checking ? 'Checking connection…' : status?.available ? 'Connected'
    : presence?.installed && !presence.running ? 'Outlook is closed' : 'Unavailable';
  return { label, status, presence, checking, error, refresh: () => setRevision(value => value + 1) };
}

export function HyperOutlookSettings() {
  const { label, status, presence, checking, error, refresh } = useHyperOutlookConnection();
  const [opening, setOpening] = useState(false);
  const [launchError, setLaunchError] = useState('');

  async function openOutlook() {
    setOpening(true);
    setLaunchError('');
    try {
      const result = await window.hypertask.outlook.launch();
      if (!result.ok) throw new Error(result.message);
      refresh();
    } catch (failure) {
      setLaunchError(failure instanceof Error ? failure.message : 'Could not open Outlook.');
    } finally {
      setOpening(false);
    }
  }

  return <>
    <SettingsPageHeader title="Microsoft Outlook" description="HyperTask uses the active profile in classic Outlook for Windows for calendar and mail." />
    <SettingsSection><SettingsGroup>
      <SettingsRow label="Desktop connection" description={<span role="status" className="break-words">{label}{status?.available && (status.email || status.userName) ? ` · ${status.email || status.userName}` : ''}</span>}>
        {!status?.available && !checking && <p className="text-sm text-muted-foreground">{status?.reason || 'Open classic Outlook and sign in to the profile you want HyperTask to use.'}</p>}
        <div className="flex flex-wrap gap-2">
          {!status?.available && presence?.installed && <Button size="sm" disabled={opening} onClick={() => void openOutlook()}>{opening ? 'Opening Outlook…' : 'Open Outlook'}</Button>}
          <Button size="sm" variant="outline" disabled={checking || opening} onClick={() => { setLaunchError(''); refresh(); }}>Check connection</Button>
        </div>
        {(error || launchError) && <p role="alert" className="break-words text-sm text-destructive">{launchError || error}</p>}
      </SettingsRow>
    </SettingsGroup></SettingsSection>
  </>;
}
