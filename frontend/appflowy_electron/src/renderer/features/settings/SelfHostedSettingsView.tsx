import { useEffect, useState, type ReactNode } from 'react';
import { HardDrive, Server } from 'lucide-react';
import {
  getAppFlowyCloudUrl,
  getAppFlowyShareDomain,
  getAuthenticatorType,
  isLocalType,
  useBaseWebDomain,
  useLocalServer,
  useSelfHostedServer,
} from '@/startup/cloud-env';
import { validateServerUrl } from '@shared/self-hosted-policy';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { cn } from '@/lib/utils';

/** One storage choice, shown as a selectable card so both options are visible at once. */
function StorageOption({ selected, disabled, icon, title, description, onSelect }: { selected: boolean; disabled: boolean; icon: ReactNode; title: string; description: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-background p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/**
 * SelfHostedSettingsView (features/self_hosting/self_hosted_settings_view.dart): choose a
 * local workspace or an owned collaboration server, then restart. Strings are hard-coded
 * English in the Flutter view too.
 */
export function SelfHostedSettingsView({ restartApp }: { restartApp: () => void }) {
  const [loading, setLoading] = useState(true);
  const [shared, setShared] = useState(false);
  const [server, setServer] = useState('');
  const [web, setWeb] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const type = await getAuthenticatorType();
      setShared(!isLocalType(type));
      setServer(getAppFlowyCloudUrl());
      setWeb(getAppFlowyShareDomain());
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (shared) {
        const serverUrl = server.trim();
        validateServerUrl(serverUrl);
        const webUrl = web.trim() === '' ? serverUrl : web.trim();
        validateServerUrl(webUrl);
        await useBaseWebDomain(webUrl);
        await useSelfHostedServer(serverUrl);
      } else {
        await useLocalServer();
      }
      restartApp();
    } catch (e) {
      setError(`FormatException: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsPageHeader title="Storage & server" />
      {loading ? <div className="flex justify-center py-6"><Spinner /></div> : (
        <SettingsSection>
          <Alert variant="info"><AlertDescription>Your data stays on this PC or your own collaboration server. Hosted vendor services and automatic vendor updates are disabled.</AlertDescription></Alert>
          <SettingsGroup>
            <SettingsRow label="Workspace storage">
              <div className="@container"><div role="radiogroup" aria-label="Workspace storage" className="grid gap-2 @lg:grid-cols-2">
                <StorageOption selected={!shared} disabled={saving} icon={<HardDrive />} title="Local workspace on this PC"
                  description="Pages stay in this PC's data folder. No server needed." onSelect={() => setShared(false)} />
                <StorageOption selected={shared} disabled={saving} icon={<Server />} title="My collaboration server"
                  description="Connect to your own AppFlowy Cloud server to sync and collaborate." onSelect={() => setShared(true)} />
              </div></div>
            </SettingsRow>
            {shared && <div className="flex flex-col gap-4 p-4">
              <Field><FieldLabel htmlFor="hyper-server-url">Server URL</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-server-url" className="font-mono text-xs" placeholder="https://appflowy.internal" value={server} disabled={saving} onChange={(event) => setServer(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="hyper-web-url">Web and shared-page URL</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-web-url" className="font-mono text-xs" placeholder="Same as server if left blank" value={web} disabled={saving} onChange={(event) => setWeb(event.target.value)} /></Field>
              <Alert variant="info"><AlertDescription>Sign in to your own server to collaborate. Local workspaces remain separate; export/import them to move existing content.</AlertDescription></Alert>
            </div>}
          </SettingsGroup>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div><Button disabled={saving} onClick={() => void save()}>{saving ? 'Applying…' : 'Apply and restart'}</Button></div>
        </SettingsSection>
      )}
    </>
  );
}
