import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { getHyperJiraStore } from '@/features/jira/logic/HyperJiraRegistry';
import { formatHyperJiraRelative, HyperJiraError } from '@/features/jira/ui/jira-ui';
import { HyperJiraSettingsDialog } from '@/features/jira/ui/dialogs/JiraSettingsDialog';

export function useHyperJiraConnection(userId: string) {
  const store = getHyperJiraStore(userId);
  useEffect(() => { void store.getState().load(false); }, [store]);
  const loading = store(s => s.isLoading);
  const config = store(s => s.config);
  const configured = store(s => s.isConfigured);
  const hasCredentials = store(s => s.hasCredentials);
  const error = store(s => s.error);
  const lastSync = store(s => s.snapshot.lastSuccessAt);
  const syncError = store(s => s.snapshot.lastError);
  const label = loading ? 'Checking settings…' : !configured ? (error ? 'Settings unavailable' : 'Not configured')
    : !hasCredentials ? 'Credentials needed' : syncError || error?.kind === 'auth' ? 'Sync needs attention' : lastSync ? 'Connected' : 'Configured';
  return { store, loading, config, hasCredentials, label, error, lastSync, syncError };
}

export function HyperJiraSettingsPage({ userId }: { userId: string }) {
  const { store, loading, config, hasCredentials, label, error, lastSync, syncError } = useHyperJiraConnection(userId);
  const enabled = store(s => s.kanbanEnabled);
  const syncing = store(s => s.isSyncing);
  const canSync = store(s => s.canSync);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try { await store.getState().forgetCredentials(); setConfirm(false); }
    catch { /* The store exposes the error. */ }
    finally { setBusy(false); }
  }

  return <>
    <SettingsPageHeader title="Jira" description="Connect a Jira project to sync issues into HyperTask." />
    <SettingsSection><SettingsGroup>
      <SettingsRow label="Project connection" description={<span role="status" className="break-words">{label}{config?.projectKey ? ` · ${config.projectKey}` : ''}{lastSync ? ` · Last synced ${formatHyperJiraRelative(lastSync)}` : ''}</span>}>
        {config?.baseUrl && !editing && <p className="break-all text-xs text-muted-foreground">{config.baseUrl}</p>}
        {editing ? <HyperJiraSettingsDialog store={store} inline onClose={() => setEditing(false)} /> : <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={loading || busy || confirm} onClick={() => setEditing(true)}>{hasCredentials ? 'Edit connection' : 'Connect Jira'}</Button>
          {hasCredentials && <>
            <Button size="sm" variant="outline" disabled={!canSync || busy || confirm} onClick={() => void store.getState().sync(!lastSync)}>{syncing ? 'Syncing…' : 'Sync now'}</Button>
            <Button size="sm" variant="ghost" disabled={syncing || busy || confirm} onClick={() => setConfirm(true)}>Disconnect…</Button>
          </>}
        </div>}
        {confirm && <div className="space-y-2" role="group" aria-label="Disconnect Jira">
          <p className="text-sm text-muted-foreground">Remove the saved credentials and stop syncing. Cached issues and project settings stay on this device.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={busy || syncing} onClick={() => void disconnect()}>{busy ? 'Disconnecting…' : 'Disconnect Jira'}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        </div>}
      </SettingsRow>
      <SettingsRow label="Add Jira issues to Hyper-Kanban"
        description="New and updated issues from Jira sync appear as cards on the Hyper-Kanban on Home. Turning this off keeps existing cards."
        control={<Switch aria-label="Add Jira issues to Hyper-Kanban" checked={enabled} disabled={loading} onCheckedChange={value => void store.getState().setKanbanEnabled(value)} />} />
    </SettingsGroup>
    {error ? <HyperJiraError error={error} /> : hasCredentials && syncError ? <p role="alert" className="text-sm text-destructive">{syncError}</p> : null}
    </SettingsSection>
  </>;
}
