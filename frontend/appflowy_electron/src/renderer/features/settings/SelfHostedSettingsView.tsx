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
import { Spinner } from '@/ui';
import { MaterialIcon, MdButton, MdText, MdTextField } from './material';
import { SettingsBody } from './shared';

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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
        <Spinner />
      </div>
    );
  }

  return (
    <SettingsBody title={'Storage & server'}>
      <MdText key="intro">
        Your data stays on this PC or your own collaboration server. AppFlowy hosted services and automatic vendor updates are disabled.
      </MdText>
      {/* DropdownButtonFormField<bool>(labelText: 'Workspace storage'): the label is always floating. */}
      <div key="storage" className="md-textfield" data-float="true" data-disabled={saving ? 'true' : undefined}>
        <label>Workspace storage</label>
        <div style={{ position: 'relative', display: 'flex' }}>
          <select
            value={shared ? 'server' : 'local'}
            disabled={saving}
            onChange={(event) => setShared(event.target.value === 'server')}
            style={{
              flex: 1,
              appearance: 'none',
              border: 'none',
              borderBottom: '1px solid color-mix(in srgb, var(--cs-on-surface) 38%, transparent)',
              background: 'transparent',
              padding: '8px 24px 8px 0',
              fontSize: 'calc(16px * var(--text-scale, 1))',
              color: 'var(--text-color)',
              outline: 'none',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            <option value="local">Local workspace on this PC</option>
            <option value="server">My collaboration server</option>
          </select>
          <span style={{ position: 'absolute', right: 0, top: 6, pointerEvents: 'none', display: 'flex' }}>{MaterialIcon.arrowDropDown()}</span>
        </div>
      </div>
      {shared && (
        <MdTextField key="server" label="Server URL" hint="https://appflowy.internal" value={server} disabled={saving} onChange={setServer} />
      )}
      {shared && (
        <MdTextField key="web" label="Web and shared-page URL" hint="Same as server if left blank" value={web} disabled={saving} onChange={setWeb} />
      )}
      {shared && (
        <MdText key="hint">
          Sign in to your own server to collaborate. Local workspaces remain separate; export/import them to move existing content.
        </MdText>
      )}
      {error && (
        <MdText key="error" color="var(--cs-error)">
          {error}
        </MdText>
      )}
      <div key="apply">
        <MdButton variant="filled" disabled={saving} onPressed={() => void save()}>
          {saving ? 'Applying…' : 'Apply and restart'}
        </MdButton>
      </div>
    </SettingsBody>
  );
}
