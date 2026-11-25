import { useEffect, useState, type FormEvent } from 'react';
import type { HyperNewsletterConnectionState } from '@shared/HyperBots';
import { SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HyperNewsletterSettings() {
  const [connection, setConnection] = useState<HyperNewsletterConnectionState | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.hypertask.hyperBots.newsletterConnection().then(result => {
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConnection(result.value);
      setBaseUrl(result.value?.baseUrl ?? '');
    }).catch(() => { if (active) setError('Could not open the Newsletter connection.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const changeConnection = async (input: { baseUrl: string; token: string } | null) => {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.hypertask.hyperBots.saveNewsletterConnection(input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConnection(result.value);
      setBaseUrl(result.value?.baseUrl ?? '');
      setToken('');
    } catch {
      setError('Could not save the Newsletter connection.');
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void changeConnection({ baseUrl: baseUrl.trim(), token: token.trim() });
  };
  const status = loading ? 'Checking connection…' : connection
    ? `${connection.baseUrl} · ${connection.gantt ? 'Newsletters and Gantt projects' : 'Newsletters'}`
    : 'Disconnected';

  return <>
    <SettingsPageHeader title="Newsletter" description="Connect Hyper Bot to your Newsletter site." />
    <SettingsSection><SettingsGroup>
      <SettingsRow label="Connection" description={<span role="status" className="break-words">{status}</span>}>
        {connection && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void changeConnection(null)}>Disconnect</Button>}
      </SettingsRow>
      <form className="space-y-4 p-4" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="hyper-newsletter-url">Newsletter site URL</Label>
          <Input id="hyper-newsletter-url" dir="ltr" type="url" value={baseUrl} placeholder="https://newsletter.example.com"
            maxLength={2048} onChange={event => setBaseUrl(event.target.value)} required disabled={loading || busy} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hyper-newsletter-token">API access token</Label>
          <Input id="hyper-newsletter-token" dir="ltr" type="password" value={token} autoComplete="off" maxLength={128}
            onChange={event => setToken(event.target.value)} aria-describedby="hyper-newsletter-token-help" required disabled={loading || busy} />
          <p id="hyper-newsletter-token-help" className="text-xs text-muted-foreground">In Newsletter, open Profile → API access tokens and choose Newsletter &amp; Gantt authoring. Select Read and write to let the bot create and edit records.</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={loading || busy || !baseUrl.trim() || !token.trim()}>
          {busy ? 'Working…' : connection ? 'Update connection' : 'Connect Newsletter'}
        </Button>
      </form>
    </SettingsGroup></SettingsSection>
  </>;
}
