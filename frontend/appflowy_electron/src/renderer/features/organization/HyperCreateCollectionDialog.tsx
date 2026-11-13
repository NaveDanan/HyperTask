import { useState } from 'react';
import { ViewSectionPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { nameOrDefault } from '../view/view-ext';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { HyperCollectionEditor } from './HyperCollectionEditor';
import { hyperDefaultCollection } from './HyperCollectionModel';
import { useHyperCollectionText } from './HyperCollectionStrings';
import { hyperOrganizationService } from './HyperOrganizationService';
import { hyperDocumentOwnerKey, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { useHyperOrganizationDialogOwner } from './HyperOrganizationOwner';

interface HyperCreateCollectionProps { workspaceId: string; pages: ViewPB[]; onClose(): void; onCreated(view: ViewPB): void }
export function HyperCreateCollectionDialog(props: HyperCreateCollectionProps) {
  const owner = useHyperOrganizationDialogOwner(props.workspaceId, props.onClose);
  return owner ? <HyperCreateCollectionContent key={hyperDocumentOwnerKey(owner)} {...props} owner={owner} /> : null;
}
function HyperCreateCollectionContent({ workspaceId, pages, onClose, onCreated, owner }: HyperCreateCollectionProps & { owner: HyperDocumentOwner }) {
  const t = useHyperCollectionText();
  const [name, setName] = useState(''), [parent, setParent] = useState(workspaceId), [config, setConfig] = useState(hyperDefaultCollection);
  const [section, setSection] = useState(useWorkspaceStore.getState().isCollabWorkspaceOn ? ViewSectionPB.Private : ViewSectionPB.Public);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!owner.isCurrent() || saving) return;
    setSaving(true); setError(null);
    try { const view = await hyperOrganizationService.createCollection(workspaceId, parent, name, config, section, owner); if (owner.isCurrent()) onCreated(view); }
    catch (error) { if (owner.isCurrent()) setError((error as { msg?: string })?.msg ?? (error instanceof Error ? error.message : String(error))); }
    finally { if (owner.isCurrent()) setSaving(false); }
  };
  const parents = [{ value: workspaceId, label: t('workspace') }, ...pages.filter(page => !(page.oneOfIsLocked.case === 'isLocked' && page.oneOfIsLocked.value)).map(page => ({ value: page.id, label: nameOrDefault(page) }))];
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{t('create')}</DialogTitle><DialogDescription>{t('keyHelp')}</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field><FieldLabel htmlFor="hyper-collection-name">{t('name')}</FieldLabel><Input id="hyper-collection-name" autoFocus value={name} onChange={event => setName(event.target.value)} required disabled={saving} /></Field>
      <Select value={parent} disabled={saving} onValueChange={value => { if (value) setParent(value); }} items={parents}><SelectTrigger aria-label={t('parent')}><SelectValue /></SelectTrigger><SelectContent>{parents.map(parent => <SelectItem key={parent.value} value={parent.value}>{parent.label}</SelectItem>)}</SelectContent></Select>
      <Select value={section} disabled={saving} onValueChange={value => { if (value !== null) setSection(value); }} items={[{ value: ViewSectionPB.Public, label: t('public') }, { value: ViewSectionPB.Private, label: t('private') }]}><SelectTrigger aria-label={t('visibility')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ViewSectionPB.Public}>{t('public')}</SelectItem><SelectItem value={ViewSectionPB.Private}>{t('private')}</SelectItem></SelectContent></Select>
      <HyperCollectionEditor value={config} onChange={setConfig} disabled={saving} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button><Button type="submit" disabled={saving}>{t('create')}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
