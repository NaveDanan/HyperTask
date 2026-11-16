// Adapted from OpenBot admin/controls/{sign-in-section,recording-section}. Copyright (c) 2026 CopilotKit. MIT licensed.
import { Button } from '../../../components/ui/button';
import { hyperGovernanceRequest as request } from './HyperGovernanceApi';
import { HyperStatus, HyperError, useHyperAction, useHyperResource } from './HyperGovernanceUi';
type HyperControls = {
  settings: {
    ssoRequired: boolean;
    actionRecording: boolean;
  };
  scim: {
    configured: boolean;
    baseUrl: string | null;
  };
  otel: {
    configured: boolean;
  };
  actionRecordRetentionDays: number;
};
export function HyperSignInSettings() {
  const r = useHyperResource<HyperControls>('/api/admin/enterprise');
  const a = useHyperAction(r.reload);
  return <HyperStatus resource={r}>{r.data && <div className="grid gap-3 border-t pt-3"><h3>Sign-in</h3><label><input disabled={a.busy} type="checkbox" checked={r.data.settings.ssoRequired} onChange={e => void a.run(() => request('/api/admin/enterprise/settings/ssoRequired', 'PUT', {
          value: e.target.checked
        }))} /> Require SSO</label><p>Configured administrators retain emergency social sign-in. Each sign-in appears in Activity.</p><p>SCIM provisioning: {r.data.scim.configured ? `On · ${r.data.scim.baseUrl || 'Set BETTER_AUTH_URL on the server'}` : 'Off · Set SCIM_BEARER_TOKEN on the server to enable directory provisioning.'}</p><p>Deprovisioning ends sessions, blocks access, retires connector credentials and stops computers.</p><HyperError message={a.error} /></div>}</HyperStatus>;
}
export function HyperRecordingSettings() {
  const r = useHyperResource<HyperControls>('/api/admin/enterprise');
  const a = useHyperAction(r.reload);
  return <HyperStatus resource={r}>{r.data && <div className="grid gap-3 border-t pt-3"><h3>Recording and export</h3><label><input disabled={a.busy} type="checkbox" checked={r.data.settings.actionRecording} onChange={e => void a.run(() => request('/api/admin/enterprise/settings/actionRecording', 'PUT', {
          value: e.target.checked
        }))} /> Record shell commands</label><p>Recorded commands have secrets removed and are retained for {r.data.actionRecordRetentionDays} days.</p><p>OpenTelemetry export: {r.data.otel.configured ? 'On · Exporting over OTLP/HTTP' : 'Off · Set OTEL_EXPORTER_OTLP_ENDPOINT on the server.'}</p>{r.data.settings.actionRecording && <HyperRecordedActions />}<HyperError message={a.error} /></div>}</HyperStatus>;
}
function HyperRecordedActions() {
  const r = useHyperResource<{
    actions: {
      id: string;
      command: string;
      surface: string;
      botId: string | null;
      outcome: string;
      createdAt: string;
    }[];
  }>('/api/admin/enterprise/actions?limit=50');
  return <HyperStatus resource={r}>{!r.data?.actions.length && <p>No recorded commands.</p>}{r.data?.actions.map(row => <article className="border-b p-3" key={row.id}><code>{row.command}</code><p>{row.surface === 'local' ? 'Member computer' : `Bot ${row.botId}`} · {row.outcome} · {new Date(row.createdAt).toLocaleString()}</p></article>)}<Button variant="outline" onClick={r.reload}>Refresh commands</Button></HyperStatus>;
}
