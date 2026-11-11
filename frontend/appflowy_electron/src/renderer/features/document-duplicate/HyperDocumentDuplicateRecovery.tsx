import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, RefreshCw, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTr } from '@/i18n';
import { hyperDocumentOwnerKey, useHyperDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperDocumentDuplicates } from './HyperDocumentDuplicateBackend';
import type { HyperDocumentDuplicatePlan, HyperDocumentDuplicateService, HyperDuplicateCandidate } from './HyperDocumentDuplicateService';

export const hyperDocumentDuplicateStrings = {
  copy: 'Copy recovery details', retry: 'Finish copied reminders', retrying: 'Finishing copied reminders…', refresh: 'Find existing copies', select: 'Select an existing copy', close: 'Dismiss copy error',
  discard: 'Keep copy and dismiss recovery',
  memory: 'Recovery remains available while this app is open. Copy the details before closing it.',
} as const;
/** Mount once in the desktop workspace shell. No props or document editor lease are needed. */
export function HyperDocumentDuplicateRecovery({ service = hyperDocumentDuplicates }: { service?: HyperDocumentDuplicateService }) {
  const owner = useHyperDocumentOwner(), state = useStore(service.store), { tr } = useTr(), key = hyperDocumentOwnerKey(owner);
  const t = (name: keyof typeof hyperDocumentDuplicateStrings) => { const path = `hyperDocumentDuplicate.${name}`, translated = tr(path); return translated === path ? hyperDocumentDuplicateStrings[name] : translated; };
  if (!owner?.isCurrent()) return null;
  const plans = state.plans.filter(plan => plan.ownerKey === key);
  if (!plans.length && (state.ownerKey !== key || !state.error)) return null;
  return <div className="shrink-0 space-y-2 p-3" data-hyper-duplicate-recovery>
    {plans.map(plan => <HyperCopyPlan key={`${key}:${plan.id}`} service={service} plan={plan} owner={owner} busy={state.busy} t={t} />)}
    {!plans.length && state.error && <Alert variant="destructive"><AlertDescription><p>{state.error}</p><Button variant="outline" size="sm" onClick={() => service.dismissError(owner)}><X />{t('close')}</Button></AlertDescription></Alert>}
  </div>;
}
function HyperCopyPlan({ service, plan, owner, busy, t }: { service: HyperDocumentDuplicateService; plan: HyperDocumentDuplicatePlan; owner: HyperDocumentOwner; busy: boolean; t(name: keyof typeof hyperDocumentDuplicateStrings): string }) {
  const [candidates, setCandidates] = useState<HyperDuplicateCandidate[]>([]), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState('');
  const refresh = async () => { try { const values = await service.candidates(plan.id, owner); if (owner.isCurrent()) { setCandidates(values); setSelected(null); setError(''); } } catch (error) { if (owner.isCurrent()) setError(error instanceof Error ? error.message : String(error)); } };
  useEffect(() => { if (!plan.rootId && !busy) void refresh(); }, [plan.id, plan.rootId, busy]);
  return <Alert variant={plan.error ? 'destructive' : 'info'}><AlertDescription>
    <p>{plan.error || t('retrying')}</p>
    {plan.error && <p className="text-xs">{t('memory')}</p>}
    {!plan.rootId && !busy && <div className="flex flex-wrap items-center gap-2">
      <Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label={t('select')}><SelectValue placeholder={t('select')} /></SelectTrigger><SelectContent>{candidates.map((candidate, index) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}{candidates.length > 1 ? ` · ${index + 1}` : ''}</SelectItem>)}</SelectContent></Select>
      <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw />{t('refresh')}</Button>
    </div>}
    {error && <p>{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => { const details = service.recovery(plan.id, owner); if (details) window.appflowy.clipboard.writeText(details); }}><Copy />{t('copy')}</Button>
      <Button variant="outline" size="sm" disabled={busy || !plan.rootId && !selected} onClick={() => void service.retry(plan.id, owner, selected ?? undefined)}>{busy ? <Spinner /> : <RefreshCw />}{busy ? t('retrying') : t('retry')}</Button>
      {plan.error && <Button variant="outline" size="sm" disabled={busy} onClick={() => service.discard(plan.id, owner)}>{t('discard')}</Button>}
    </div>
  </AlertDescription></Alert>;
}
