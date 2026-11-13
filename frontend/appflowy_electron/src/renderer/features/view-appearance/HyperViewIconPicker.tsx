import { useEffect, useRef, useState } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ImagePlus, Link2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTr } from '@/i18n';
import { IconEmojiPicker } from '../sidebar/icon-picker/IconEmojiPicker';
import { iconTypeToProto, viewIconData } from '../view/view-ext';
import { hyperViewAppearance, type HyperAppearanceTarget } from './HyperViewAppearanceService';
import { hyperViewImageUrl } from './HyperViewAppearanceModel';
import { hyperViewAppearanceStrings } from './HyperViewAppearanceStrings';

/** Captures the owner and source icon when the popup mounts, before user or native awaits. */
export function HyperViewIconPicker({ view, onApplied }: { view: ViewPB; onApplied(keepOpen: boolean): void }) {
  const alive = useRef(true);
  const bind = (target: HyperAppearanceTarget): HyperAppearanceTarget => { const scope = target.scope; return { ...target, scope: { ...scope, isCurrent: () => alive.current && scope.isCurrent() } }; };
  const [captured] = useState(() => { try { return { target: bind(hyperViewAppearance.capture(view, 'icon')), error: '' }; } catch (error) { return { target: null, error: error instanceof Error ? error.message : String(error) }; } });
  const target = useRef<HyperAppearanceTarget | null>(captured.target), [error, setError] = useState(captured.error), [busy, setBusy] = useState(false), [url, setUrl] = useState(''), [showUrl, setShowUrl] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { tr } = useTr(), text = (name: keyof typeof hyperViewAppearanceStrings) => { const key = `hyperViewAppearance.${name}`, value = tr(key); return value === key ? hyperViewAppearanceStrings[name] : value; };
  const save = async (icon: { ty: number; value: string }, keepOpen = false, asset?: string) => {
    if (!target.current || busy) return; setBusy(true); setError('');
    try { const saved = await hyperViewAppearance.save(target.current, icon, asset); target.current = bind(hyperViewAppearance.capture(saved, 'icon')); onApplied(keepOpen); }
    catch (error) { setError((error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error)); }
    finally { setBusy(false); }
  };
  return <div className="w-[22rem] max-w-full" data-hyper-view-icon-picker>
    <div className={busy || !target.current ? 'pointer-events-none opacity-50' : ''} aria-busy={busy}><IconEmojiPicker tabs={['emoji', 'icon']} height={310} initialType={viewIconData(view).type} onSelected={result => void save({ ty: iconTypeToProto(result.data.type), value: result.data.emoji }, result.keepOpen)} /></div>
    <div className="flex flex-wrap gap-2 border-t bg-popover p-2">
      <Button variant="outline" size="sm" disabled={busy || !target.current} onClick={() => {
        const captured = target.current; if (!captured || !captured.scope.isCurrent()) return; setBusy(true); setError('');
        void window.appflowy.dialog.pickFiles({ multiple: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'] }] }).then(async paths => {
          if (!paths[0]) return; const asset = await hyperViewAppearance.importImage(captured, paths[0]);
          await hyperViewAppearance.save(captured, { ty: 1, value: asset.path }, asset.path); onApplied(false);
        }).catch(error => setError((error as Error)?.message ?? String(error))).finally(() => setBusy(false));
      }}><ImagePlus />{text('chooseImage')}</Button>
      <Button variant="ghost" size="sm" disabled={busy || !target.current} onClick={() => setShowUrl(!showUrl)}><Link2 />{text('imageUrl')}</Button>
      {showUrl && <form className="flex w-full gap-2" onSubmit={event => { event.preventDefault(); try { void save({ ty: 1, value: hyperViewImageUrl(url) }); } catch (error) { setError((error as Error).message); } }}><Input autoFocus aria-label={text('imageUrl')} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" disabled={busy} /><Button size="sm" disabled={busy || !url}>{text('apply')}</Button></form>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  </div>;
}
