import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { nameOrDefault } from '../view/view-ext';
import { isEditable, ShareAccessLevel } from '../view-header/page-access-level-store';
import { usePageAccessLevel } from '../view-header/view-scope';
import { hyperPageProperties, hyperPropertyTypes, type HyperPageProperty, type HyperPropertyType } from './HyperCollectionModel';
import { HyperPropertyValueInput } from './HyperCollectionEditor';
import { useHyperCollectionText } from './HyperCollectionStrings';
import { hyperOrganizationService } from './HyperOrganizationService';
import { hyperDocumentOwnerKey, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { useHyperOrganizationDialogOwner } from './HyperOrganizationOwner';

interface HyperPagePropertiesProps { workspaceId: string; view: ViewPB; onClose(): void; onSaved(view: ViewPB): void }
export function HyperPagePropertiesDialog(props: HyperPagePropertiesProps) {
  const owner = useHyperOrganizationDialogOwner(props.workspaceId, props.onClose);
  return owner ? <HyperPagePropertiesContent key={`${hyperDocumentOwnerKey(owner)}:${props.view.id}`} {...props} owner={owner} /> : null;
}
function HyperPagePropertiesContent({ workspaceId, view, onClose, onSaved, owner }: HyperPagePropertiesProps & { owner: HyperDocumentOwner }) {
  const t = useHyperCollectionText(), access = usePageAccessLevel();
  const editable = !!access && !access.isLoadingLockStatus && isEditable(access) && [ShareAccessLevel.fullAccess, ShareAccessLevel.readAndWrite].includes(access.accessLevel);
  const [current, setCurrent] = useState(view), [key, setKey] = useState(''), [name, setName] = useState('');
  const [type, setType] = useState<HyperPropertyType>('text'), [value, setValue] = useState<string | number | boolean>('');
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [editingKey, setEditingKey] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ key: string; name: string } | null>(null);
  let properties: Record<string, HyperPageProperty> = {}, unsupported: string[] = [], invalid: string | null = null;
  try { ({ properties, unsupported } = hyperPageProperties(current)); } catch (error) { invalid = error instanceof Error ? error.message : String(error); }
  const save = async (propertyKey: string, property: HyperPageProperty | null) => {
    if (!owner.isCurrent() || saving || !editable || invalid) return;
    setSaving(true); setError(null);
    try {
      const updated = await hyperOrganizationService.setProperty(workspaceId, current.id, propertyKey, property, owner);
      if (!owner.isCurrent()) return;
      setCurrent(updated); onSaved(updated); setKey(''); setName(''); setValue(''); setType('text'); setEditingKey(null);
    } catch (error) { if (owner.isCurrent()) setError((error as { msg?: string })?.msg ?? (error instanceof Error ? error.message : String(error))); }
    finally { if (owner.isCurrent()) setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{t('properties')}</DialogTitle><DialogDescription>{nameOrDefault(current)}</DialogDescription></DialogHeader>
    {(error || invalid) && <Alert variant="destructive"><AlertDescription>{error || invalid}</AlertDescription></Alert>}
    {!!unsupported.length && <Alert variant="warning"><AlertDescription>{t('unsupported')}</AlertDescription></Alert>}
    <div className="divide-y rounded-lg border">{Object.entries(properties).map(([propertyKey, property]) => <div key={propertyKey} className="flex items-center gap-2 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{property.name}</p><p className="truncate font-mono text-xs text-muted-foreground">{propertyKey} · {t(property.type)}</p><p className="break-words text-sm">{String(property.value)}</p></div>
      <Button variant="ghost" size="icon-sm" disabled={!editable || saving || !!invalid} aria-label={t('editProperty')} onClick={() => { setEditingKey(propertyKey); setKey(propertyKey); setName(property.name); setType(property.type); setValue(property.value); }}><Pencil /></Button>
      <Button variant="ghost" size="icon-sm" disabled={!editable || saving || !!invalid} aria-label={t('removeProperty')} onClick={() => setRemoving({ key: propertyKey, name: property.name })}><Trash2 /></Button>
    </div>)}{!Object.keys(properties).length && <p className="p-3 text-sm text-muted-foreground">{t('noProperties')}</p>}</div>
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(key, { name, type, value }); }}>
      <Field><FieldLabel htmlFor="hyper-property-key">{t('propertyKey')}</FieldLabel><Input id="hyper-property-key" value={key} disabled={!editable || saving || !!editingKey || !!invalid} onChange={event => setKey(event.target.value)} placeholder="priority" required /><FieldDescription>{t('keyHelp')}</FieldDescription></Field>
      <Field><FieldLabel htmlFor="hyper-property-name">{t('propertyName')}</FieldLabel><Input id="hyper-property-name" value={name} disabled={!editable || saving || !!invalid} onChange={event => setName(event.target.value)} required maxLength={80} /></Field>
      <Select value={type} disabled={!editable || saving || !!invalid} onValueChange={type => { if (type) { setType(type as HyperPropertyType); setValue(type === 'checkbox' ? false : ''); } }} items={hyperPropertyTypes.map(type => ({ value: type, label: t(type) }))}><SelectTrigger aria-label={t('propertyType')}><SelectValue /></SelectTrigger><SelectContent>{hyperPropertyTypes.map(type => <SelectItem key={type} value={type}>{t(type)}</SelectItem>)}</SelectContent></Select>
      <HyperPropertyValueInput type={type} value={value} onChange={setValue} disabled={!editable || saving || !!invalid} label={t('propertyValue')} />
      {!editable && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button><Button type="submit" disabled={!editable || saving || !!invalid}>{t('addProperty')}</Button></DialogFooter>
    </form>
    <AlertDialog open={removing !== null} onOpenChange={open => { if (!open) setRemoving(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('removeProperty')}: {removing?.name}</AlertDialogTitle><AlertDialogDescription>{t('removeDescription')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>{t('cancel')}</Button><Button variant="destructive" disabled={!editable || saving} onClick={() => { const property = removing; setRemoving(null); if (property && owner.isCurrent()) void save(property.key, null); }}>{t('removeProperty')}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </DialogContent></Dialog>;
}
