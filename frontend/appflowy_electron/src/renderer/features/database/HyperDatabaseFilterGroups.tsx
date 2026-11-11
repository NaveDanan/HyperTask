import { clone } from '@bufbuild/protobuf';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { Copy, Plus } from 'lucide-react';
import { FieldPBSchema, FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterType } from '@shared/protobuf/flowy-database2/util_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperDocumentOwnerKey } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import type { HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import type { HyperDatabaseStore } from './HyperDatabaseStore';
import { hyperDatabaseFilterKind, hyperDatabaseFilterNew, hyperDecodeDatabaseFilter, hyperEncodeDatabaseFilter, type HyperDatabaseFilterValue } from './HyperDatabaseFilter';
import { HyperDatabaseFilterEditor, hyperDatabaseFilterLabels } from './HyperDatabaseFilterEditor';
import { useHyperDatabaseFilterText } from './HyperDatabaseFilterStrings';
import { HyperDatabaseWindowNavigation, useHyperDatabaseWindow } from './HyperDatabaseWindow';
import { hyperSelectOptions } from './HyperDatabaseCells';
import { hyperCaptureDatabaseFilterGroup, hyperDatabaseFilterGroupLimits, hyperDatabaseFilterGroupTree, type HyperFilterGroupAnchor, type HyperFilterGroupNode } from './HyperDatabaseFilterGroupModel';
import { HyperFilterGroupUncertain, hyperMutateDatabaseFilterGroup, type HyperFilterGroupAction } from './HyperDatabaseFilterGroupService';
import { hyperDatabaseFilterGroupStrings, useHyperDatabaseFilterGroupText } from './HyperDatabaseFilterGroupStrings';
import { hyperDecodeDatabaseDateFilter } from './HyperDatabaseDateFilterBinding';
import { hyperDatabaseDateFilterCriteria, hyperDatabaseDateFilterForm } from './HyperDatabaseDateFilter';
import { hyperDatabaseTimestampFilterForm } from './HyperDatabaseTimestampFilter';
import { hyperDatabaseDateFilterLabels } from './HyperDatabaseDateFilterEditor';
import { useHyperDatabaseDateFilterText } from './HyperDatabaseDateFilterStrings';

const subscribeOwner = (changed: () => void) => { const app = useAppStore.subscribe(changed), workspace = useWorkspaceStore.subscribe(changed); return () => { app(); workspace(); }; };
const ownerVersion = () => hyperDocumentDuplicateBackend.ownerVersion?.() ?? 0;
interface Props { store: HyperDatabaseStore; owner: HyperDatabaseDraftOwner; editable: boolean; canWrite: boolean }
export function HyperDatabaseFilterGroups(props: Props) {
  const version = useSyncExternalStore(subscribeOwner, ownerVersion, ownerVersion);
  return <HyperDatabaseFilterGroupPanel key={JSON.stringify([hyperDocumentOwnerKey(props.owner), version, props.store.viewId])} {...props} />;
}
function HyperDatabaseFilterGroupPanel({ store, owner, editable, canWrite }: Props) {
  const snapshot = useStore(store).snapshot!, text = useHyperDatabaseFilterGroupText(), filtersText = useHyperDatabaseFilterText(), dateText = useHyperDatabaseDateFilterText();
  const captured = useMemo(() => hyperCaptureDuplicateOwner(owner), [owner]);
  const active = useRef(true), latest = useRef({ canWrite }); latest.current = { canWrite };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [editing, setEditing] = useState<HyperFilterGroupAnchor | null>(null), [field, setField] = useState<FieldPB | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [recovery, setRecovery] = useState('');
  const initialValue = useMemo(() => field ? hyperDatabaseFilterNew(field.fieldType) : null, [field]);
  const inFlight = useRef(false), returnFocus = useRef<HTMLElement | null>(null), pending = useRef<string>(''), host = useRef<HTMLElement>(null);
  const databaseId = snapshot.database.id;
  const owned = () => active.current && !!captured?.isCurrent();
  const current = () => owned() && latest.current.canWrite && store.getState().snapshot?.database.id === databaseId;
  const parsed = useMemo(() => { try { return { tree: hyperDatabaseFilterGroupTree(snapshot.settings.filters?.items ?? [], snapshot.fields), error: '' }; } catch (error) { return { tree: null, error: (error as Error).message }; } }, [snapshot.settings.filters, snapshot.fields]);
  const choices = useHyperDatabaseWindow(snapshot.fields.filter(field => hyperDatabaseFilterKind(field.fieldType)), `${databaseId}:group-properties`, 20);
  const roots = useHyperDatabaseWindow(parsed.tree?.roots ?? [], `${databaseId}:group-roots`, 10);
  const explain = (value: unknown) => { const message = value instanceof Error ? value.message : (value as { msg?: string })?.msg ?? String(value); return Object.hasOwn(hyperDatabaseFilterGroupStrings, message) ? text(message as keyof typeof hyperDatabaseFilterGroupStrings) : message; };
  const restore = (id?: string) => requestAnimationFrame(() => {
    if (!owned()) return;
    const node = id ? [...host.current?.querySelectorAll<HTMLElement>('[data-hyper-filter-node]') ?? []].find(element => element.dataset.hyperFilterNode === id) : undefined;
    const target = node?.querySelector<HTMLElement>('[data-hyper-filter-match]') ?? returnFocus.current;
    if (target?.isConnected) target.focus();
  });
  const run = async (anchor: HyperFilterGroupAnchor, action: HyperFilterGroupAction) => {
    if (!current() || inFlight.current || pending.current) return false;
    inFlight.current = true; setBusy(true); setError('');
    let confirmed = false;
    await store.write(async () => {
      try { await hyperMutateDatabaseFilterGroup({ viewId: store.viewId, databaseId, owner: captured!, current }, anchor, action); confirmed = true; }
      catch (error) {
        // Let the host stop its follow-up refresh when this operation's owner
        // has retired. Only the original scope may inspect its saved result.
        if (!owned()) throw Error(text('changed'));
        if (error instanceof HyperFilterGroupUncertain) { pending.current = error.details; if (owned()) { setRecovery(error.details); setEditing(null); setField(null); } }
        if (owned()) setError(explain(error));
      }
    });
    if (owned()) { setBusy(false); if (confirmed) { setEditing(null); setField(null); restore(anchor.source.id); } }
    inFlight.current = false; return confirmed && owned();
  };
  const open = (node: HyperFilterGroupNode, trigger: HTMLElement) => {
    try { if (!editable || inFlight.current || pending.current || !current() || !parsed.tree) return; const anchor = hyperCaptureDatabaseFilterGroup(parsed.tree, snapshot.fields, node.filter.id); if (anchor.depth + (anchor.source.filterType === FilterType.Data ? 1 : 0) > hyperDatabaseFilterGroupLimits.depth) throw Error('capacity'); returnFocus.current = trigger; setEditing(anchor); setField(null); setError(''); }
    catch (error) { if (owned()) setError(explain(error)); }
  };
  const closeEditor = () => { if (inFlight.current) return; setEditing(null); setField(null); restore(); };
  const summary = (node: HyperFilterGroupNode) => {
    const data = node.filter.oneOfData;
    if (data.case !== 'data') return text('group');
    const property = snapshot.fields.find(field => field.id === data.value.fieldId); if (!property || !node.supported) return filtersText('unsupported');
    try {
      if (property.fieldType === FieldType.DateTime) {
        const value = hyperDecodeDatabaseDateFilter(data.value.data).value, label = hyperDatabaseDateFilterLabels[value.condition];
        return `${property.name} · ${label ? dateText(label) : filtersText('unsupported')} ${hyperDatabaseDateFilterCriteria(hyperDatabaseDateFilterForm(value))}`;
      }
      const kind = hyperDatabaseFilterKind(property.fieldType); if (!kind) return property.name;
      const value = hyperDecodeDatabaseFilter(property.fieldType, data.value.data).value;
      if (kind === 'timestamp') { const label = hyperDatabaseDateFilterLabels[value.condition]; return `${property.name} · ${label ? dateText(label) : filtersText('unsupported')} ${value.date ? hyperDatabaseDateFilterCriteria(hyperDatabaseTimestampFilterForm(value.date)) : ''}`; }
      const label = hyperDatabaseFilterLabels[kind][value.condition]; let content = value.content;
      if (kind === 'time' && value.condition < 6) content = filtersText('timeValue', { value: content });
      if (kind === 'select') content = hyperSelectOptions(property).filter(option => value.optionIds.includes(option.id)).slice(0, 3).map(option => option.name).join(', ');
      return `${property.name} · ${label ? filtersText(label) : filtersText('unsupported')} ${content.slice(0, 80)}`;
    } catch { return filtersText('unsupported'); }
  };
  const renderNode = (node: HyperFilterGroupNode) => {
    const group = node.filter.filterType !== FilterType.Data, writable = editable && canWrite && !busy && !recovery && !!parsed.tree?.supported;
    return <div key={node.filter.id} data-hyper-filter-node={node.filter.id} className="flex flex-col gap-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        {group ? <Select value={String(node.filter.filterType)} disabled={!canWrite || !node.supported || !parsed.tree?.supported || !!recovery} readOnly={busy || !editable} onValueChange={value => {
          if (!writable || !parsed.tree || value === null) return; const type = Number(value); if (![FilterType.And, FilterType.Or].includes(type) || type === node.filter.filterType) return;
          try { void run(hyperCaptureDatabaseFilterGroup(parsed.tree, snapshot.fields, node.filter.id), { kind: 'type', value: type }); } catch (error) { setError(explain(error)); }
        }}><SelectTrigger data-hyper-filter-match aria-label={text('match')}><SelectValue>{text(node.filter.filterType === FilterType.Or ? 'any' : node.filter.filterType === FilterType.And ? 'all' : 'unsupported')}</SelectValue></SelectTrigger><SelectContent><SelectItem value={String(FilterType.And)}>{text('all')}</SelectItem><SelectItem value={String(FilterType.Or)}>{text('any')}</SelectItem></SelectContent></Select> : <span className="min-w-0 flex-1 break-words text-xs">{summary(node)}</span>}
        <Button type="button" variant="ghost" size="xs" data-hyper-filter-add disabled={!writable || !node.supported || node.depth + (group ? 0 : 1) > hyperDatabaseFilterGroupLimits.depth} onClick={event => open(node, event.currentTarget)}><Plus />{text('add')}</Button>
        {group && <Button type="button" variant="ghost" size="xs" disabled={!writable || !node.supported} onClick={() => { if (!parsed.tree) return; try { void run(hyperCaptureDatabaseFilterGroup(parsed.tree, snapshot.fields, node.filter.id), { kind: 'delete' }); } catch (error) { if (owned()) setError(explain(error)); } }}>{filtersText('remove')}</Button>}
      </div>
      {node.children.length > 0 && <div className="ml-3 flex flex-col gap-2 border-l pl-2">{node.children.map(renderNode)}</div>}
    </div>;
  };
  if (!owned()) return null;
  return <section ref={host} className="flex flex-col gap-2" aria-label={text('title')}>
    <h3 className="text-sm font-medium">{text('title')}</h3><p className="text-xs text-muted-foreground">{text('help')}</p>
    {(parsed.error || parsed.tree && !parsed.tree.supported) && <Alert variant="info"><AlertDescription>{parsed.error ? explain(Error(parsed.error)) : text('unsupported')}</AlertDescription></Alert>}
    {!roots.total && !parsed.error && <p className="text-xs text-muted-foreground">{text('empty')}</p>}
    {roots.items.map(renderNode)}<HyperDatabaseWindowNavigation window={roots} label={text('title')} compact onPage={roots.setPage} />
    {recovery && <Alert variant="destructive"><AlertDescription><p>{text('uncertain')}</p><p>{text('recoveryHelp')}</p>{error && error !== text('uncertain') && <p role="alert">{error}</p>}<div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => { try { window.appflowy.clipboard.writeText(recovery); } catch { setError(text('copyFailed')); } }}><Copy />{text('copy')}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { if (!owned() || inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); void store.refresh().then(() => { const error = store.getState().error; if (owned() && error) setError(error); }).catch(error => { if (owned()) setError(explain(error)); }).finally(() => { inFlight.current = false; if (owned()) setBusy(false); }); }}>{text('refresh')}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { if (inFlight.current) return; pending.current = ''; setRecovery(''); setError(''); }}>{text('dismiss')}</Button>
    </div></AlertDescription></Alert>}
    {error && !editing && !recovery && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open) closeEditor(); }}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-lg" showCloseButton={!busy} finalFocus={false}>
      <DialogHeader><DialogTitle>{text('add')}</DialogTitle><DialogDescription>{text('help')}</DialogDescription></DialogHeader>
      <Select value={field?.id ?? ''} disabled={busy || !canWrite} onValueChange={id => { if (inFlight.current) return; const selected = snapshot.fields.find(field => field.id === id); setField(selected ? clone(FieldPBSchema, selected) : null); }}><SelectTrigger aria-label={filtersText('field')}><SelectValue placeholder={filtersText('noProperty')}>{field?.name}</SelectValue></SelectTrigger><SelectContent>{choices.items.map(field => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent></Select>
      <HyperDatabaseWindowNavigation window={choices} label={filtersText('properties')} compact onPage={choices.setPage} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {field && initialValue && editing ? <HyperDatabaseFilterEditor key={field.id} field={field} value={initialValue} disabled={!editable || !canWrite || busy} creating onCancel={closeEditor} onSave={async (value: HyperDatabaseFilterValue) => run(editing, { kind: 'add', field, bytes: hyperEncodeDatabaseFilter(field.fieldType, value) })} /> : <Button type="button" variant="outline" disabled={busy} onClick={closeEditor}>{filtersText('cancel')}</Button>}
    </DialogContent></Dialog>
  </section>;
}
