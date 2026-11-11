import { useState } from 'react';
import { useStore } from 'zustand';
import { Copy, RefreshCw, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { useTr } from '@/i18n';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperViewAppearance } from './HyperViewAppearanceService';
import { hyperViewAppearanceStrings } from './HyperViewAppearanceStrings';
export function HyperViewAppearanceRecovery() {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner), plans = useStore(hyperViewAppearance.store, state => state.recoveries), [busy, setBusy] = useState('');
  const { tr } = useTr(), text = (name: keyof typeof hyperViewAppearanceStrings) => { const key = `hyperViewAppearance.${name}`, value = tr(key); return value === key ? hyperViewAppearanceStrings[name] : value; };
  if (!owner?.isCurrent()) return null;
  return <>{plans.filter(plan => hyperDocumentOwnerKey(plan.target.scope.owner) === key).map(plan => <Alert key={plan.id} data-hyper-appearance-recovery variant="warning" className="m-3 w-auto shrink-0"><AlertTitle>{text('recovery')}</AlertTitle><AlertDescription><p>{plan.error}</p>{plan.asset && <p>{text('assetKept')}</p>}<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!!busy} onClick={() => window.appflowy.clipboard.writeText(hyperViewAppearance.details(plan))}><Copy />{text('copy')}</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={() => { setBusy(plan.id); void hyperViewAppearance.retry(plan.id, owner).catch(() => {}).finally(() => setBusy('')); }}><RefreshCw />{text('retry')}</Button><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => hyperViewAppearance.dismiss(plan.id)}><X />{text('dismiss')}</Button></div></AlertDescription></Alert>)}</>;
}
