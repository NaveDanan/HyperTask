import { useEffect, useRef, useState } from 'react';
import { FilePlus } from 'lucide-react';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { DocumentEventCreateDocument } from '@/backend/events/flowy-document';
import { DatabaseEventUpdateRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { rowDocumentIdForRow } from '../templates/converter';
import { HyperDocumentEditor } from './HyperDocumentPage';
import { acquireHyperDocument, type HyperDocumentSession } from './HyperDocumentSession';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from './HyperDocumentOwner';

export function HyperRowDocument({ row, viewId, editable }: { row: RowMetaPB; viewId: string; editable: boolean }) {
  const { tr } = useTr();
  const [hasDocument, setHasDocument] = useState(row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value === false);
  const [session, setSession] = useState<HyperDocumentSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const documentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
  const owner = useHyperDocumentOwner();
  const ownerKey = hyperDocumentOwnerKey(owner);
  const latest = useRef({ documentId, viewId, rowId: row.id, editable });
  const alive = useRef(true);
  latest.current = { documentId, viewId, rowId: row.id, editable };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(null); setCreating(false); }, [ownerKey, documentId]);
  useEffect(() => {
    if (!hasDocument || !owner) return;
    let cancelled = false, release: (() => void) | undefined;
    void acquireHyperDocument(documentId, owner).then(lease => {
      if (cancelled) lease.release();
      else { release = lease.release; setSession(lease.session); }
    }).catch(error => {
      if (!cancelled && owner.isCurrent()) setError((error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error));
    });
    return () => { cancelled = true; release?.(); };
  }, [documentId, hasDocument, owner]);
  const addContent = async () => {
    if (!editable || creating || !owner?.isCurrent()) return;
    setCreating(true); setError(null);
    try {
      const result = await DocumentEventCreateDocument({ documentId });
      // An imported row may already contain a document but still have the old empty flag.
      if (!result.ok && result.error.code !== ErrorCode.RecordAlreadyExists) unwrap(result);
      if (!alive.current || !owner.isCurrent() || !latest.current.editable || latest.current.documentId !== documentId || latest.current.viewId !== viewId || latest.current.rowId !== row.id) throw new Error(tr('hyperDocument.readOnly'));
      unwrap(await DatabaseEventUpdateRowMeta({ viewId, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }));
      setHasDocument(true);
    } catch (error) { if (alive.current && owner.isCurrent()) setError((error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error)); }
    finally { if (alive.current && owner.isCurrent()) setCreating(false); }
  };
  return <section className="flex min-h-32 flex-col gap-2 border-t pt-4" aria-label={tr('hyperDocument.rowContent')}>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {hasDocument ? owner && session?.id === documentId && session.belongsTo(owner) ? <div className="flex h-96 flex-col"><HyperDocumentEditor key={`${ownerKey}:${documentId}`} session={session} title={tr('hyperDocument.rowContent')} editable={editable} rowScope={{ viewId, rowId: row.id }} /></div> : <Spinner /> : <Button variant="outline" className="self-start" disabled={!editable || creating || !owner} onClick={() => void addContent()}><FilePlus />{tr('hyperDocument.addContent')}</Button>}
  </section>;
}
