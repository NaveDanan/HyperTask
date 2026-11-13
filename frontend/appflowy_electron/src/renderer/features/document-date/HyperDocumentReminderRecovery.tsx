import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { Copy, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperDocumentDateBackend } from './HyperDocumentDateStore';
import { hyperDocumentReminderHistory, type HyperDocumentReminderHistory } from './HyperDocumentReminderHistory';

export const hyperDocumentReminderRecoveryStrings = { copy: 'Copy reminder recovery', retry: 'Retry reminder updates', retrying: 'Updating reminders…' } as const;
export interface HyperDocumentReminderRecoveryProps { session: HyperDocumentSession; canWrite(): boolean; rowScope?: { viewId: string; rowId: string } }
export function HyperDocumentReminderRecovery(props: HyperDocumentReminderRecoveryProps) {
  const owner = useHyperDocumentOwner(), latest = useRef(props); latest.current = props;
  const key = hyperDocumentOwnerKey(owner);
  const context = useMemo(() => owner && props.session.belongsTo(owner) ? { session: props.session, owner, editable: () => latest.current.canWrite(), canWrite: () => latest.current.canWrite(), rowScope: props.rowScope } : null, [key, props.session, props.rowScope?.viewId, props.rowScope?.rowId]);
  const history = useMemo(() => context ? hyperDocumentReminderHistory(context, hyperDocumentDateBackend) : null, [context]);
  useEffect(() => context && history ? history.connect(context) : undefined, [context, history]);
  return history ? <HyperReminderRecoveryContent history={history} canWrite={() => latest.current.canWrite()} /> : null;
}
function HyperReminderRecoveryContent({ history, canWrite }: { history: HyperDocumentReminderHistory; canWrite(): boolean }) {
  const { tr } = useTr(), state = useStore(history.store);
  const t = (key: keyof typeof hyperDocumentReminderRecoveryStrings) => { const path = `hyperDocumentReminderRecovery.${key}`, value = tr(path); return value === path ? hyperDocumentReminderRecoveryStrings[key] : value; };
  if (!state.error) return null;
  return <Alert variant="destructive" className="m-4 w-auto"><AlertDescription><p>{state.error}</p><div className="mt-3 flex flex-wrap gap-2">
    {state.recovery && <Button variant="outline" size="sm" onClick={() => window.appflowy.clipboard.writeText(state.recovery)}><Copy />{t('copy')}</Button>}
    {state.pending && <Button variant="outline" size="sm" disabled={state.busy || !canWrite()} onClick={() => void history.retry()}>{state.busy ? <Spinner /> : <RefreshCw />}{state.busy ? t('retrying') : t('retry')}</Button>}
  </div></AlertDescription></Alert>;
}
