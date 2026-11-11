import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, ArrowUp, CornerDownRight, CornerUpLeft, GripVertical, Trash2 } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { hyperGetSelection, hyperSetSelection } from '../document/HyperDocumentDom';
import type { HyperDocumentChange } from '../document/HyperDocumentModel';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperAvailableDocumentBlockCommands, hyperBlockChildTypes, hyperCanDropDocumentBlock, hyperCaptureDocumentBlock, hyperDocumentBlockCommand, hyperDocumentBlockLabel, hyperMoveDocumentBlock, type HyperBlockCapture, type HyperBlockCommand, type HyperBlockPlacement } from './HyperDocumentBlockControlsModel';
import { hyperBeginBlockDrag, hyperBlockDragMime, hyperBlockDragPayload, hyperCurrentBlockDrag, hyperEndBlockDrag, hyperReadBlockDrag, type HyperBlockDrag } from './HyperDocumentBlockDrag';

export const hyperDocumentBlockControlStrings = {
  actions: 'Block actions', drag: 'Drag to move this block, or open the menu to move it with the keyboard.',
  up: 'Move up', down: 'Move down', indent: 'Indent block', outdent: 'Outdent block', delete: 'Delete block',
} as const;
interface HyperDocumentBlockControlsProps {
  session: HyperDocumentSession;
  document: DocumentDataPB;
  blockId: string;
  editorHost: RefObject<HTMLElement | null>;
  editable: boolean;
  isEditable(): boolean;
  onError(message: string): void;
  children: ReactNode;
}
function selection(host: HTMLElement | null): HyperBlockDrag['focus'] {
  for (const element of host?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []) {
    const value = hyperGetSelection(element);
    if (value) return { id: element.dataset.hyperText!, ...value };
  }
  return undefined;
}
export function HyperDocumentBlockControls({ session, document: rendered, blockId, editorHost, editable, isEditable, onError, children }: HyperDocumentBlockControlsProps) {
  const { tr } = useTr(), hintId = useId();
  const text = (key: keyof typeof hyperDocumentBlockControlStrings) => { const id = `hyperDocumentBlockControls.${key}`, translated = tr(id); return translated === id ? hyperDocumentBlockControlStrings[key] : translated; };
  const [open, setOpen] = useState(false), [capture, setCapture] = useState<HyperBlockCapture | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [placement, setPlacement] = useState<HyperBlockPlacement | null>(null);
  const root = useRef<HTMLDivElement>(null), focus = useRef<HyperBlockDrag['focus']>(undefined), dragging = useRef<HyperBlockDrag | null>(null);
  const mounted = useRef(true), allowed = useRef(editable); allowed.current = editable;
  const allowedNow = useRef(isEditable); allowedNow.current = isEditable;
  const current = useRef(rendered); current.current = rendered;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (dragging.current) hyperEndBlockDrag(dragging.current); }; }, [session, blockId]);
  useEffect(() => { if (!editable) { setOpen(false); setPlacement(null); if (dragging.current) hyperEndBlockDrag(dragging.current); } }, [editable]);
  const requireEditable = () => { if (!mounted.current || !allowedNow.current() || !session.isCurrentOwner()) throw new Error('The document or edit permission changed.'); };
  const focusElement = (afterMove = false) => {
    if (!allowedNow.current() || !afterMove && !mounted.current || !editorHost.current?.isConnected || !session.isCurrentOwner()) return null;
    const element = focus.current && Array.from(editorHost.current.querySelectorAll<HTMLElement>('[data-hyper-text]')).find(element => element.dataset.hyperText === focus.current!.id);
    if (element && focus.current) { element.focus(); hyperSetSelection(element, focus.current); return element; }
    const fallback = editorHost.current.querySelector<HTMLElement>('[data-hyper-block-add]'); fallback?.focus(); return fallback;
  };
  const apply = async (build: (doc: DocumentDataPB) => HyperDocumentChange, savedFocus = focus.current) => {
    try {
      requireEditable(); setBusy(true); setError('');
      const changed = session.change(doc => { requireEditable(); return build(doc); });
      if (!changed) throw new Error('The block could not be changed.');
      focus.current = savedFocus && changed.document.blocks[savedFocus.id] ? savedFocus : changed.focus ? { id: changed.focus.id, start: changed.focus.offset, end: changed.focus.offset } : undefined;
      await session.flush();
      if (mounted.current) setOpen(false);
      requestAnimationFrame(() => { focusElement(true); });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mounted.current) setError(message); onError(message);
    } finally { if (mounted.current) setBusy(false); }
  };
  const targetPlacement = (event: DragEvent) => {
    const rectangle = root.current!.getBoundingClientRect(), y = event.clientY;
    if (hyperBlockChildTypes.has(rendered.blocks[blockId]?.ty ?? '') && event.clientX > rectangle.left + 24 && y > rectangle.top + rectangle.height * 0.25 && y < rectangle.bottom - rectangle.height * 0.25) return 'inside';
    return y < rectangle.top + rectangle.height / 2 ? 'before' : 'after';
  };
  const ownTarget = (event: DragEvent) => event.target instanceof Element && event.target.closest('[data-hyper-block-control]') === root.current;
  const endDrag = () => { if (dragging.current) hyperEndBlockDrag(dragging.current); dragging.current = null; setPlacement(null); };
  const available = open && capture ? hyperAvailableDocumentBlockCommands(rendered, capture) : [];
  const icons = { up: ArrowUp, down: ArrowDown, indent: CornerDownRight, outdent: CornerUpLeft, delete: Trash2 };
  return <div ref={root} data-hyper-block-control={blockId} aria-busy={busy} className="group/hyper-block relative" onDragOver={event => {
    if (!ownTarget(event) || !allowed.current || busy || !event.dataTransfer.types.includes(hyperBlockDragMime)) return;
    const dragged = hyperCurrentBlockDrag(session, session.id), position = targetPlacement(event);
    if (!dragged || !hyperCanDropDocumentBlock(rendered, dragged.source.blockId, blockId, position)) { setPlacement(null); event.dataTransfer.dropEffect = 'none'; return; }
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setPlacement(position);
    let parent = root.current?.parentElement;
    while (parent && parent !== editorHost.current) {
      if (parent.scrollHeight > parent.clientHeight && /(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        const rectangle = parent.getBoundingClientRect();
        if (event.clientY < rectangle.top + 32) parent.scrollTop -= 20;
        else if (event.clientY > rectangle.bottom - 32) parent.scrollTop += 20;
        break;
      }
      parent = parent.parentElement;
    }
  }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setPlacement(null); }} onDrop={event => {
    if (!ownTarget(event) || !event.dataTransfer.types.includes(hyperBlockDragMime)) return;
    event.preventDefault(); event.stopPropagation(); setPlacement(null);
    try {
      requireEditable(); const dragged = hyperReadBlockDrag(session, session.id, event.dataTransfer.getData(hyperBlockDragMime));
      const target = hyperCaptureDocumentBlock(current.current, blockId), position = targetPlacement(event);
      hyperEndBlockDrag(dragged); void apply(doc => hyperMoveDocumentBlock(doc, dragged.source, target, position, allowedNow.current()), dragged.focus);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }}>
    {editable && <DropdownMenu modal={false} open={open} onOpenChange={next => {
      if (!next) { if (!busy) setOpen(false); return; }
      if (hyperCurrentBlockDrag(session, session.id)) return;
      dragging.current = null;
      try { requireEditable(); const document = session.store.getState().document; if (!document) return; focus.current = selection(editorHost.current) ?? focus.current; setCapture(hyperCaptureDocumentBlock(document, blockId)); setError(''); setOpen(true); }
      catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    }}><DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="absolute top-1 -left-7 opacity-0 group-hover/hyper-block:opacity-100 group-focus-within/hyper-block:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" aria-label={`${text('actions')}: ${hyperDocumentBlockLabel(rendered, blockId)}`} aria-describedby={hintId} title={text('drag')} disabled={busy} draggable={!busy} onPointerDown={() => { focus.current = selection(editorHost.current); }} onDragStart={event => {
      event.stopPropagation();
      try {
        requireEditable(); const document = session.store.getState().document; if (!document) { event.preventDefault(); return; }
        // The same grip opens a keyboard menu on pointer-down. Release that popup's
        // focus/pointer layer as soon as Chromium starts an actual drag gesture.
        const captured = hyperCaptureDocumentBlock(document, blockId);
        const savedFocus = selection(editorHost.current) ?? focus.current;
        dragging.current = hyperBeginBlockDrag(session, session.id, captured, savedFocus);
        flushSync(() => setOpen(false));
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(hyperBlockDragMime, hyperBlockDragPayload(dragging.current));
      } catch (error) { event.preventDefault(); onError(error instanceof Error ? error.message : String(error)); }
    }} onDragEnd={endDrag} />}><GripVertical /></DropdownMenuTrigger>
      {!dragging.current && <DropdownMenuContent className="w-48" finalFocus={() => dragging.current ? false : focusElement() ?? true}>{(['up', 'down', 'indent', 'outdent', 'delete'] as HyperBlockCommand[]).map(command => {
        const Icon = icons[command]; return <DropdownMenuItem key={command} disabled={busy || !available.includes(command)} variant={command === 'delete' ? 'destructive' : 'default'} closeOnClick={false} onClick={() => { if (capture) void apply(doc => hyperDocumentBlockCommand(doc, capture, command, allowedNow.current())); }}><Icon />{text(command)}</DropdownMenuItem>;
      })}{error && <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p>}</DropdownMenuContent>}
    </DropdownMenu>}
    <span id={hintId} className="sr-only">{text('drag')}</span>
    {placement && <span aria-hidden className={cn('pointer-events-none absolute z-10 bg-primary', placement === 'before' ? 'inset-x-0 top-0 h-0.5' : placement === 'after' ? 'inset-x-0 bottom-0 h-0.5' : 'inset-0 rounded-md bg-primary/5 ring-1 ring-primary')} />}
    {children}
  </div>;
}
