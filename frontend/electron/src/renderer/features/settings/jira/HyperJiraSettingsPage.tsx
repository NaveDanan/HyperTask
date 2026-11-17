import { useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { getHyperJiraStore } from '@/features/jira/logic/HyperJiraRegistry';
import { formatHyperJiraRelative } from '@/features/jira/ui/jira-ui';
import { tabsActions } from '@/features/tabs/tabs-store';
import { localToolPlugin } from '@/features/tabs/plugin';
import type { SettingsPageProps } from '../page-props';

export function HyperJiraSettingsPage({ user, closeDialog }: SettingsPageProps) {
  const userId = String(user.id), store = useMemo(() => getHyperJiraStore(userId), [userId]);
  const loading = store(s => s.isLoading), configured = store(s => s.isConfigured);
  const enabled = store(s => s.kanbanEnabled), lastSync = store(s => s.snapshot.lastSuccessAt);
  const error = store(s => s.error);
  useEffect(() => { void store.getState().load(false); }, [store]);
  const openJira = () => { closeDialog(); tabsActions.openPlugin(localToolPlugin('jira')); };
  return <>
    <SettingsPageHeader title="Jira" />
    <SettingsSection><SettingsGroup>
      <SettingsRow label="Add Jira issues to Hyper-Kanban"
        description="New and updated issues from Jira sync appear as cards on the Hyper-Kanban on Home. Turning this off keeps existing cards."
        control={<Switch aria-label="Add Jira issues to Hyper-Kanban" checked={enabled} disabled={loading} onCheckedChange={value => void store.getState().setKanbanEnabled(value)} />} />
    </SettingsGroup></SettingsSection>
    {!loading && !configured && <div className="mt-4 flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted-foreground">Jira is not configured.</p>
      <Button variant="outline" size="sm" onClick={openJira}>Open Jira</Button>
    </div>}
    {lastSync && <p className="mt-4 text-sm text-muted-foreground">Last synced {formatHyperJiraRelative(lastSync)}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error.message}</p>}
  </>;
}
