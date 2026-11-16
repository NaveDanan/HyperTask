import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { asJiraException, JiraConflictException, JiraIssueDraft, JiraValidationException, type JiraException, type JiraIssue, type JiraIssueType } from '../..';
import { HyperJiraError, HyperJiraField, HyperJiraModal, HyperJiraNotice, type HyperJiraStoreHook } from '../jira-ui';

export function buildHyperJiraDraft(base: JiraIssue | null, summary: string, description: string, assignee: string, issueTypeId?: string): JiraIssueDraft {
  const s = summary.trim(), a = assignee.trim();
  return new JiraIssueDraft(base ? {
    summary: s !== base.summary ? s : null,
    description: description !== base.description ? description : null,
    assigneeName: a !== (base.assignee?.name ?? '') ? a : null,
  } : { summary: s, description: description.trim() ? description : null, assigneeName: a || null, issueTypeId });
}

export function HyperJiraConflictAlert({ conflict, saving, onUseRemote, onOverwrite }: {
  conflict: JiraConflictException; saving: boolean; onUseRemote: () => void; onOverwrite: () => void;
}) {
  return <HyperJiraNotice variant="warning" title="Changed in Jira since you opened it"
    message={`${conflict.message}\nJira now has: "${conflict.remote.summary}" (${conflict.remote.statusName}, ${conflict.remote.assigneeLabel}).`}
    actions={<><Button type="button" variant="outline" size="sm" disabled={saving} onClick={onUseRemote}>Use Jira version</Button><Button type="button" size="sm" disabled={saving} onClick={onOverwrite}>Overwrite with mine</Button></>} />;
}

export function HyperJiraIssueDialog({ store, issue = null, onClose }: { store: HyperJiraStoreHook; issue?: JiraIssue | null; onClose: () => void }) {
  const id = useId();
  const summaryRef = useRef<HTMLInputElement>(null);
  const [base, setBase] = useState(issue);
  const [summary, setSummary] = useState(issue?.summary ?? '');
  const [description, setDescription] = useState(issue?.description ?? '');
  const [assignee, setAssignee] = useState(issue?.assignee?.name ?? '');
  const [types, setTypes] = useState<JiraIssueType[] | null>(null);
  const [issueType, setIssueType] = useState<JiraIssueType | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(!issue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<JiraException | null>(null);
  const [conflict, setConflict] = useState<JiraConflictException | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const isEdit = issue !== null;
  useEffect(() => {
    if (isEdit) return;
    let active = true;
    void store.getState().getCreatableIssueTypes().then(list => {
      if (!active) return;
      setTypes(list); setIssueType(list.find(type => type.name === 'Task') ?? list[0] ?? null);
    }).catch(e => { if (active) setError(asJiraException(e)); }).finally(() => { if (active) setLoadingTypes(false); });
    return () => { active = false; };
  }, [store, isEdit]);
  async function submit(overwrite = false) {
    if (saving) return;
    if (!summary.trim()) { setFieldErrors({ summary: 'Summary is required.' }); return; }
    setSaving(true); setError(null); setFieldErrors({}); if (!overwrite) setConflict(null);
    try {
      const draft = buildHyperJiraDraft(base, summary, description, assignee, issueType?.id);
      const actions = store.getState();
      const saved = base === null ? await actions.createIssue(draft) : Object.keys(draft.toFields()).length ? await actions.updateIssue(base, draft, { overwrite }) : base;
      await actions.issueChanged(saved, isEdit ? `Saved ${saved.key}` : `Created ${saved.key}`);
      onClose();
    } catch (e) {
      if (e instanceof JiraConflictException) setConflict(e);
      else {
        const failure = asJiraException(e); setError(failure);
        if (failure instanceof JiraValidationException) setFieldErrors(failure.fieldErrors);
      }
    } finally { setSaving(false); }
  }
  function useRemote() {
    if (!conflict) return;
    const remote = conflict.remote;
    setBase(remote); setSummary(remote.summary); setDescription(remote.description); setAssignee(remote.assignee?.name ?? '');
    setConflict(null); setFieldErrors({}); setError(null);
  }
  const control = (name: string) => ({ id: id + name, 'aria-invalid': !!fieldErrors[name], 'aria-describedby': fieldErrors[name] || ['description', 'assignee'].includes(name) || (name === 'issuetype' && loadingTypes) ? id + name + '-help' : undefined });
  const unplacedErrors = Object.entries(fieldErrors).filter(([key]) => !['summary', 'description', 'assignee', 'issuetype'].includes(key));
  return <HyperJiraModal title={isEdit ? `Edit ${issue.key}` : 'New Jira issue'} onClose={onClose} initialFocus={summaryRef} footer={<>
    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
    <Button type="submit" form={id + '-form'} data-testid="jira-issue-submit" disabled={saving || (!isEdit && !issueType)}>{saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}</Button>
  </>}>
    <form id={id + '-form'} className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      {conflict && <HyperJiraConflictAlert conflict={conflict} saving={saving} onUseRemote={useRemote} onOverwrite={() => void submit(true)} />}
      {error && (!(error instanceof JiraValidationException) || !Object.keys(fieldErrors).length) && <HyperJiraError error={error} />}
      {unplacedErrors.length > 0 && <HyperJiraNotice variant="destructive" title={error?.title} message={unplacedErrors.map(([key, value]) => `${key}: ${value}`).join('\n')} />}
      {!isEdit && <HyperJiraField id={id + 'issuetype'} label="Issue type" required error={fieldErrors.issuetype} helper={loadingTypes ? 'Loading issue types…' : undefined}>
        <ToggleGroup {...control('issuetype')} aria-labelledby={id + 'issuetype-label'} variant="outline" className="flex-wrap" disabled={loadingTypes || !types} value={issueType ? [issueType.id] : []} onValueChange={values => { const selected = types?.find(type => type.id === values[0]); if (selected) setIssueType(selected); }}>
          {types?.map(type => <ToggleGroupItem key={type.id} value={type.id}>{type.name}</ToggleGroupItem>)}
        </ToggleGroup>
      </HyperJiraField>}
      <HyperJiraField id={id + 'summary'} label="Summary" required error={fieldErrors.summary}>
        <Input ref={summaryRef} {...control('summary')} data-testid="jira-issue-summary" autoFocus maxLength={255} value={summary} onChange={event => setSummary(event.target.value)} />
      </HyperJiraField>
      <HyperJiraField id={id + 'description'} label="Description" error={fieldErrors.description} helper="Jira wiki markup is supported.">
        <Textarea {...control('description')} rows={6} className="field-sizing-fixed" value={description} onChange={event => setDescription(event.target.value)} />
      </HyperJiraField>
      <HyperJiraField id={id + 'assignee'} label="Assignee username (optional)" error={fieldErrors.assignee} helper={isEdit ? 'Clear to unassign. Leave unchanged to keep.' : 'Leave empty to use the project default.'}>
        <Input {...control('assignee')} value={assignee} onChange={event => setAssignee(event.target.value)} />
      </HyperJiraField>
    </form>
  </HyperJiraModal>;
}
export { HyperJiraIssueDialog as JiraIssueDialog };
