import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { asJiraException, pickCloseTransition, type JiraException, type JiraIssue, type JiraTransition } from '../..';
import { HyperJiraStatusBadge } from '../JiraStatusBadge';
import { HyperJiraError, HyperJiraField, HyperJiraModal, HyperJiraNotice, openHyperJiraUrl, type HyperJiraStoreHook } from '../jira-ui';

export function HyperJiraTransitionDialog({ store, issue, browseUrl, onClose }: { store: HyperJiraStoreHook; issue: JiraIssue; browseUrl?: string; onClose: () => void }) {
  const id = useId();
  const [transitions, setTransitions] = useState<JiraTransition[] | null>(null);
  const [selected, setSelected] = useState<JiraTransition | null>(null);
  const [resolutionId, setResolutionId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<JiraException | null>(null);
  function select(transition: JiraTransition | null) {
    setSelected(transition);
    const options = transition?.resolutionField?.allowedValues ?? [];
    setResolutionId((options.find(option => ['done', 'fixed', 'resolved'].includes(option.name.toLowerCase())) ?? options[0])?.id ?? null);
  }
  const load = useCallback(async (active: () => boolean = () => true) => {
    setLoading(true); setError(null);
    try {
      const list = await store.getState().getTransitions(issue.key);
      const sorted = [...list.filter(t => t.closesIssue), ...list.filter(t => !t.closesIssue)];
      if (active()) { setTransitions(sorted); select(pickCloseTransition(sorted) ?? sorted[0] ?? null); }
    } catch (e) { if (active()) setError(asJiraException(e)); } finally { if (active()) setLoading(false); }
  }, [store, issue.key]);
  useEffect(() => {
    let active = true; void load(() => active);
    return () => { active = false; };
  }, [load]);
  async function apply() {
    if (!selected || applying || selected.unsupportedRequiredFields.length) return;
    setApplying(true); setError(null);
    try {
      await store.getState().transitionIssue(issue, selected, { resolutionId, comment: selected.hasScreen ? comment : null });
      onClose();
    } catch (e) { setError(asJiraException(e)); } finally { setApplying(false); }
  }
  const unsupported = selected?.unsupportedRequiredFields ?? [];
  const resolution = selected?.resolutionField;
  const openAction = browseUrl ? <Button type="button" variant="outline" size="sm" onClick={() => openHyperJiraUrl(browseUrl)}>Open in Jira</Button> : null;
  return <HyperJiraModal title={`${issue.key}: change status`} onClose={onClose} footer={<>
    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
    <Button type="submit" form={id + '-form'} data-testid="jira-transition-apply" disabled={loading || applying || !selected || unsupported.length > 0}>{applying ? 'Applying…' : selected?.closesIssue ? 'Close issue' : 'Apply'}</Button>
  </>}>
    <form id={id + '-form'} className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void apply(); }}>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Current status</span><HyperJiraStatusBadge label={issue.statusName} category={issue.statusCategory} />
        {browseUrl && <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => openHyperJiraUrl(browseUrl)}>Open in Jira</Button>}
      </div>
      {error && <HyperJiraError error={error} actions={<>{transitions === null && <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>Retry</Button>}{openAction}</>} />}
      {loading ? <div className="flex justify-center p-4"><Spinner /></div> : transitions?.length === 0 ? <HyperJiraNotice message="No transitions are available for you on this issue in its current status." /> : transitions && <>
        {!transitions.some(t => t.closesIssue) && <HyperJiraNotice message="No transition leads directly to a Done status from here. Move it forward first." />}
        <HyperJiraField id={id + 'transition'} label="Transition">
          <RadioGroup id={id + 'transition'} aria-labelledby={id + 'transition-label'} className="gap-0 divide-y rounded-lg border" value={selected?.id ?? ''} onValueChange={value => select(transitions.find(t => t.id === value) ?? null)}>
            {transitions.map(t => <label key={t.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50">
              <RadioGroupItem value={t.id} data-testid={`jira-transition-${t.id}`} aria-label={t.name} /><span className="min-w-0 flex-1">{t.name}</span><HyperJiraStatusBadge label={t.toStatusName} category={t.toCategory} />
            </label>)}
          </RadioGroup>
        </HyperJiraField>
        {unsupported.length > 0 && <HyperJiraNotice variant="warning" message={`"${selected!.name}" requires ${unsupported.map(field => field.name).join(', ')}. Complete this transition in Jira.`} actions={openAction} />}
        {resolution && resolution.allowedValues.length > 0 && <HyperJiraField id={id + 'resolution'} label="Resolution" required={resolution.required}>
          <Select value={resolutionId ?? ''} onValueChange={value => setResolutionId(value || null)} items={resolution.allowedValues.map(option => ({ value: option.id, label: option.name }))}>
            <SelectTrigger id={id + 'resolution'} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{!resolution.required && <SelectItem value="">None</SelectItem>}{resolution.allowedValues.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
          </Select>
        </HyperJiraField>}
        {selected?.hasScreen && <HyperJiraField id={id + 'comment'} label="Comment (optional)"><Textarea id={id + 'comment'} rows={2} className="field-sizing-fixed" value={comment} onChange={event => setComment(event.target.value)} /></HyperJiraField>}
      </>}
    </form>
  </HyperJiraModal>;
}
export { HyperJiraTransitionDialog as JiraTransitionDialog };
