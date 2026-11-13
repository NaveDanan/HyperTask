import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { ImagePlus, SmilePlus, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { ColorPicker } from '@/components/reui/color-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Spinner } from '@/components/ui/spinner';
import { AppFlowyPopover } from '@/ui';
import { useTr } from '@/i18n';
import { RawEmojiIcon, viewIcon } from '../view-header/ViewIcon';
import { useHyperDocumentOwner, hyperDocumentOwnerKey } from '../document/HyperDocumentOwner';
import { HYPER_COVER_GRADIENTS, hyperCoverColor, hyperCoverGradientId, hyperLegacyCoverField, hyperReadViewCover, hyperViewImageUrl, type HyperViewCover } from './HyperViewAppearanceModel';
import { HYPER_VIEW_COVER_PRESETS } from './HyperViewAppearancePresets';
import { hyperViewAppearance, type HyperAppearanceTarget } from './HyperViewAppearanceService';
import { HyperViewAppearanceImage } from './HyperViewAppearanceImage';
import { HyperViewIconPicker } from './HyperViewIconPicker';
import { useHyperAppearanceView } from './HyperViewAppearanceView';
import { hyperViewAppearanceStrings } from './HyperViewAppearanceStrings';
export { hyperViewAppearanceStrings } from './HyperViewAppearanceStrings';
export function useHyperAppearanceText() { const { tr } = useTr(); return (name: keyof typeof hyperViewAppearanceStrings) => { const key = `hyperViewAppearance.${name}`, value = tr(key); return value === key ? hyperViewAppearanceStrings[name] : value; }; }
const errorText = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);
export function HyperViewCoverPreview({ cover }: { cover: HyperViewCover }) {
  if (cover.type === 'none') return null;
  const className = 'h-44 w-full rounded-lg object-cover';
  if (cover.type === 'color') return <div className={className} style={{ background: hyperCoverColor(cover.value) }} />;
  if (cover.type === 'gradient') return <div className={className} style={{ background: HYPER_COVER_GRADIENTS[Number(cover.value.at(-1)) - 1] }} />;
  if (cover.type === 'built_in') return <img src={HYPER_VIEW_COVER_PRESETS[Number(cover.value) - 1]} alt="" className={className} />;
  return <HyperViewAppearanceImage value={cover.value} className={className} />;
}
export function HyperViewAppearance({ view, session, editable }: { view: ViewPB; session: HyperDocumentSession; editable: boolean }) {
  const current = useHyperAppearanceView(view), state = useStore(session.store), owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner), text = useHyperAppearanceText();
  const editableNow = useRef(editable); editableNow.current = editable;
  const [dialog, setDialog] = useState<{ target: HyperAppearanceTarget; draft: HyperViewCover; asset?: string } | null>(null), [tab, setTab] = useState('presets'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [url, setUrl] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setDialog(null); setError(''); return () => { generation.current++; }; }, [session, key]);
  let cover: HyperViewCover = { type: 'none', value: '' }, coverError = '';
  if (current) try { cover = hyperReadViewCover(current, state.document).cover; } catch (error) { coverError = errorText(error); }
  const open = () => {
    if (!current || !owner || !editableNow.current || coverError) return;
    try {
      const run = ++generation.current, captured = hyperReadViewCover(current, state.document);
      const target = hyperViewAppearance.capture(current, 'cover', () => editableNow.current, undefined, owner);
      if (target.original === 'null') { const doc = state.document; if (!doc?.blocks[doc.pageId]) throw new Error('The page root is unavailable.'); target.legacySource = { documentId: session.id, original: hyperLegacyCoverField(doc.blocks[doc.pageId].data) }; }
      const scope = target.scope; target.scope = { ...scope, isCurrent: () => run === generation.current && scope.isCurrent() };
      setDialog({ target, draft: captured.cover }); setUrl(['custom', 'unsplash'].includes(captured.cover.type) ? captured.cover.value : ''); setError(''); setTab('presets');
    } catch (error) { setError(errorText(error)); }
  };
  const close = () => { if (!busy) { generation.current++; setDialog(null); setError(''); } };
  const save = async (draft = dialog?.draft) => {
    if (!dialog || !draft || busy) return; const captured = dialog, run = generation.current; setBusy(true); setError('');
    try { await hyperViewAppearance.save(captured.target, draft, captured.asset); if (generation.current === run) { generation.current++; setDialog(null); } }
    catch (error) { if (generation.current === run) setError(errorText(error)); }
    finally { setBusy(false); }
  };
  if (!current || !owner?.isCurrent() || session.id !== current.id) return null;
  const icon = viewIcon(current);
  return <div data-hyper-view-appearance={current.id} className="flex flex-col gap-2">
    {coverError ? <Alert variant="warning"><AlertDescription>{coverError}</AlertDescription></Alert> : <HyperViewCoverPreview cover={cover} />}
    <div className="flex items-center gap-2">
      {editable ? <AppFlowyPopover plain direction="bottomWithLeftAligned" popup={close => <HyperViewIconPicker view={current} onApplied={keep => { if (!keep) close(); }} />}><Button variant="ghost" size={icon ? 'icon' : 'sm'} aria-label={text('changeIcon')}>{icon ? <RawEmojiIcon icon={icon} size={32} /> : <><SmilePlus />{text('changeIcon')}</>}</Button></AppFlowyPopover> : icon ? <RawEmojiIcon icon={icon} size={32} /> : null}
      {editable && !coverError && <Button variant="ghost" size="sm" onClick={open}><ImagePlus />{text(cover.type === 'none' ? 'addCover' : 'changeCover')}</Button>}
    </div>
    {error && !dialog && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Dialog open={!!dialog} onOpenChange={open => { if (!open) close(); }}><DialogContent className="sm:max-w-xl" showCloseButton={!busy}><DialogHeader><DialogTitle>{text('title')}</DialogTitle><DialogDescription>{text('description')}</DialogDescription></DialogHeader>
      {dialog && <><HyperViewCoverPreview cover={dialog.draft} />
        <Tabs value={tab} onValueChange={setTab}><TabsList variant="line"><TabsTrigger value="presets">{text('presets')}</TabsTrigger><TabsTrigger value="color">{text('color')}</TabsTrigger><TabsTrigger value="image">{text('chooseImage')}</TabsTrigger></TabsList>
          <TabsContent value="presets"><div className="grid grid-cols-3 gap-2">{HYPER_VIEW_COVER_PRESETS.map((url, index) => <button type="button" key={url} aria-label={`${text('presets')} ${index + 1}`} aria-pressed={dialog.draft.type === 'built_in' && dialog.draft.value === String(index + 1)} disabled={busy} className="overflow-hidden rounded-md border outline-none hover:ring-2 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2" onClick={() => setDialog({ ...dialog, draft: { type: 'built_in', value: String(index + 1) } })}><img src={url} alt="" className="h-14 w-full object-cover" /></button>)}</div><p className="mt-3 text-xs text-muted-foreground">{text('gradients')}</p><div className="mt-2 grid grid-cols-7 gap-2">{HYPER_COVER_GRADIENTS.map((background, index) => <button type="button" key={index} aria-label={`${text('gradients')} ${index + 1}`} disabled={busy} className="h-10 rounded-md border outline-none hover:ring-2 focus-visible:ring-2 focus-visible:ring-ring" style={{ background }} onClick={() => setDialog({ ...dialog, draft: { type: 'gradient', value: hyperCoverGradientId(index) } })} />)}</div></TabsContent>
          <TabsContent value="color"><div className="grid grid-cols-9 gap-2">{Array.from({ length: 9 }, (_, index) => <button type="button" key={index} aria-label={`${text('color')} ${index + 1}`} disabled={busy} className="h-9 rounded-md border outline-none hover:ring-2 focus-visible:ring-2 focus-visible:ring-ring" style={{ background: `var(--afx-tint-${index + 1})` }} onClick={() => setDialog({ ...dialog, draft: { type: 'color', value: `appflowy_them_color_tint${index + 1}` } })} />)}</div><div className="mt-3"><ColorPicker aria-label={text('color')} format="hex" disabled={busy} value={dialog.draft.type === 'color' && dialog.draft.value.startsWith('#') ? dialog.draft.value : '#ffffff'} onValueChange={value => { if (value) setDialog({ ...dialog, draft: { type: 'color', value } }); }} /></div></TabsContent>
          <TabsContent value="image"><div className="grid gap-3"><Button variant="outline" disabled={busy} onClick={() => {
            const captured = dialog, run = generation.current; setBusy(true); setError('');
            void window.appflowy.dialog.pickFiles({ multiple: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'] }] }).then(async paths => {
              if (!paths[0]) return; const asset = await hyperViewAppearance.importImage(captured.target, paths[0]); if (generation.current === run) setDialog({ ...captured, draft: { type: 'local', value: asset.path }, asset: asset.path });
            }).catch(error => { if (generation.current === run) setError(errorText(error)); }).finally(() => setBusy(false));
          }}><ImagePlus />{text('chooseImage')}</Button><label className="grid gap-2 text-sm">{text('imageUrl')}<Input aria-label={text('imageUrl')} value={url} disabled={busy} placeholder="https://" onChange={event => setUrl(event.target.value)} /></label><p className="text-xs text-muted-foreground">{text('networkHint')}</p><Button variant="outline" disabled={busy || !url} onClick={() => { try { setDialog({ ...dialog, draft: { type: 'custom', value: hyperViewImageUrl(url) } }); setError(''); } catch (error) { setError(errorText(error)); } }}>{text('apply')}</Button></div></TabsContent>
        </Tabs>
      </>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => void save({ type: 'none', value: '' })}><Trash2 />{text('removeCover')}</Button><Button variant="outline" disabled={busy} onClick={close}>{text('cancel')}</Button><Button disabled={busy || !editable || !dialog} onClick={() => void save()}>{busy && <Spinner />}{text(busy ? 'saving' : 'save')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
