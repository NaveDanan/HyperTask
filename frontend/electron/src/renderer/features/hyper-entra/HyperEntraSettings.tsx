import { useState } from 'react';
import { HyperEntraConfigKey, HyperEntraConfigSchema, hyperEntraRedirectUri } from '@shared/HyperEntra';
import { KeyValueStorage } from '@/startup/kv';
import { SettingsSection, SettingsGroup } from '@/components/app/settings-layout';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export function HyperEntraSettings() {
  const saved = KeyValueStorage.getJson<{ tenantId?: string; clientId?: string }>(HyperEntraConfigKey);
  const [tenantId, setTenant] = useState(saved?.tenantId ?? ''), [clientId, setClient] = useState(saved?.clientId ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const save = async () => {
    const config = { tenantId: tenantId.trim(), clientId: clientId.trim() };
    const empty = !config.tenantId && !config.clientId;
    if (!empty && !HyperEntraConfigSchema.safeParse(config).success) { setError('Enter both IDs as GUIDs, or leave both blank to turn company sign-in off.'); return; }
    setBusy(true); setError(''); setStatus('');
    try { if (empty) await KeyValueStorage.remove(HyperEntraConfigKey); else await KeyValueStorage.set(HyperEntraConfigKey, JSON.stringify(config)); setStatus(empty ? 'Company sign-in is off.' : 'Company sign-in saved. It will be available on the sign-in screen.'); }
    catch { setError('Could not save company sign-in settings. Try again.'); } finally { setBusy(false); }
  };
  return <SettingsSection title="Company sign-in (Microsoft Entra ID)"><p className="text-xs text-muted-foreground">Use your company’s own application registration. Leave both IDs blank to keep automatic sign-in off.</p><SettingsGroup><div className="flex flex-col gap-4 p-4">
    <Field><FieldLabel htmlFor="hyper-entra-tenant">Tenant ID</FieldLabel><Input id="hyper-entra-tenant" value={tenantId} disabled={busy} spellCheck={false} autoComplete="off" placeholder="Directory (tenant) ID" onChange={event => { setTenant(event.target.value); setStatus(''); }} /></Field>
    <Field><FieldLabel htmlFor="hyper-entra-client">Application (client) ID</FieldLabel><Input id="hyper-entra-client" value={clientId} disabled={busy} spellCheck={false} autoComplete="off" placeholder="Application (client) ID" onChange={event => { setClient(event.target.value); setStatus(''); }} /></Field>
    <div className="space-y-1 text-xs"><p className="font-medium">Broker redirect URI for IT</p><p className="select-text break-all text-muted-foreground">{HyperEntraConfigSchema.shape.clientId.safeParse(clientId.trim()).success ? hyperEntraRedirectUri(clientId.trim()) : 'ms-appx-web://Microsoft.AAD.BrokerPlugin/<client-id>'}</p></div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}{status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}<div><Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save company sign-in'}</Button></div>
  </div></SettingsGroup></SettingsSection>;
}
