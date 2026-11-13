import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Sparkles, Square } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useTr } from '@/i18n';
import { hyperChatModelKey } from '../ai-chat/HyperChatStore';
import { hyperDocumentOwnerKey, useHyperDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperCanvasConnector, hyperCanvasLabel, hyperCanvasPaintOrder, hyperReadCanvas } from '../whiteboard/HyperWhiteboardModel';
import { hyperCanvasAILimits, type HyperCanvasAIKind } from './HyperCanvasAIModel';
import { createHyperCanvasAIStore } from './HyperCanvasAIStore';

export const hyperCanvasAIStrings = {
  ask: 'Canvas AI', description: 'Create a mind map or presentation. Review the preview, then add it to this canvas.',
  kind: 'Create', mindmap: 'Mind map', presentation: 'Presentation', instruction: 'Instructions',
  placeholder: 'Describe the topic and what you want to create.', model: 'Model',
  includeSelected: 'Include selected canvas labels', includePage: 'Include page text',
  sourceHelp: 'Existing content is sent only when you select it here and choose Generate. Maximum source size is 16,384 characters.',
  generate: 'Generate', generating: 'Generating…', stop: 'Stop generating', cancelled: 'Stopped',
  preview: 'Generated canvas preview', apply: 'Add to canvas', applying: 'Adding…', applied: 'Added to canvas',
  limits: 'Up to 64 topics or 12 slides. Edit the generated elements on the canvas after adding them.',
} as const;
export interface HyperCanvasAIProps { session: HyperDocumentSession; editable: boolean; selectedIds: readonly string[]; onApplied?(id: string): void }
export function HyperCanvasAI(props: HyperCanvasAIProps) {
  const { tr } = useTr(), owner = useHyperDocumentOwner(), [open, setOpen] = useState(false);
  const scope = `${hyperDocumentOwnerKey(owner)}:${props.session.id}`;
  const label = tr('hyperCanvasAI.ask') === 'hyperCanvasAI.ask' ? hyperCanvasAIStrings.ask : tr('hyperCanvasAI.ask');
  useEffect(() => { setOpen(false); }, [scope]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="ghost" size="sm" disabled={!props.editable || !owner} />}><Sparkles />{label}</DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      {open && owner && <HyperCanvasAIContent key={scope} {...props} owner={owner} />}
    </DialogContent>
  </Dialog>;
}
function HyperCanvasAIContent(props: HyperCanvasAIProps & { owner: HyperDocumentOwner }) {
  const { tr } = useTr();
  const t = (key: keyof typeof hyperCanvasAIStrings) => { const path = `hyperCanvasAI.${key}`, value = tr(path); return value === path ? hyperCanvasAIStrings[key] : value; };
  const latest = useRef(props); latest.current = props;
  const [store] = useState(() => createHyperCanvasAIStore({ session: props.session, owner: props.owner, editable: () => latest.current.editable, selectedIds: () => latest.current.selectedIds }));
  const state = useStore(store);
  const [kind, setKind] = useState<HyperCanvasAIKind>('mindmap'), [instruction, setInstruction] = useState('');
  const [includeSelected, setIncludeSelected] = useState(false), [includePage, setIncludePage] = useState(false);
  useEffect(() => store.start(), [store]);
  useEffect(() => { if (!props.editable) { store.stop(); store.reset(); } }, [props.editable, store]);
  const busy = state.status === 'generating' || state.status === 'applying', disabled = busy || state.changingModel || !props.editable;
  return <>
    <DialogHeader><DialogTitle>{t('ask')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} disabled={disabled} items={(['mindmap', 'presentation'] as const).map(value => ({ value, label: t(value) }))} onValueChange={value => { if (value) { store.reset(); setKind(value as HyperCanvasAIKind); } }}>
          <SelectTrigger aria-label={t('kind')}><SelectValue /></SelectTrigger><SelectContent>{(['mindmap', 'presentation'] as const).map(value => <SelectItem key={value} value={value}>{t(value)}</SelectItem>)}</SelectContent>
        </Select>
        {state.models.length > 0 && <Select value={state.selectedModel ? hyperChatModelKey(state.selectedModel) : null} disabled={disabled} items={state.models.map(model => ({ value: hyperChatModelKey(model), label: model.name }))} onValueChange={value => { const model = state.models.find(item => hyperChatModelKey(item) === value); if (model) void store.selectModel(model); }}>
          <SelectTrigger className="max-w-64" aria-label={t('model')}><SelectValue placeholder={t('model')} /></SelectTrigger><SelectContent>{state.models.map(model => <SelectItem key={hyperChatModelKey(model)} value={hyperChatModelKey(model)}>{model.name}</SelectItem>)}</SelectContent>
        </Select>}
      </div>
      <label className="flex flex-col gap-2 text-sm font-medium">{t('instruction')}<Textarea value={instruction} maxLength={hyperCanvasAILimits.prompt} rows={3} disabled={disabled} placeholder={t('placeholder')} onChange={event => { store.reset(); setInstruction(event.target.value); }} /></label>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2"><Checkbox aria-label={t('includeSelected')} checked={includeSelected} disabled={disabled || !props.selectedIds.length} onCheckedChange={checked => { store.reset(); setIncludeSelected(checked === true); }} />{t('includeSelected')}</label>
        <label className="flex items-center gap-2"><Checkbox aria-label={t('includePage')} checked={includePage} disabled={disabled} onCheckedChange={checked => { store.reset(); setIncludePage(checked === true); }} />{t('includePage')}</label>
        <p className="text-xs text-muted-foreground">{t('sourceHelp')}</p>
      </div>
      {(state.error || state.modelError) && <Alert variant="destructive"><AlertDescription>{state.error || state.modelError}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <Button disabled={disabled || !instruction.trim() || includeSelected && !props.selectedIds.length} onClick={() => void store.generate(kind, instruction, { includeSelected, includePage, selectedIds: props.selectedIds })}>{state.status === 'generating' ? <Spinner /> : <Sparkles />}{state.status === 'generating' ? t('generating') : t('generate')}</Button>
        {state.status === 'generating' && <Button variant="outline" onClick={() => store.stop()}><Square />{t('stop')}</Button>}
        {state.status === 'cancelled' && <Badge size="sm" variant="secondary">{t('cancelled')}</Badge>}
        {state.status === 'applied' && <Badge size="sm" variant="success-light">{t('applied')}</Badge>}
        {state.comment && <span className="text-xs text-muted-foreground">{state.comment}</span>}
      </div>
      {state.preview && <HyperCanvasAIPreview document={state.preview} label={t('preview')} />}
      <p className="text-xs text-muted-foreground">{t('limits')}</p>
      <DialogFooter className="m-0 border-0 bg-transparent p-0"><Button disabled={state.status !== 'ready' || !props.editable} onClick={() => void store.apply().then(id => { if (id) latest.current.onApplied?.(id); }).catch(() => {})}>{state.status === 'applying' ? <Spinner /> : <Sparkles />}{state.status === 'applying' ? t('applying') : t('apply')}</Button></DialogFooter>
    </div>
  </>;
}
function HyperCanvasAIPreview({ document, label }: { document: DocumentDataPB; label: string }) {
  const { elements } = hyperReadCanvas(document);
  const width = Math.max(1, ...elements.map(item => item.x + item.width)) + 32;
  const height = Math.max(1, ...elements.map(item => item.y + item.height)) + 32;
  return <div role="region" aria-label={label} tabIndex={0} className="max-h-80 overflow-auto rounded-lg border bg-background p-2 focus-visible:ring-2 focus-visible:ring-ring">
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`-16 -16 ${width} ${height}`} className="text-foreground">
      <title>{label}</title>
      {hyperCanvasPaintOrder(elements).map(item => {
        const line = item.kind === 'connector' ? hyperCanvasConnector(item, elements) : null;
        return <g key={item.id}>
          {line ? <path d={`M${line[0].x} ${line[0].y} L${line[1].x} ${line[1].y}`} stroke="currentColor" strokeWidth={2} fill="none" /> : <rect x={item.x} y={item.y} width={item.width} height={item.height} rx={item.kind === 'frame' ? 0 : 8} className={item.kind === 'note' ? 'fill-muted' : 'fill-transparent'} stroke={item.kind === 'text' ? 'none' : 'currentColor'} strokeWidth={2} strokeDasharray={item.kind === 'frame' ? '8 4' : undefined} />}
          {hyperCanvasLabel(item, document).split('\n').map((text, index) => <text key={index} x={item.x + 8} y={item.y + 24 + index * 20} fill="currentColor" className="font-sans text-sm">{text}</text>)}
        </g>;
      })}
    </svg>
  </div>;
}
