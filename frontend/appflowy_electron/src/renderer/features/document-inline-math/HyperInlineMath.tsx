import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { Copy, Sigma } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperBlockText } from '../document/HyperDocumentModel';
import { hyperGetSelection, hyperReadText, hyperSetSelection } from '../document/HyperDocumentDom';
import { hyperEnsureEquationFont } from '../document-equation/HyperDocumentEquation';
import { hyperRenderInlineEquationMathML } from '../document-equation/HyperDocumentEquationMathML';
import { hyperCaptureInlineMath, type HyperInlineMathAnchor } from './HyperInlineMathModel';
import { hyperInlineMathAtomAt, hyperInlineMathDomSource, hyperInlineMathMalformedAt } from './HyperInlineMathDom';
import { createHyperInlineMathStore, type HyperInlineMathStore } from './HyperInlineMathStore';
import { hyperInlineMathStrings, useHyperInlineMathText } from './HyperInlineMathStrings';
import { HYPER_INLINE_MATH_SOURCE_LIMIT } from './HyperInlineMathValue';

const subscribeOwner = (change: () => void) => { const app = useAppStore.subscribe(change), workspace = useWorkspaceStore.subscribe(change); return () => { app(); workspace(); }; };
const ownerVersion = () => hyperDocumentDuplicateBackend.ownerVersion?.() ?? 0;
export function HyperInlineMath({ session, editable, isEditable, composing = false, editorHost, rowScope, onPrepare, onApplied }: {
  session: HyperDocumentSession; editable: boolean; isEditable(): boolean; editorHost: { current: HTMLElement | null };
  composing?: boolean;
  rowScope?: { viewId: string; rowId: string }; onPrepare(): HyperInlineMathAnchor;
  onApplied(focus: { id: string; offset: number }): void;
}) {
  const owner = useHyperDocumentOwner(), version = useSyncExternalStore(subscribeOwner, ownerVersion, ownerVersion), latest = useRef({ isEditable, onPrepare, composing }); latest.current = { isEditable, onPrepare, composing };
  const store = useMemo(() => owner ? createHyperInlineMathStore({ session, owner, editable: () => latest.current.isEditable(), rowScope }) : null, [session, owner, version, rowScope?.viewId, rowScope?.rowId]);
  const text = useHyperInlineMathText(), restore = useRef<{ element: HTMLElement; start: number; end: number } | null>(null);
  useLayoutEffect(() => { if (!store) return; store.activate(); hyperEnsureEquationFont(); return () => { store.dispose(); restore.current = null; }; }, [store]);
  const open = (target: HyperInlineMathAnchor) => {
    const element = [...editorHost.current?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []].find(node => node.dataset.hyperText === target.blockId);
    const selection = element && hyperGetSelection(element);
    restore.current = element ? { element, start: selection?.start ?? target.start, end: selection?.end ?? target.end } : null;
    void store?.open(target);
  };
  useEffect(() => {
    if (!store) return; const host = editorHost.current;
    const click = (event: MouseEvent) => {
      const atom = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-hyper-inline-math]') : null;
      if (!atom || !host?.contains(atom) || latest.current.composing) return;
      event.preventDefault(); event.stopPropagation();
      try {
        const element = atom.closest<HTMLElement>('[data-hyper-text]'), doc = session.store.getState().document, block = element?.dataset.hyperText && doc?.blocks[element.dataset.hyperText];
        if (!element || !doc || !block || block.ty === 'code') return;
        const runs = hyperBlockText(doc, block);
        // A pending DOM edit must not use offsets from an older saved snapshot.
        if (element.isContentEditable && hyperInlineMathDomSource(hyperReadText(element)) !== hyperInlineMathDomSource(runs)) throw Error('changed');
        const ordinal = [...element.querySelectorAll('[data-hyper-inline-math]')].indexOf(atom), entry = atom.dataset.hyperInlineMathMalformed !== undefined ? hyperInlineMathMalformedAt(runs) : hyperInlineMathAtomAt(runs, ordinal);
        if (!entry) throw Error('changed');
        open(hyperCaptureInlineMath(doc, block.id, entry.offset));
      } catch (error) { store.fail(error); }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || !['Enter', ' '].includes(event.key) || !(event.target instanceof HTMLElement) || !event.target.matches('[data-hyper-inline-math]')) return;
      event.preventDefault(); event.stopPropagation(); event.target.click();
    };
    host?.addEventListener('click', click); host?.addEventListener('keydown', keyboard, true);
    return () => { host?.removeEventListener('click', click); host?.removeEventListener('keydown', keyboard, true); };
  }, [store, session, editorHost]);
  if (!store || !store.isCurrent()) return null;
  return <><Button type="button" variant="ghost" size="sm" disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => { try { if (latest.current.isEditable()) open(latest.current.onPrepare()); } catch (error) { store.fail(error); } }}><Sigma />{text('insert')}</Button>
    <HyperInlineMathDialog store={store} editable={editable} onApplied={onApplied} onDismiss={() => {
      const selection = store.close(), captured = restore.current; restore.current = null;
      if (!selection || !captured) return;
      requestAnimationFrame(() => { if (store.isCurrent() && captured.element.isConnected) { captured.element.focus(); hyperSetSelection(captured.element, { start: captured.start, end: captured.end }); } });
    }} /></>;
}
function HyperInlineMathDialog({ store, editable, onApplied, onDismiss }: { store: HyperInlineMathStore; editable: boolean; onApplied(focus: { id: string; offset: number }): void; onDismiss(): void }) {
  const state = useStore(store), text = useHyperInlineMathText(), input = useRef<HTMLTextAreaElement>(null), [copyError, setCopyError] = useState('');
  const busy = state.status === 'loading' || state.status === 'saving', locked = state.status !== 'editing' || !editable;
  useLayoutEffect(() => { setCopyError(''); if (state.status === 'editing') { input.current?.focus(); input.current?.setSelectionRange(0, input.current.value.length); } }, [state.status]);
  const preview = useMemo(() => {
    if (!state.supported) return { html: '', error: '' };
    try { return { html: state.formula ? hyperRenderInlineEquationMathML(state.formula) : '', error: '' }; } catch (error) { return { html: '', error: error instanceof Error ? error.message : String(error) }; }
  }, [state.formula, state.supported]);
  const explain = (error: string) => Object.hasOwn(hyperInlineMathStrings, error) ? text(error as keyof typeof hyperInlineMathStrings) : error;
  const copy = (source: string) => { try { window.appflowy.clipboard.writeText(source); } catch { setCopyError('copyFailed'); } };
  return <Dialog open={state.status !== 'idle'} onOpenChange={open => { if (!open && !busy) onDismiss(); }}><DialogContent className="sm:max-w-xl" showCloseButton={!busy} finalFocus={false}>
    <DialogHeader><DialogTitle>{text('title')}</DialogTitle><DialogDescription>{text('description')}</DialogDescription></DialogHeader>
    <label className="grid gap-2 text-sm">{text('source')}<Textarea ref={input} aria-label={text('source')} className="min-h-24 font-mono text-sm" value={(state.supported ? state.formula : state.source).slice(0, HYPER_INLINE_MATH_SOURCE_LIMIT)} maxLength={HYPER_INLINE_MATH_SOURCE_LIMIT} readOnly={locked} disabled={busy} onChange={event => store.setFormula(event.currentTarget.value)} /></label>
    {state.source.length > HYPER_INLINE_MATH_SOURCE_LIMIT && <p className="text-xs text-muted-foreground">{text('sourceTruncated')}</p>}
    {locked && !busy && state.status !== 'partial' && <Alert variant="info"><AlertDescription>{text(state.error === 'overflow' ? 'overflow' : state.supported ? 'readOnly' : 'unsupported')}</AlertDescription></Alert>}
    {state.status === 'partial' && <Alert variant="destructive"><AlertDescription>{text('partial')}</AlertDescription></Alert>}
    {(state.error || copyError || preview.error) && <Alert variant="destructive"><AlertDescription>{explain(copyError || state.error || preview.error)}</AlertDescription></Alert>}
    {state.supported && !preview.error && <div role="region" aria-label={text('preview')} className="max-h-48 overflow-auto rounded-lg border p-3">{preview.html ? <span className="hyper-document-inline-equation" dangerouslySetInnerHTML={{ __html: preview.html }} /> : <span className="text-sm text-muted-foreground">{text('empty')}</span>}</div>}
    <DialogFooter className="flex-wrap"><Button type="button" variant="outline" disabled={busy} onClick={() => copy(state.source)}><Copy />{text('copy')}</Button>
      {state.status === 'partial' && <Button type="button" variant="outline" onClick={() => copy(state.recovery)}>{text('copyRecovery')}</Button>}
      <Button type="button" variant="outline" disabled={busy} onClick={onDismiss}>{text('cancel')}</Button>
      {!locked && state.existing && <Button type="button" variant="ghost" onClick={() => void store.unwrap().then(focus => { if (focus && store.isCurrent()) onApplied(focus); })}>{text('unwrap')}</Button>}
      {!locked && <Button type="button" disabled={!!preview.error || !state.formula.trim() || state.existing && !state.changed} onClick={() => void store.save().then(focus => { if (focus && store.isCurrent()) onApplied(focus); })}>{state.status === 'saving' ? <Spinner /> : null}{text('save')}</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
