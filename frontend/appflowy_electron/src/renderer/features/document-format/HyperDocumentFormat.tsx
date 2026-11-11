import { useRef, useState } from 'react';
import { ExternalLink, Link2, Unlink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { ColorPicker } from '@/components/reui/color-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTr } from '@/i18n';
import { hyperDocumentFormatUrl, hyperDocumentFormatValues, type HyperDocumentFormatPatch, type HyperDocumentFormatSelection } from './HyperDocumentFormatModel';

export const hyperDocumentFormatStrings = {
  title: 'Link and color', description: 'Format the selected text, or edit a link at the cursor.',
  url: 'Link address', urlHint: 'Use a complete https://, http:// or mailto: address.',
  foreground: 'Text color', background: 'Highlight color', mixed: 'Mixed values',
  removeLink: 'Remove link', openLink: 'Open link', defaultColor: 'Default color',
  apply: 'Apply formatting', cancel: 'Cancel', clear: 'Clear color',
  picker: 'Choose color', hex: 'Hex color', opacity: 'Opacity',
} as const;
export interface HyperDocumentFormatProps {
  editable: boolean;
  onPrepare(): HyperDocumentFormatSelection;
  onApply(selection: HyperDocumentFormatSelection, patch: HyperDocumentFormatPatch): void | Promise<void>;
  /** Restore the logical selection and return the editor host for popup focus management. */
  onRestoreSelection?(selection: HyperDocumentFormatSelection): HTMLElement | null;
}
export function HyperDocumentFormat({ editable, onPrepare, onApply, onRestoreSelection }: HyperDocumentFormatProps) {
  const { tr } = useTr();
  const text = (key: keyof typeof hyperDocumentFormatStrings) => { const id = `hyperDocumentFormat.${key}`, value = tr(id); return value === id ? hyperDocumentFormatStrings[key] : value; };
  const [open, setOpen] = useState(false), [selection, setSelection] = useState<HyperDocumentFormatSelection | null>(null);
  const [values, setValues] = useState<HyperDocumentFormatPatch>({}), [patch, setPatch] = useState<HyperDocumentFormatPatch>({});
  const [error, setError] = useState(''), [applying, setApplying] = useState(false);
  const editableNow = useRef(editable); editableNow.current = editable;
  const appliedSelection = useRef<HyperDocumentFormatSelection | null>(null);
  const apply = async (changes = patch) => {
    if (!editableNow.current || applying || !selection || !Object.keys(changes).length) return;
    setApplying(true); setError('');
    try {
      await onApply(selection, changes);
      appliedSelection.current = selection; setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setApplying(false); }
  };
  const href = 'href' in patch ? patch.href ?? '' : values.href ?? '';
  const color = (key: 'font_color' | 'bg_color') => key in patch ? patch[key] ?? null : values[key] ?? null;
  const disabled = !editable || applying || !selection;
  return <Dialog open={open} onOpenChange={next => {
    if (!next) { if (!applying) setOpen(false); return; }
    if (!editableNow.current) return;
    setPatch({}); setError(''); appliedSelection.current = null;
    try { const captured = onPrepare(); setSelection(captured); setValues(hyperDocumentFormatValues(captured)); }
    catch (error) { setSelection(null); setValues({}); setError(error instanceof Error ? error.message : String(error)); }
    setOpen(true);
  }}>
    <DialogTrigger render={<Button variant="ghost" size="sm" disabled={!editable} />}><Link2 />{text('title')}</DialogTrigger>
    <DialogContent className="sm:max-w-lg" finalFocus={() => {
      const target = appliedSelection.current; appliedSelection.current = null;
      return target && onRestoreSelection ? onRestoreSelection(target) ?? true : true;
    }}><DialogHeader><DialogTitle>{text('title')}</DialogTitle><DialogDescription>{text('description')}</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void apply(); }}>
        <label className="flex flex-col gap-2 text-sm">{text('url')}<Input aria-label={text('url')} placeholder={values.href === undefined && selection ? text('mixed') : 'https://'} value={href} disabled={disabled} onChange={event => setPatch({ ...patch, href: event.target.value.trim() || null })} /><span className="text-xs text-muted-foreground">{text('urlHint')}</span></label>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled || !href} onClick={() => {
          try { void window.appflowy.shell.openExternal(hyperDocumentFormatUrl(href)).catch(error => setError(error instanceof Error ? error.message : String(error))); }
          catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        }}><ExternalLink />{text('openLink')}</Button><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void apply({ href: null })}><Unlink />{text('removeLink')}</Button></div>
        {(['font_color', 'bg_color'] as const).map(key => <div key={key} className="flex items-center gap-3"><span className="mr-auto text-sm">{text(key === 'font_color' ? 'foreground' : 'background')}</span><ColorPicker aria-label={text(key === 'font_color' ? 'foreground' : 'background')} value={color(key)} format="hex" alpha disabled={disabled} placeholder={values[key] === undefined ? text('mixed') : text('defaultColor')} onValueChange={value => setPatch(previous => ({ ...previous, [key]: value }))} i18n={{ labels: { panelLabel: text('picker'), hex: text('hex'), alpha: text('opacity'), clear: text('clear') } }} /><Button type="button" variant="ghost" size="sm" aria-label={`${text('clear')}: ${text(key === 'font_color' ? 'foreground' : 'background')}`} disabled={disabled} onClick={() => setPatch(previous => ({ ...previous, [key]: null }))}>{text('clear')}</Button></div>)}
        <DialogFooter className="m-0 flex-row rounded-none border-0 bg-transparent p-0"><Button type="button" variant="outline" disabled={applying} onClick={() => setOpen(false)}>{text('cancel')}</Button><Button type="submit" disabled={disabled || !Object.keys(patch).length}>{text('apply')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
