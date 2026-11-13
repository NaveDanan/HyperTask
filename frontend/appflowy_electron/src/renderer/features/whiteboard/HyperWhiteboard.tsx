import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useStore } from 'zustand';
import { ChevronLeft, ChevronRight, Circle, Download, FileText, Frame, GitBranch, Hand, MousePointer2, Pencil, Play, Plus, Redo2, Square, Trash2, Type, Undo2, X, ZoomIn, ZoomOut, MoveUpRight } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import type { HyperDocumentChange } from '../document/HyperDocumentModel';
import { HyperCanvasAI } from '../canvas-ai/HyperCanvasAI';
import { HyperCanvasImageAI } from '../canvas-ai/HyperCanvasImageAI';
import {
  hyperCanvasColors, hyperCanvasConnector, hyperCanvasGeometry, hyperCanvasHitTest, hyperCanvasLabel, hyperCanvasPaintOrder, hyperCanvasStrokeGeometry,
  hyperDeleteCanvasElement, hyperEditCanvasLabel, hyperInsertCanvasElement, hyperReadCanvas, hyperUpdateCanvasElement,
  type HyperCanvasColor, type HyperCanvasElement, type HyperCanvasKind, type HyperCanvasPoint,
} from './HyperWhiteboardModel';
import { hyperAddMindMapChild, hyperCanvasFitFrame, hyperCanvasFrameContents, hyperCanvasGroupMembers, hyperCanvasMoveGroup, hyperDeleteMindMapBranch, hyperInsertMindMap } from './HyperWhiteboardFeatures';
import { hyperExportWhiteboardPNG, hyperExportWhiteboardSVG, hyperPrepareWhiteboardExport, hyperResolveWhiteboardTheme } from './HyperWhiteboardExport';

export const hyperWhiteboardStrings = {
  canvas: 'Canvas', select: 'Select', pan: 'Pan', rectangle: 'Rectangle', ellipse: 'Ellipse', text: 'Text', pen: 'Pen',
  connector: 'Connector', frame: 'Frame', note: 'Note', add: 'Add at center', delete: 'Delete selected element',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset view', undo: 'Undo', redo: 'Redo', label: 'Element text',
  color: 'Element color', width: 'Width', height: 'Height', elements: 'Canvas elements', empty: 'Choose a drawing tool and drag on the canvas, or use Add at center.',
  unsupported: 'Some canvas elements cannot be displayed. Their stored data is preserved.',
  hint: 'Drag to draw or move. Use the arrow keys to move a selected element, Shift for larger steps. Delete removes it. Escape clears selection.',
  readOnly: 'This canvas is read-only.', foreground: 'Default', primary: 'Accent', info: 'Info', success: 'Success', warning: 'Warning', destructive: 'Destructive',
  present: 'Present frames', previousFrame: 'Previous frame', nextFrame: 'Next frame', exitPresentation: 'Exit presentation',
  exportSVG: 'Export SVG', exportPNG: 'Export PNG', exporting: 'Exporting…', mindMap: 'Mind map',
  outline: 'Topics', outlineHelp: 'Enter one topic per line. Use one root topic and indent children with two spaces per level.',
  createMindMap: 'Create mind map', childTopic: 'Child topic', addChild: 'Add child topic',
  image: 'Image', imageAlt: 'Image description', imageLoading: 'Loading image…', imageMissing: 'Image unavailable',
} as const;
const tools = [['select', MousePointer2], ['pan', Hand], ['rectangle', Square], ['ellipse', Circle], ['text', Type], ['note', FileText], ['pen', Pencil], ['connector', MoveUpRight], ['frame', Frame]] as const;
const colors: Record<HyperCanvasColor, string> = { foreground: 'text-foreground', primary: 'text-primary', info: 'text-info', success: 'text-success', warning: 'text-warning', destructive: 'text-destructive' };
type Gesture = { start: HyperCanvasPoint; screen: HyperCanvasPoint; kind: 'pan' | 'move' | 'draw'; element?: HyperCanvasElement; points: HyperCanvasPoint[] };

export function HyperWhiteboard({ session, editable }: { session: HyperDocumentSession; editable: boolean }) {
  const { tr } = useTr(), state = useStore(session.store);
  const t = (key: keyof typeof hyperWhiteboardStrings) => { const translated = tr(`hyperWhiteboard.${key}`); return translated === `hyperWhiteboard.${key}` ? hyperWhiteboardStrings[key] : translated; };
  const [tool, setTool] = useState<typeof tools[number][0]>('select');
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [view, setView] = useState({ x: 80, y: 80, zoom: 1 });
  const [preview, setPreview] = useState<HyperCanvasElement | null>(null);
  const [presenting, setPresenting] = useState<string | null>(null), [exporting, setExporting] = useState(false);
  const [mindMapOpen, setMindMapOpen] = useState(false), [outline, setOutline] = useState('Topic\n  Idea\n  Next steps');
  const [childTopic, setChildTopic] = useState('');
  const savedView = useRef(view);
  const svg = useRef<SVGSVGElement>(null), gesture = useRef<Gesture | null>(null);
  const snapshot = state.document ? hyperReadCanvas(state.document) : { elements: [], unsupportedIds: [] };
  const previewOriginal = preview && snapshot.elements.find(element => element.id === preview.id);
  const previewGroup = previewOriginal ? new Set(hyperCanvasGroupMembers(previewOriginal, snapshot.elements).map(element => element.id)) : new Set<string>();
  const elements = snapshot.elements.map(element => preview?.id === element.id ? preview : preview && previewOriginal && previewGroup.has(element.id) ? { ...element, x: element.x + preview.x - previewOriginal.x, y: element.y + preview.y - previewOriginal.y } : element);
  if (preview && !elements.some(element => element.id === preview.id)) elements.push(preview);
  const current = snapshot.elements.find(element => element.id === selected);
  const frames = snapshot.elements.filter(element => element.kind === 'frame' && element.width > 0 && element.height > 0);
  const frameIndex = frames.findIndex(frame => frame.id === presenting);
  const slideIds = frameIndex >= 0 ? new Set([frames[frameIndex].id, ...hyperCanvasFrameContents(frames[frameIndex], elements).map(element => element.id)]) : null;
  const visibleElements = slideIds ? elements.filter(element => slideIds.has(element.id)) : elements;
  const canEdit = editable && presenting === null && state.document !== null && state.status !== 'error' && state.status !== 'loading' && !state.historyPending;
  const exitPresentation = () => { setPresenting(null); setView(savedView.current); };
  useEffect(() => {
    if (!presenting) return;
    const frame = frames.find(frame => frame.id === presenting);
    if (!frame) { exitPresentation(); return; }
    const fit = () => {
      const rect = svg.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) setView(hyperCanvasFitFrame(frame, rect));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (svg.current) observer.observe(svg.current);
    const keys = (event: KeyboardEvent) => {
      if (['Escape', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') exitPresentation();
        else {
          const direction = ['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 1;
          const next = frames[frameIndex + direction]; if (next) setPresenting(next.id);
        }
      }
    };
    document.addEventListener('keydown', keys, true);
    return () => { observer.disconnect(); document.removeEventListener('keydown', keys, true); };
  }, [presenting, frameIndex, frames.map(frame => `${frame.id}:${frame.x}:${frame.y}:${frame.width}:${frame.height}`).join('|')]);
  const change = (build: (doc: NonNullable<typeof state.document>) => HyperDocumentChange) => {
    if (!canEdit) return null;
    try { setError(null); return session.change(build); } catch (error) { setError(error instanceof Error ? error.message : String(error)); return null; }
  };
  const deleteCurrent = () => {
    if (current) change(doc => current.mindMapRootId && current.kind !== 'connector' ? hyperDeleteMindMapBranch(doc, current.id) : hyperDeleteCanvasElement(doc, current.id));
    setSelected(null);
  };
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom };
  };
  const zoom = (factor: number) => setView(previous => {
    const rect = svg.current?.getBoundingClientRect(), next = Math.max(0.1, Math.min(8, previous.zoom * factor));
    const x = (rect?.width ?? 800) / 2, y = (rect?.height ?? 600) / 2;
    return { x: x - (x - previous.x) * next / previous.zoom, y: y - (y - previous.y) * next / previous.zoom, zoom: next };
  });
  const insert = (kind: HyperCanvasKind, start: HyperCanvasPoint, end: HyperCanvasPoint, points: HyperCanvasPoint[] = []) => {
    const stroke = kind === 'pen' ? [start, ...points, end] : [];
    const geometry = stroke.length ? hyperCanvasStrokeGeometry(stroke) : hyperCanvasGeometry(start, end);
    const tap = geometry.width < 3 && geometry.height < 3;
    if (tap) Object.assign(geometry, { width: kind === 'frame' ? 320 : 160, height: kind === 'frame' ? 240 : 80 });
    const from = kind === 'connector' ? hyperCanvasHitTest(snapshot.elements, start) : undefined;
    const to = kind === 'connector' ? hyperCanvasHitTest(snapshot.elements, end) : undefined;
    const normalized = kind === 'connector' ? [start, tap ? { x: start.x + geometry.width, y: start.y + geometry.height } : end]
      : kind === 'pen' ? tap ? [start, { x: start.x + geometry.width, y: start.y + geometry.height }] : stroke : points;
    const result = change(doc => hyperInsertCanvasElement(doc, kind, geometry, { text: kind === 'text' ? t('text') : '', points: normalized.map(p => ({ x: p.x - geometry.x, y: p.y - geometry.y })), fromId: from?.id, toId: to?.id }));
    if (result?.focus) setSelected(result.focus.id);
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (presenting) return;
    if (event.button !== 0 && event.button !== 1) return;
    const start = point(event), target = (event.target as Element).closest('[data-canvas-id]')?.getAttribute('data-canvas-id');
    const element = snapshot.elements.find(element => element.id === target);
    if (tool === 'pan' || event.button === 1) gesture.current = { kind: 'pan', start: { x: view.x, y: view.y }, screen: { x: event.clientX, y: event.clientY }, points: [] };
    else if (tool === 'select') { setSelected(element?.id ?? null); if (element && canEdit) gesture.current = { kind: 'move', start, screen: start, element, points: [] }; }
    else if (canEdit) gesture.current = { kind: 'draw', start, screen: start, points: [start] };
    if (gesture.current) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g) return;
    if (g.kind === 'pan') { setView(previous => ({ ...previous, x: g.start.x + event.clientX - g.screen.x, y: g.start.y + event.clientY - g.screen.y })); return; }
    const end = point(event);
    if (g.kind === 'move' && g.element) setPreview({ ...g.element, x: g.element.x + end.x - g.start.x, y: g.element.y + end.y - g.start.y });
    else {
      if (tool === 'pen') {
        const previous = g.points.at(-1)!;
        if (g.points.length < 10000 && Math.hypot(end.x - previous.x, end.y - previous.y) >= 0.5) g.points.push(end);
      }
      const geometry = hyperCanvasGeometry(g.start, end);
      const points = tool === 'pen' ? g.points : [g.start, end];
      setPreview({ id: 'preview', kind: tool as HyperCanvasKind, ...geometry, text: '', color: 'foreground', points: points.map(p => ({ x: p.x - geometry.x, y: p.y - geometry.y })) });
    }
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; gesture.current = null;
    if (!g) return;
    const end = point(event);
    if (g.kind === 'move' && g.element) change(doc => hyperCanvasMoveGroup(doc, g.element!.id, g.element!.x + end.x - g.start.x, g.element!.y + end.y - g.start.y));
    if (g.kind === 'draw') insert(tool as HyperCanvasKind, g.start, end, tool === 'pen' ? [...g.points, end] : []);
    setPreview(null);
  };
  const exportCanvas = async (format: 'svg' | 'png') => {
    if (!state.document || exporting) return;
    setExporting(true); setError(null);
    try {
      await session.flush();
      const doc = session.store.getState().document!;
      const options = await hyperPrepareWhiteboardExport(doc, { ...hyperResolveWhiteboardTheme(svg.current!.parentElement!), ...(presenting ? { frameId: presenting } : {}) });
      if (!session.isCurrentOwner()) throw new Error('The canvas workspace or account changed.');
      const content = format === 'svg' ? hyperExportWhiteboardSVG(doc, options) : await hyperExportWhiteboardPNG(doc, options);
      const path = await window.appflowy.dialog.saveFile({ defaultPath: `HyperTask-canvas.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
      if (!path) return;
      if (!session.isCurrentOwner()) throw new Error('The canvas workspace or account changed.');
      if (typeof content === 'string') await window.appflowy.fs.writeText(path, content);
      else await window.appflowy.fs.writeBytes(path, content);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  };
  return <div className={cn('flex min-h-0 flex-1 flex-col', presenting && 'fixed inset-0 z-50 bg-background')}>
    <div role="toolbar" aria-label={t('canvas')} className="flex flex-wrap items-center gap-1 border-b px-4 py-2">
      {presenting ? <>
        <Button variant="ghost" size="icon-sm" aria-label={t('previousFrame')} disabled={frameIndex <= 0} onClick={() => setPresenting(frames[frameIndex - 1].id)}><ChevronLeft /></Button>
        <span className="text-sm" role="status">{frameIndex + 1} / {frames.length}</span>
        <Button variant="ghost" size="icon-sm" aria-label={t('nextFrame')} disabled={frameIndex >= frames.length - 1} onClick={() => setPresenting(frames[frameIndex + 1].id)}><ChevronRight /></Button>
        <Button variant="outline" size="sm" className="ml-auto" onClick={exitPresentation}><X />{t('exitPresentation')}</Button>
      </> : <>
      {tools.map(([kind, Icon]) => <Button key={kind} variant={tool === kind ? 'secondary' : 'ghost'} size="icon-sm" aria-label={t(kind)} title={t(kind)} aria-pressed={tool === kind} disabled={!canEdit && kind !== 'pan' && kind !== 'select'} onClick={() => setTool(kind)}><Icon /></Button>)}
      <Button variant="ghost" size="sm" disabled={!canEdit || tool === 'select' || tool === 'pan'} onClick={() => {
        const rect = svg.current?.getBoundingClientRect(); insert(tool as HyperCanvasKind, { x: ((rect?.width ?? 800) / 2 - view.x) / view.zoom, y: ((rect?.height ?? 600) / 2 - view.y) / view.zoom }, { x: ((rect?.width ?? 800) / 2 - view.x) / view.zoom, y: ((rect?.height ?? 600) / 2 - view.y) / view.zoom });
      }}><Plus />{t('add')}</Button>
      <Button variant="ghost" size="icon-sm" disabled={!canEdit || !current} aria-label={t('delete')} onClick={deleteCurrent}><Trash2 /></Button>
      <Button variant="ghost" size="icon-sm" disabled={!canEdit || state.status === 'saving'} aria-label={t('undo')} onClick={() => void session.history(false)}><Undo2 /></Button>
      <Button variant="ghost" size="icon-sm" disabled={!canEdit || state.status === 'saving'} aria-label={t('redo')} onClick={() => void session.history(true)}><Redo2 /></Button>
      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={t('zoomOut')} onClick={() => zoom(1 / 1.25)}><ZoomOut /></Button>
      <Button variant="ghost" size="sm" aria-label={t('reset')} onClick={() => setView({ x: 80, y: 80, zoom: 1 })}>{Math.round(view.zoom * 100)}%</Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('zoomIn')} onClick={() => zoom(1.25)}><ZoomIn /></Button>
      <Button variant="ghost" size="sm" disabled={!canEdit} onClick={() => { setError(null); setMindMapOpen(true); }}><GitBranch />{t('mindMap')}</Button>
      <HyperCanvasAI session={session} editable={canEdit} selectedIds={selected ? [selected] : []} onApplied={id => {
        setSelected(id);
        const doc = session.store.getState().document, added = doc && hyperReadCanvas(doc).elements.find(element => element.id === id);
        if (added) setView(previous => ({ ...previous, x: 80 - added.x * previous.zoom, y: 80 - added.y * previous.zoom }));
      }} />
      <HyperCanvasImageAI session={session} editable={canEdit} selectedIds={selected ? [selected] : []} onApplied={id => {
        setSelected(id);
        const doc = session.store.getState().document, added = doc && hyperReadCanvas(doc).elements.find(element => element.id === id);
        if (added) setView(previous => ({ ...previous, x: 80 - added.x * previous.zoom, y: 80 - added.y * previous.zoom }));
      }} />
      <Button variant="ghost" size="sm" disabled={!frames.length} onClick={() => { savedView.current = view; setSelected(null); setPresenting(frames[0].id); }}><Play />{t('present')}</Button>
      </>}
      <Button variant="ghost" size="sm" disabled={exporting || !state.document} onClick={() => void exportCanvas('svg')}><Download />{t(exporting ? 'exporting' : 'exportSVG')}</Button>
      <Button variant="ghost" size="sm" disabled={exporting || !state.document} onClick={() => void exportCanvas('png')}><Download />{t('exportPNG')}</Button>
    </div>
    {(error || state.error || snapshot.unsupportedIds.length > 0) && <Alert variant={error || state.error ? 'destructive' : 'warning'}><AlertDescription>{error ?? state.error ?? t('unsupported')}</AlertDescription></Alert>}
    <div className="flex min-h-0 flex-1">
      <svg ref={svg} role="application" aria-label={t('canvas')} tabIndex={0} className="min-h-64 min-w-0 flex-1 touch-none bg-background outline-none focus-visible:ring-1 focus-visible:ring-ring" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { gesture.current = null; setPreview(null); }} onWheel={event => {
        if (presenting) return;
        event.preventDefault(); if (event.ctrlKey || event.metaKey) zoom(event.deltaY > 0 ? 1 / 1.1 : 1.1); else setView(previous => ({ ...previous, x: previous.x - event.deltaX, y: previous.y - event.deltaY }));
      }} onKeyDown={event => {
        if (event.key === 'Escape') { gesture.current = null; setPreview(null); setSelected(null); }
        if (canEdit && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault(); event.stopPropagation();
          void session.history(event.shiftKey || event.key.toLowerCase() === 'y'); return;
        }
        if (!current || !canEdit) return;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteCurrent(); svg.current?.focus(); }
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (direction) { event.preventDefault(); const step = event.shiftKey ? 10 : 1; change(doc => hyperCanvasMoveGroup(doc, current.id, current.x + direction[0] * step, current.y + direction[1] * step)); }
      }}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {hyperCanvasPaintOrder(visibleElements).map(element => <HyperCanvasShape key={element.id} session={session} active={state.status !== 'error'} element={element} elements={elements} label={state.document ? hyperCanvasLabel(element, state.document) : element.text} selected={selected === element.id} onSelect={() => setSelected(element.id)} />)}
        </g>
      </svg>
      {!presenting && <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-l bg-card p-3">
        <p className="text-xs text-muted-foreground">{!editable ? t('readOnly') : t('hint')}</p>
        {current && <>
          <label className="text-xs text-muted-foreground">{t(current.kind === 'image' ? 'imageAlt' : 'label')}<Textarea key={current.id} disabled={!canEdit} value={state.document ? hyperCanvasLabel(current, state.document) : current.text} onChange={event => change(doc => hyperEditCanvasLabel(doc, current.id, event.target.value))} /></label>
          {current.kind !== 'image' && <Select value={current.color} disabled={!canEdit} onValueChange={color => { if (color) change(doc => hyperUpdateCanvasElement(doc, current.id, { color })); }}><SelectTrigger aria-label={t('color')}><SelectValue /></SelectTrigger><SelectContent>{hyperCanvasColors.map(color => <SelectItem key={color} value={color}>{t(color)}</SelectItem>)}</SelectContent></Select>}
          {(['width', 'height'] as const).map(dimension => <label key={`${current.id}-${dimension}`} className="text-xs text-muted-foreground">{t(dimension)}<Input type="number" min={1} max={10000000} disabled={!canEdit} value={current[dimension]} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value > 0) change(doc => hyperUpdateCanvasElement(doc, current.id, { [dimension]: value })); }} /></label>)}
          {current.mindMapRootId && <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); const result = change(doc => hyperAddMindMapChild(doc, current.id, childTopic)); if (result?.focus) { setSelected(result.focus.id); setChildTopic(''); } }}><Input aria-label={t('childTopic')} placeholder={t('childTopic')} value={childTopic} disabled={!canEdit} onChange={event => setChildTopic(event.target.value)} /><Button type="submit" size="sm" disabled={!canEdit || !childTopic.trim()}>{t('addChild')}</Button></form>}
        </>}
        <h2 className="text-xs font-medium text-muted-foreground">{t('elements')}</h2>
        {!snapshot.elements.length && <p className="text-xs text-muted-foreground">{t('empty')}</p>}
        {snapshot.elements.map((element, index) => <Button key={element.id} variant={selected === element.id ? 'secondary' : 'ghost'} size="sm" className="justify-start truncate" onClick={() => { setSelected(element.id); setView(previous => ({ ...previous, x: 80 - element.x * previous.zoom, y: 80 - element.y * previous.zoom })); }}>{index + 1}. {(state.document ? hyperCanvasLabel(element, state.document) : element.text) || t(element.kind)}</Button>)}
      </aside>}
    </div>
    <Dialog open={mindMapOpen} onOpenChange={setMindMapOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{t('mindMap')}</DialogTitle><DialogDescription>{t('outlineHelp')}</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); const rect = svg.current?.getBoundingClientRect(); const result = change(doc => hyperInsertMindMap(doc, outline, { x: ((rect?.width ?? 800) / 2 - view.x) / view.zoom, y: ((rect?.height ?? 600) / 2 - view.y) / view.zoom })); if (result?.focus) { setSelected(result.focus.id); setMindMapOpen(false); } }}>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Textarea aria-label={t('outline')} value={outline} onChange={event => setOutline(event.target.value)} rows={8} className="font-mono" /><DialogFooter><Button type="submit" disabled={!canEdit || !outline.trim()}>{t('createMindMap')}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}

function HyperCanvasShape({ session, active, element: e, elements, label, selected, onSelect }: { session: HyperDocumentSession; active: boolean; element: HyperCanvasElement; elements: HyperCanvasElement[]; label: string; selected: boolean; onSelect(): void }) {
  const lines = label.split('\n').slice(0, Math.max(1, Math.floor(e.height / 20)));
  const line = e.kind === 'connector' ? hyperCanvasConnector(e, elements) : null;
  return <g data-canvas-id={e.id} role="button" tabIndex={0} aria-label={`${e.kind}: ${label || e.id}`} aria-pressed={selected} className={cn(colors[e.color], 'outline-none focus-visible:stroke-primary')} onFocus={onSelect} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}>
    {e.kind === 'image' ? <HyperCanvasImage session={session} active={active} element={e} label={label} /> : e.kind === 'ellipse' ? <ellipse cx={e.x + e.width / 2} cy={e.y + e.height / 2} rx={e.width / 2} ry={e.height / 2} fill="transparent" stroke="currentColor" strokeWidth={2} /> : e.kind === 'pen' ? <polyline points={e.points.map(point => `${e.x + point.x},${e.y + point.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> : line ? <path d={`M${line[0].x} ${line[0].y} L${line[1].x} ${line[1].y}`} stroke="currentColor" strokeWidth={2} fill="none" /> : <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={e.kind === 'frame' ? 0 : 8} className={e.kind === 'note' ? 'fill-muted' : 'fill-transparent'} stroke={e.kind === 'text' ? 'none' : 'currentColor'} strokeWidth={2} strokeDasharray={e.kind === 'frame' ? '8 4' : undefined} />}
    {e.kind !== 'image' && lines.map((text, index) => <text key={index} x={e.x + 8} y={e.y + 24 + index * 20} fill="currentColor" className="pointer-events-none font-sans text-sm">{text.slice(0, Math.max(1, Math.floor(e.width / 8)))}</text>)}
    {selected && <rect x={e.x - 4} y={e.y - 4} width={e.width + 8} height={e.height + 8} fill="none" className="stroke-primary" strokeWidth={1} strokeDasharray="4 4" />}
  </g>;
}

function HyperCanvasImage({ session, active: enabled, element, label }: { session: HyperDocumentSession; active: boolean; element: HyperCanvasElement; label: string }) {
  const { tr } = useTr();
  const [preview, setPreview] = useState<{ session: HyperDocumentSession; source: string; url: string | null; failed: boolean } | null>(null);
  const source = element.imagePath!;
  useEffect(() => {
    let active = true;
    if (!enabled) return;
    void Promise.resolve().then(() => {
      if (!session.isCurrentOwner()) throw new Error('The canvas workspace or account changed.');
      return window.appflowy.assets.previewUrl(source);
    }).then(url => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'appflowy-file:' || parsed.hostname !== 'local' || !parsed.pathname.startsWith('/images/') || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) throw new Error('Invalid managed image URL.');
      if (!session.isCurrentOwner()) throw new Error('The canvas workspace or account changed.');
      if (active) setPreview({ session, source, url, failed: false });
    }).catch(() => { if (active) setPreview({ session, source, url: null, failed: true }); });
    return () => { active = false; };
  }, [source, session, enabled]);
  const current = enabled && preview?.source === source && preview.session === session ? preview : null;
  if (current?.url && !current.failed) return <image x={element.x} y={element.y} width={element.width} height={element.height} href={current.url} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label || hyperWhiteboardStrings.image} onError={() => setPreview({ session, source, url: null, failed: true })} />;
  const failed = !enabled || current?.failed;
  const key = failed ? 'imageMissing' : 'imageLoading', translated = tr(`hyperWhiteboard.${key}`);
  const status = translated === `hyperWhiteboard.${key}` ? hyperWhiteboardStrings[key] : translated;
  return <g role="img" aria-label={`${label || hyperWhiteboardStrings.image}: ${status}`} data-image-state={failed ? 'error' : 'loading'}>
    <rect x={element.x} y={element.y} width={element.width} height={element.height} className="fill-muted stroke-border" strokeWidth={1} />
    <text x={element.x + 8} y={element.y + 24} className="pointer-events-none fill-muted-foreground font-sans text-sm">{status}</text>
  </g>;
}
