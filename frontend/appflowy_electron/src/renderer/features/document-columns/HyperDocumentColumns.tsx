import { useEffect, useRef, useState } from 'react';
import { Columns2, Columns3, Columns4 } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useTr } from '@/i18n';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperCaptureDocumentColumns, hyperReadDocumentColumns, hyperResizeDocumentColumns, type HyperDocumentColumnCount, type HyperDocumentColumnsCapture } from './HyperDocumentColumnsModel';

export const hyperDocumentColumnsStrings = {
  twoColumns: 'Two columns', threeColumns: 'Three columns', fourColumns: 'Four columns',
  width: 'Column {index} width (%)', help: 'Changing a width adjusts the next column. Each needs at least 10%.',
  changed: 'The document or edit permission changed.',
} as const;
function useColumnText() {
  const { tr } = useTr();
  return (key: keyof typeof hyperDocumentColumnsStrings) => { const id = `hyperDocumentColumns.${key}`, translated = tr(id); return translated === id ? hyperDocumentColumnsStrings[key] : translated; };
}
export function HyperDocumentColumnsMenuItems({ disabled = false, onSelect }: { disabled?: boolean; onSelect(count: HyperDocumentColumnCount): void }) {
  const t = useColumnText();
  return <>{([[2, 'twoColumns', Columns2], [3, 'threeColumns', Columns3], [4, 'fourColumns', Columns4]] as const).map(([count, label, Icon]) => <DropdownMenuItem key={count} disabled={disabled} onClick={() => onSelect(count)}><Icon />{t(label)}</DropdownMenuItem>)}</>;
}
interface WidthProps {
  session: HyperDocumentSession;
  document: DocumentDataPB;
  columnsId: string;
  editable: boolean;
  isEditable(): boolean;
  onError(message: string): void;
}
export function HyperDocumentColumnWidths({ session, document: rendered, columnsId, editable, isEditable, onError }: WidthProps) {
  const t = useColumnText(), layout = hyperReadDocumentColumns(rendered, columnsId);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const live = useRef({ session, columnsId, editable, isEditable, onError }); live.current = { session, columnsId, editable, isEditable, onError };
  const mounted = useRef(true), captures = useRef(new Map<number, HyperDocumentColumnsCapture>());
  useEffect(() => { mounted.current = true; captures.current.clear(); setError(''); setBusy(false); return () => { mounted.current = false; }; }, [session, columnsId]);
  const requireEditable = () => {
    const current = live.current;
    if (!mounted.current || current.session !== session || current.columnsId !== columnsId || !current.editable || !current.isEditable() || !session.isCurrentOwner()) throw new Error(t('changed'));
  };
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (mounted.current && live.current.session === session && live.current.columnsId === columnsId) { setError(message); onError(message); }
  };
  const commit = async (index: number, value: number) => {
    try {
      requireEditable(); const target = captures.current.get(index);
      if (!target) throw new Error(t('changed'));
      const current = session.store.getState().document;
      if (!current) throw new Error(t('changed'));
      const left = hyperReadDocumentColumns(current, columnsId).columns[index];
      if (left && Math.abs(left.ratio - value / 100) < 1e-9) return;
      setError(''); onError(''); setBusy(true);
      const changed = session.change(doc => { requireEditable(); return hyperResizeDocumentColumns(doc, target, index, value / 100, live.current.isEditable()); });
      if (!changed) throw new Error(t('changed'));
      await session.flush(); requireEditable();
    } catch (error) { fail(error); }
    finally { if (mounted.current && live.current.session === session && live.current.columnsId === columnsId) setBusy(false); }
  };
  if (!layout.supported) return <Alert variant="warning"><AlertDescription>{layout.error}</AlertDescription></Alert>;
  if (layout.columns.length < 2) return null;
  return <div className="mb-2 flex flex-col gap-2" data-hyper-column-widths={columnsId} aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-3">{layout.columns.slice(0, -1).map((column, index) => {
      const next = layout.columns[index + 1], minimum = Math.max(0.1, column.ratio + next.ratio - 1), maximum = Math.min(1, column.ratio + next.ratio - 0.1);
      const value = Number((column.ratio * 100).toFixed(4));
      return <HyperColumnWidthInput key={column.id} value={value} minimum={minimum * 100} maximum={maximum * 100} disabled={!editable || maximum < minimum} label={t('width').replace('{index}', String(index + 1))} onFocus={() => {
        captures.current.delete(index);
        try { requireEditable(); const document = session.store.getState().document; if (!document) throw new Error(t('changed')); captures.current.set(index, hyperCaptureDocumentColumns(document, columnsId)); }
        catch (error) { fail(error); }
      }} onCommit={value => commit(index, value)} onInvalid={() => fail(new Error('Choose a valid column width.'))} />;
    })}</div>
    <p className="text-xs text-muted-foreground">{t('help')}</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

function HyperColumnWidthInput({ value, minimum, maximum, disabled, label, onFocus, onCommit, onInvalid }: { value: number; minimum: number; maximum: number; disabled: boolean; label: string; onFocus(): void; onCommit(value: number): Promise<void>; onInvalid(): void }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false), mounted = useRef(true), latest = useRef(value); latest.current = value;
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <label className="flex items-center gap-2 text-xs text-muted-foreground">{label}<Input className="w-24" type="number" min={minimum} max={maximum} step={1} value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} onFocus={() => { focused.current = true; onFocus(); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} onBlur={event => {
    focused.current = false;
    const next = event.currentTarget.valueAsNumber;
    if (!Number.isFinite(next)) { setDraft(String(latest.current)); onInvalid(); return; }
    if (Math.abs(next - latest.current) < 1e-7) { setDraft(String(latest.current)); return; }
    void onCommit(next).finally(() => { if (mounted.current) setDraft(String(latest.current)); });
  }} /></label>;
}
