// Settings → Task Hub (M5 E5). Edits the same setup scope as the first-run sheet, through the shared form and
// sections, and adds write-back opt-ins (E1.2), ranking weights with a live preview, and privacy choices.
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { HyperHubRejectCode, HyperHubSetupScope, HyperHubWriteSource } from '@shared/HyperTaskHub';
import { SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { getHyperJiraStore } from '@/features/jira/logic/HyperJiraRegistry';
import { HyperHubWeightsEditor } from '@/features/hyper-task-hub/settings/HyperHubWeightsEditor';
import { HyperHubAiConsentField, HyperHubAliasesField, HyperHubSourcesSection, HyperHubWeekFields } from '@/features/hyper-task-hub/setup/HyperHubSetupSections';
import { useHyperHubSetupForm } from '@/features/hyper-task-hub/setup/useHyperHubSetupForm';
import { HyperTaskHubClient } from '@/features/hyper-task-hub/state/HyperTaskHubClient';
import { useHyperTaskHub } from '@/features/hyper-task-hub/state/useHyperTaskHub';

const hyperHubSaveErrors: Partial<Record<HyperHubRejectCode, string>> = {
  'scope-changed': 'Your account or workspace changed. Open this page again.',
  'revision-conflict': 'Task Hub changed while you were editing. Try again.',
  unavailable: 'Task Hub is unavailable right now.',
};

const hyperWriteBackRows: { source: HyperHubWriteSource; label: string; description: string }[] = [
  { source: 'jira', label: 'Allow status changes in Jira', description: 'Change an issue\'s status from Task Hub, using the transitions your Jira account is allowed to make.' },
  { source: 'newsletter', label: 'Allow status changes in Newsletter', description: 'Change the status of your Gantt tasks (not parent rows) from Task Hub, using your Newsletter connection.' },
];

export function HyperTaskHubSettings({ userId }: { userId: string }) {
  const snapshot = useHyperTaskHub(s => s.snapshot);
  const [initial, setInitial] = useState<HyperHubSetupScope | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadOptions = useCallback(() => useHyperTaskHub.getState().getSetupOptions(), []);
  const defaultJiraProject = getHyperJiraStore(userId).getState().config?.projectKey;

  useEffect(() => {
    let cancelled = false;
    if (!useHyperTaskHub.getState().snapshot) void useHyperTaskHub.getState().load();
    void HyperTaskHubClient.getSetupScope().then(setup => { if (!cancelled) setInitial(setup.scope); }, () => {}).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const form = useHyperHubSetupForm({ active: loaded, initial, defaultJiraProject, loadOptions });
  const writeBack = snapshot?.settings.writeBack;
  const save = async () => {
    if (!form.canSave || saving) return;
    setSaving(true);
    try {
      const scope = await form.build();
      await useHyperTaskHub.getState().setSetupScope(scope);
      const failure = useHyperTaskHub.getState().error;
      if (failure) throw new Error(hyperHubSaveErrors[failure as HyperHubRejectCode] ?? failure);
      setInitial(scope);
      toast('Task Hub settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Task Hub settings.');
    } finally { setSaving(false); }
  };

  return <div data-hyper-task-hub-settings className="flex flex-col">
    <SettingsPageHeader title="Task Hub" description="Your sources, your working week, how tasks are ranked, and what Task Hub may change for you."
      actions={<>
        {form.dirty && <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setLoaded(false); queueMicrotask(() => setLoaded(true)); }}>Discard</Button>}
        <Button size="sm" disabled={!loaded || !form.dirty || !form.canSave || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </>} />
    {!loaded ? <div className="flex flex-col gap-3">{[0, 1, 2].map(id => <Skeleton key={id} className="h-24 w-full" />)}</div> : <>
      <SettingsSection title="Sources" description="What counts as yours. Changing a source re-imports it.">
        <div className="flex flex-col gap-5 rounded-lg border bg-card p-4"><HyperHubSourcesSection form={form} /></div>
      </SettingsSection>

      <SettingsSection title="You">
        <div className="rounded-lg border bg-card p-4"><HyperHubAliasesField form={form} /></div>
      </SettingsSection>

      <SettingsSection title="Working week">
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4"><HyperHubWeekFields form={form} /></div>
      </SettingsSection>

      <SettingsSection title="Changes to your sources" description="Off by default. Task Hub asks you before every change, uses your own account, and offers only what your permissions allow.">
        <SettingsGroup>
          {hyperWriteBackRows.map(row => {
            const status = writeBack?.[row.source];
            const checked = row.source === 'jira' ? form.writeBackJira : form.writeBackNewsletter;
            const set = row.source === 'jira' ? form.setWriteBackJira : form.setWriteBackNewsletter;
            const unavailable = status && !status.available && !checked;
            return <SettingsRow key={row.source} label={row.label}
              description={<>{row.description}{unavailable && <span className="mt-0.5 block">Connect {row.source === 'jira' ? 'Jira' : 'Newsletter'} in Settings → Connections first.</span>}</>}
              control={<Switch checked={checked} disabled={!!unavailable} onCheckedChange={set} aria-label={row.label} />} />;
          })}
          <SettingsRow label="Outlook" description="Outlook stays read-only. Task Hub never changes mail or meetings." />
        </SettingsGroup>
        <p className="flex gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>Each change shows a preview, then a system confirmation that only you can approve. Task Hub checks the source again right before sending and never retries a change it couldn't confirm. This does not change how other parts of HyperTask already reach Jira with your saved credentials.</span>
        </p>
      </SettingsSection>

      <SettingsSection title="Ranking" description="How much each signal counts. Task Hub shows the effect on your list before you save.">
        <HyperHubWeightsEditor />
      </SettingsSection>

      <SettingsSection title="Privacy">
        <HyperHubAiConsentField form={form} />
        <p className="text-xs text-muted-foreground">Mail excerpts and their retention are set under Sources → Suggestions from mail. Everything Task Hub stores is encrypted on this device.</p>
      </SettingsSection>
    </>}
  </div>;
}
