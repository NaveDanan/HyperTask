import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ImagePlus, Square } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useTr } from '@/i18n';
import { hyperDocumentOwnerKey, useHyperDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCanvasAILimits } from './HyperCanvasAIModel';
import type { HyperCanvasAIProps } from './HyperCanvasAI';
import { createHyperCanvasImageAIStore } from './HyperCanvasImageAIStore';

export const hyperCanvasImageAIStrings = {
  ask: 'Generate image', description: 'Uses the image model configured in Settings > AI. Review the generated image before adding it to your canvas.',
  instruction: 'Image description', placeholder: 'Describe the image you want to create.',
  includeSelected: 'Include selected canvas labels', includePage: 'Include page text',
  sourceHelp: 'Existing content is sent only when selected here. Up to 16,384 characters can be included.',
  generate: 'Generate', generating: 'Generating…', importing: 'Preparing preview…', stop: 'Stop generating', cancelled: 'Stopped',
  preview: 'Generated image preview', apply: 'Add image to canvas', applying: 'Adding…', applied: 'Added to canvas',
  previewError: 'The image preview could not be loaded. Generate again.',
} as const;
export function HyperCanvasImageAI(props: HyperCanvasAIProps) {
  const { tr } = useTr(), owner = useHyperDocumentOwner(), [open, setOpen] = useState(false);
  const scope = `${hyperDocumentOwnerKey(owner)}:${props.session.id}`, translated = tr('hyperCanvasImageAI.ask');
  useEffect(() => { setOpen(false); }, [scope]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="ghost" size="sm" disabled={!props.editable || !owner} />}><ImagePlus />{translated === 'hyperCanvasImageAI.ask' ? hyperCanvasImageAIStrings.ask : translated}</DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">{open && owner && <HyperCanvasImageAIContent key={scope} {...props} owner={owner} />}</DialogContent>
  </Dialog>;
}
function HyperCanvasImageAIContent(props: HyperCanvasAIProps & { owner: HyperDocumentOwner }) {
  const { tr } = useTr(), latest = useRef(props); latest.current = props;
  const t = (key: keyof typeof hyperCanvasImageAIStrings) => { const path = `hyperCanvasImageAI.${key}`, value = tr(path); return value === path ? hyperCanvasImageAIStrings[key] : value; };
  const [store] = useState(() => createHyperCanvasImageAIStore({ session: props.session, owner: props.owner, editable: () => latest.current.editable, selectedIds: () => latest.current.selectedIds }));
  const state = useStore(store), [instruction, setInstruction] = useState('');
  const [includeSelected, setIncludeSelected] = useState(false), [includePage, setIncludePage] = useState(false), [imageError, setImageError] = useState(false), [readyAsset, setReadyAsset] = useState('');
  useEffect(() => store.start(), [store]);
  useEffect(() => { if (!props.editable) { store.stop(); store.reset(); } }, [props.editable, store]);
  useEffect(() => { setImageError(false); }, [state.asset]);
  const busy = ['generating', 'importing', 'applying'].includes(state.status), disabled = busy || !props.editable;
  return <>
    <DialogHeader><DialogTitle>{t('ask')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
    <label className="flex flex-col gap-2 text-sm font-medium">{t('instruction')}<Textarea value={instruction} maxLength={hyperCanvasAILimits.prompt} rows={3} disabled={disabled} placeholder={t('placeholder')} onChange={event => { store.reset(); setInstruction(event.target.value); }} /></label>
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2"><Checkbox aria-label={t('includeSelected')} checked={includeSelected} disabled={disabled || !props.selectedIds.length} onCheckedChange={checked => { store.reset(); setIncludeSelected(checked === true); }} />{t('includeSelected')}</label>
      <label className="flex items-center gap-2"><Checkbox aria-label={t('includePage')} checked={includePage} disabled={disabled} onCheckedChange={checked => { store.reset(); setIncludePage(checked === true); }} />{t('includePage')}</label>
      <p className="text-xs text-muted-foreground">{t('sourceHelp')}</p>
    </div>
    {(state.error || imageError) && <Alert variant="destructive"><AlertDescription>{state.error || t('previewError')}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <Button disabled={disabled || !instruction.trim() || includeSelected && !props.selectedIds.length} onClick={() => void store.generate(instruction, { selectedIds: props.selectedIds, includeSelected, includePage })}>{busy ? <Spinner /> : <ImagePlus />}{state.status === 'importing' ? t('importing') : state.status === 'generating' ? t('generating') : t('generate')}</Button>
      {['generating', 'importing'].includes(state.status) && <Button variant="outline" onClick={() => store.stop()}><Square />{t('stop')}</Button>}
      {state.status === 'cancelled' && <Badge variant="secondary" size="sm">{t('cancelled')}</Badge>}
      {state.status === 'applied' && <Badge variant="success-light" size="sm">{t('applied')}</Badge>}
    </div>
    {state.asset && <figure className="flex justify-center overflow-auto rounded-lg border bg-muted/20 p-3"><img src={state.asset.previewUrl} alt={`${t('preview')}: ${state.instruction}`} width={state.asset.width} height={state.asset.height} onLoad={() => { setReadyAsset(state.asset!.previewUrl); setImageError(false); }} onError={() => setImageError(true)} className="max-h-80 max-w-full object-contain" /></figure>}
    <DialogFooter className="m-0 border-0 bg-transparent p-0"><Button disabled={state.status !== 'ready' || !props.editable || imageError || readyAsset !== state.asset?.previewUrl} onClick={() => void store.apply().then(id => { if (id) latest.current.onApplied?.(id); }).catch(() => {})}>{state.status === 'applying' ? <Spinner /> : <ImagePlus />}{state.status === 'applying' ? t('applying') : t('apply')}</Button></DialogFooter>
  </>;
}
