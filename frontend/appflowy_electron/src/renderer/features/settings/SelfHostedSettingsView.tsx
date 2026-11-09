import { useEffect, useState } from 'react';

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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/reui/alert';


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
            <div data-float="true" data-disabled={saving ? 'true' : undefined}>
              <SettingsRow label="Workspace storage" control={
                <Select value={shared ? 'server' : 'local'} disabled={saving} onValueChange={(value) => setShared(value === 'server')}>
                  <SelectTrigger size="sm" className="min-w-40" aria-label="Workspace storage"><SelectValue>{shared ? 'My collaboration server' : 'Local workspace on this PC'}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value="local">Local workspace on this PC</SelectItem><SelectItem value="server">My collaboration server</SelectItem></SelectContent>
                </Select>
              } />
            </div>
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
