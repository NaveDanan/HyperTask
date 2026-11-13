import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { Copy, Pencil, Sigma } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { HYPER_MATH_FONT_FAMILY_CSS, HYPER_MATH_FONT_MARKER, hyperMathFontCss } from '@shared/HyperMathFont';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperChildren } from '../document/HyperDocumentModel';
import { hyperGetSelection, hyperSetSelection, type HyperTextSelection } from '../document/HyperDocumentDom';
import { hyperCaptureDocumentEquation, hyperCaptureEquationInsertion, hyperReadDocumentEquation, type HyperEquationInsertion } from './HyperDocumentEquationModel';
import { createHyperDocumentEquationStore } from './HyperDocumentEquationStore';
import { hyperRenderEquationMathML } from './HyperDocumentEquationMathML';

export const hyperDocumentEquationStrings = { insert: 'Equation', edit: 'Edit equation', title: 'Equation', description: 'Enter LaTeX without the surrounding $$ delimiters.', source: 'LaTeX source', preview: 'Preview', save: 'Save equation', saving: 'Saving equation…', cancel: 'Cancel', copy: 'Copy equation source', empty: 'Empty equation', unavailable: 'This equation has an unsupported format. Its data was kept.' } as const;
const eventName = 'hyper-equation-open';
export function hyperOpenDocumentEquation(host: HTMLElement, target: { blockId: string } | { insertion: HyperEquationInsertion }) { host.dispatchEvent(new CustomEvent(eventName, { detail: target })); }
function ensureFont() {
  if (document.head.querySelector(`[data-hyper-math-font="${HYPER_MATH_FONT_MARKER}"]`)) return;
  const face = document.createElement('style'); face.dataset.hyperMathFont = HYPER_MATH_FONT_MARKER; face.textContent = hyperMathFontCss(); document.head.append(face);
  const family = document.createElement('style'); family.dataset.hyperMathFamily = ''; family.textContent = `${HYPER_MATH_FONT_FAMILY_CSS}.hyper-document-equation{display:block;margin:1rem 0;overflow-x:auto}`; document.head.append(family);
}
export const hyperEnsureEquationFont = ensureFont;
function useEquationText() { const { tr } = useTr(); return (name: keyof typeof hyperDocumentEquationStrings) => { const key = `hyperDocumentEquation.${name}`, value = tr(key); return value === key ? hyperDocumentEquationStrings[name] : value; }; }
export function HyperDocumentEquationBlock({ document: doc, blockId, editable, onEdit, children }: { document: DocumentDataPB; blockId: string; editable: boolean; onEdit(): void; children?: ReactNode }) {
  const t = useEquationText();
  useLayoutEffect(ensureFont, []);
  const value = useMemo(() => {
    let formula = ''; try { formula = hyperReadDocumentEquation(doc, blockId); } catch { return { formula, structural: false, html: '', error: t('unavailable') }; }
    try { return { formula, structural: true, html: formula ? hyperRenderEquationMathML(formula) : '', error: '' }; }
    catch (error) { return { formula, structural: true, html: '', error: error instanceof Error ? error.message : String(error) }; }
  }, [doc, blockId]);
  return <div data-hyper-equation-block={blockId} className="my-4 min-w-0">
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {value.error ? <Alert variant="destructive"><AlertDescription><p>{value.error}</p>{value.formula && <pre className="max-h-48 w-full overflow-auto whitespace-pre-wrap font-mono text-xs">{value.formula}</pre>}</AlertDescription></Alert> : value.html ? <div className="hyper-document-equation" data-hyper-equation="mathml" dangerouslySetInnerHTML={{ __html: value.html }} /> : <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{t('empty')}</p>}
      </div>
      {editable && value.structural && <Button variant="ghost" size="icon-sm" data-hyper-equation-edit={blockId} aria-label={t('edit')} onClick={onEdit}><Pencil /></Button>}
    </div>
    {!value.structural && children}
  </div>;
}
export function HyperDocumentEquation({ session, editable, isEditable, editorHost, onPrepareInsert, rowScope, onApplied }: { session: HyperDocumentSession; editable: boolean; isEditable(): boolean; editorHost: { current: HTMLElement | null }; onPrepareInsert?(): HyperEquationInsertion | null; rowScope?: { viewId: string; rowId: string }; onApplied?(focus: { id: string; offset: number }): void }) {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner), latest = useRef({ isEditable, onPrepareInsert }); latest.current = { isEditable, onPrepareInsert };
  const returnFocus = useRef<{ element: HTMLElement; selection: HyperTextSelection | null } | null>(null);
  const store = useMemo(() => owner ? createHyperDocumentEquationStore({ session, owner, editable: () => latest.current.isEditable(), rowScope }) : null, [session, key, rowScope?.viewId, rowScope?.rowId]);
  const t = useEquationText();
  const openTarget = (target: ReturnType<typeof hyperCaptureDocumentEquation> | HyperEquationInsertion) => {
    const id = 'blockId' in target ? target.blockId : target.previousId;
    const element = editorHost.current?.querySelector<HTMLElement>(`[data-hyper-equation-edit="${CSS.escape(id)}"],[data-hyper-text="${CSS.escape(id)}"]`);
    returnFocus.current = element ? { element, selection: element.hasAttribute('data-hyper-text') ? hyperGetSelection(element) : null } : null;
    if (returnFocus.current && 'slash' in target && target.slash && !returnFocus.current.selection) returnFocus.current.selection = { start: target.slash.query.length + 1, end: target.slash.query.length + 1 };
    void store?.open(target);
  };
  const restore = () => { const captured = returnFocus.current; requestAnimationFrame(() => { if (captured?.element.isConnected && owner?.isCurrent()) { captured.element.focus(); if (captured.selection) hyperSetSelection(captured.element, captured.selection); } }); };
  useLayoutEffect(() => {
    if (!store) return; store.activate(); ensureFont(); return () => { store.dispose(); returnFocus.current = null; };
  }, [store]);
  useEffect(() => {
    if (!store) return;
    const host = editorHost.current;
    const open = (event: Event) => {
      if (!latest.current.isEditable()) return;
      try {
        const detail = (event as CustomEvent<{ blockId?: string; insertion?: HyperEquationInsertion }>).detail, doc = session.store.getState().document;
        if (!doc) throw new Error(t('unavailable'));
        const target = detail.blockId ? hyperCaptureDocumentEquation(doc, detail.blockId) : detail.insertion;
        if (target) openTarget(target);
      } catch (error) { store.fail(error); }
    };
    host?.addEventListener(eventName, open);
    return () => { host?.removeEventListener(eventName, open); };
  }, [store, session, editorHost]);
  return store && owner?.isCurrent() ? <HyperEquationControl store={store} editable={editable} onInsert={() => {
    try { const doc = session.store.getState().document; if (!doc) throw new Error(t('unavailable')); const target = latest.current.onPrepareInsert ? latest.current.onPrepareInsert() : hyperCaptureEquationInsertion(doc, hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? ''); if (target) openTarget(target); }
    catch (error) { store.fail(error); }
  }} onApplied={onApplied} onDismiss={restore} /> : null;
}
function HyperEquationControl({ store, editable, onInsert, onApplied, onDismiss }: { store: ReturnType<typeof createHyperDocumentEquationStore>; editable: boolean; onInsert(): void; onApplied?(focus: { id: string; offset: number }): void; onDismiss(): void }) {
  const state = useStore(store), t = useEquationText(), busy = state.status === 'loading' || state.status === 'saving';
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (state.status === 'editing') { input.current?.focus(); input.current?.setSelectionRange(input.current.value.length, input.current.value.length); } }, [state.status]);
  const preview = useMemo(() => { try { return { html: state.formula ? hyperRenderEquationMathML(state.formula) : '', error: '' }; } catch (error) { return { html: '', error: error instanceof Error ? error.message : String(error) }; } }, [state.formula]);
  return <><Button variant="ghost" size="sm" disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={onInsert}><Sigma />{t('insert')}</Button>
    <Dialog open={state.status !== 'idle'} onOpenChange={open => { if (!open && !busy) { store.close(); onDismiss(); } }}><DialogContent className="sm:max-w-2xl" showCloseButton={!busy} finalFocus={false}><DialogHeader><DialogTitle>{t('title')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">{t('source')}<Textarea ref={input} aria-label={t('source')} className="min-h-32 font-mono text-sm" value={state.formula} disabled={busy || state.status === 'error' || state.status === 'partial'} onChange={event => store.setFormula(event.currentTarget.value)} /></label>
      {state.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
      {preview.error ? <Alert variant="destructive"><AlertDescription>{preview.error}</AlertDescription></Alert> : <div role="region" aria-label={t('preview')} className="max-h-64 overflow-auto rounded-lg border p-3"><div className="hyper-document-equation" data-hyper-equation="mathml" dangerouslySetInnerHTML={{ __html: preview.html }} /></div>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => window.appflowy.clipboard.writeText(state.formula)}><Copy />{t('copy')}</Button><Button variant="outline" disabled={busy} onClick={() => { store.close(); onDismiss(); }}>{t('cancel')}</Button><Button disabled={!editable || busy || state.status !== 'editing' || !!preview.error || !state.formula.trim()} onClick={() => void store.save().then(focus => { if (focus) onApplied?.(focus); })}>{busy ? <Spinner /> : <Sigma />}{state.status === 'saving' ? t('saving') : t('save')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
