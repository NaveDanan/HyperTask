import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, Languages } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperGetSelection, hyperSetSelection, type HyperTextSelection } from '../document/HyperDocumentDom';
import { hyperCaptureDocumentCode, hyperCodeSource } from './HyperDocumentCodeModel';
import { hyperCodeLanguage } from './HyperDocumentCodeValue';
import { createHyperDocumentCodeStore, type HyperDocumentCodeStore } from './HyperDocumentCodeStore';
export const hyperDocumentCodeStrings = {
  language: 'Code language', description: 'Choose or enter a language name.', automatic: 'Automatic', storedEmpty: 'Empty language tag', unknown: 'Unknown language format',
  tag: 'Language name', empty: 'No suggested languages', save: 'Save language', saving: 'Saving language…', cancel: 'Cancel', copy: 'Copy code', recovery: 'Copy language recovery details',
} as const;
const suggestions = ['bash', 'css', 'html', 'javascript', 'json', 'markdown', 'python', 'rust', 'sql', 'typescript'];
function useCodeText() { const { tr } = useTr(); return (name: keyof typeof hyperDocumentCodeStrings) => { const key = `hyperDocumentCode.${name}`, value = tr(key); return value === key ? hyperDocumentCodeStrings[name] : value; }; }
export function HyperDocumentCodeControls({ session, document: doc, blockId, editable, isEditable, editorHost, rowScope }: { session: HyperDocumentSession; document: DocumentDataPB; blockId: string; editable: boolean; isEditable(): boolean; editorHost: { current: HTMLElement | null }; rowScope?: { viewId: string; rowId: string } }) {
  const owner = useHyperDocumentOwner(), launch = useAppStore(state => state.launchId), key = hyperDocumentOwnerKey(owner);
  return owner ? <HyperOwnedCodeControls key={JSON.stringify([key, launch, session.id, blockId, rowScope?.viewId, rowScope?.rowId])} owner={owner} session={session} document={doc} blockId={blockId} editable={editable} isEditable={isEditable} editorHost={editorHost} rowScope={rowScope} /> : null;
}
function HyperOwnedCodeControls({ owner, session, document: doc, blockId, editable, isEditable, editorHost, rowScope }: Parameters<typeof HyperDocumentCodeControls>[0] & { owner: NonNullable<ReturnType<typeof useHyperDocumentOwner>> }) {
  const t = useCodeText(), latest = useRef(isEditable); latest.current = isEditable;
  const store = useMemo(() => createHyperDocumentCodeStore({ session, owner, editable: () => latest.current(), rowScope }), [session, owner, rowScope?.viewId, rowScope?.rowId]);
  const [copyError, setCopyError] = useState(''), button = useRef<HTMLButtonElement>(null), restoreTarget = useRef<{ selection: HyperTextSelection | null; source: string } | null>(null);
  useLayoutEffect(() => { store.activate(); return () => store.dispose(); }, [store]);
  let language: string, supported = true;
  try { const value = hyperCodeLanguage(doc.blocks[blockId]).value; language = value === null ? t('automatic') : value || t('storedEmpty'); } catch { language = t('unknown'); supported = false; }
  const restore = () => requestAnimationFrame(() => {
    if (!owner.isCurrent() || !session.isCurrentOwner() || !session.belongsTo(owner)) return;
    const captured = restoreTarget.current, current = session.store.getState().document, element = editorHost.current?.querySelector<HTMLElement>(`[data-hyper-text="${CSS.escape(blockId)}"]`);
    try { if (captured && element && current && hyperCaptureDocumentCode(current, blockId).signature === captured.source) { element.focus(); if (captured.selection) hyperSetSelection(element, captured.selection); return; } } catch { /* The block may have moved or been removed. */ }
    button.current?.focus();
  });
  return <div data-hyper-code-controls={blockId} className="flex flex-wrap items-center gap-1 px-1 text-xs text-muted-foreground">
    <Button ref={button} variant="ghost" size="sm" className="max-w-64 font-normal" aria-label={t('language')} title={language} disabled={!editable || !supported} onMouseDown={event => event.preventDefault()} onClick={() => {
      try { const current = session.store.getState().document, element = editorHost.current?.querySelector<HTMLElement>(`[data-hyper-text="${CSS.escape(blockId)}"]`); restoreTarget.current = current ? { source: hyperCaptureDocumentCode(current, blockId).signature, selection: element ? hyperGetSelection(element) : null } : null; } catch { restoreTarget.current = null; }
      void store.open(blockId);
    }}><Languages /><span className="truncate">{language}</span></Button>
    <Button variant="ghost" size="sm" className="ml-auto font-normal" onMouseDown={event => event.preventDefault()} onClick={() => {
      const scope = hyperCaptureDuplicateOwner(owner); if (!scope?.isCurrent() || !session.belongsTo(scope) || !session.isCurrentOwner()) return;
      try { const current = session.store.getState().document; if (!current) return; hyperCaptureDocumentCode(current, blockId); const source = hyperCodeSource(current, blockId); if (scope.isCurrent()) { window.appflowy.clipboard.writeText(source); setCopyError(''); } } catch (error) { setCopyError(error instanceof Error ? error.message : String(error)); }
    }}><Copy />{t('copy')}</Button>
    {copyError && <Alert variant="warning" className="basis-full"><AlertDescription>{copyError}</AlertDescription></Alert>}
    <HyperCodeLanguageDialog store={store} editable={editable} onDismiss={restore} />
  </div>;
}
function HyperCodeLanguageDialog({ store, editable, onDismiss }: { store: HyperDocumentCodeStore; editable: boolean; onDismiss(): void }) {
  const state = useStore(store), t = useCodeText(), host = useRef<HTMLDivElement>(null), saving = state.status === 'saving', editing = state.status === 'editing';
  useLayoutEffect(() => { if (editing) { const input = host.current?.querySelector('input'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); } }, [state.status]);
  const close = () => { store.close(); onDismiss(); };
  return <Dialog open={state.status !== 'idle'} onOpenChange={open => { if (!open && !saving) close(); }}><DialogContent className="sm:max-w-md" showCloseButton={!saving} finalFocus={false}><DialogHeader><DialogTitle>{t('language')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
    <div ref={host} className="grid gap-3"><Button variant={state.language === null ? 'secondary' : 'outline'} disabled={!editing} className="justify-self-start" onClick={() => store.setLanguage(null)}>{t('automatic')}</Button>
      <Combobox items={suggestions} value={state.language} inputValue={state.language ?? ''} onInputValueChange={value => store.setLanguage(value)} onValueChange={value => { if (value !== null) store.setLanguage(value); }} disabled={!editing}><ComboboxInput aria-label={t('tag')} maxLength={256} /><ComboboxContent><ComboboxEmpty>{t('empty')}</ComboboxEmpty><ComboboxList>{value => <ComboboxItem key={value} value={value}>{value}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox>
    </div>
    {state.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
    <DialogFooter>{state.error && <Button variant="outline" disabled={saving} onClick={() => { const details = store.details(); if (details) window.appflowy.clipboard.writeText(details); }}><Copy />{t('recovery')}</Button>}<Button variant="outline" disabled={saving} onClick={close}>{t('cancel')}</Button><Button disabled={!editable || !editing || !state.dirty} onClick={() => void store.save().then(saved => { if (saved) onDismiss(); })}>{saving ? <Spinner /> : <Languages />}{saving ? t('saving') : t('save')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
