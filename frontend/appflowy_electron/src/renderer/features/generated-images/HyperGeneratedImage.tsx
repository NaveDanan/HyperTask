import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { HyperGeneratedImageAsset } from '@shared/api';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';

export const hyperGeneratedImageStrings = {
  image: 'Generated image', loading: 'Loading generated image…', unavailable: 'Generated image unavailable.',
  download: 'Save image', failed: 'The image could not be saved.',
};

/** Only the main-process bridge can turn a generated file URL into a renderer image. */
export function HyperGeneratedImage({ source, owner }: { source: string; owner: HyperDocumentOwner | null }) {
  const { tr } = useTr();
  const t = (name: keyof typeof hyperGeneratedImageStrings) => { const key = `hyperGeneratedImage.${name}`, value = tr(key); return value === key ? hyperGeneratedImageStrings[name] : value; };
  const key = owner ? JSON.stringify([owner.workspaceId, owner.actorId, owner.contextKey, source]) : '';
  const [result, setResult] = useState<{ key: string; asset?: HyperGeneratedImageAsset; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSaveError(null);
    if (!owner?.isCurrent()) return () => { alive = false; };
    void window.appflowy.assets.importGeneratedImage(source).then(asset => {
      if (alive && owner.isCurrent()) setResult({ key, asset });
    }, () => { if (alive && owner.isCurrent()) setResult({ key, error: true }); });
    return () => { alive = false; };
  }, [key]);
  const current = owner?.isCurrent() && result?.key === key ? result : null;
  const asset = current?.asset;
  const save = async () => {
    if (!asset || !owner?.isCurrent() || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const target = await window.appflowy.dialog.saveFile({ defaultPath: asset.name });
      if (!target || !owner.isCurrent()) return;
      await window.appflowy.assets.exportFile(asset.path, target);
    } catch { if (owner.isCurrent()) setSaveError(t('failed')); }
    finally { setSaving(false); }
  };
  if (!owner?.isCurrent() || current?.error) return <p className="text-xs text-muted-foreground">{t('unavailable')}</p>;
  return <figure className="space-y-2">
    {asset ? <img src={asset.previewUrl} alt={t('image')} width={asset.width} height={asset.height} className="max-h-96 max-w-full rounded-lg border object-contain" onError={() => setResult({ key, error: true })} /> : <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />{t('loading')}</span>}
    {asset && <Button variant="outline" size="sm" disabled={saving} onClick={() => void save()}><Download />{t('download')}</Button>}
    {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
  </figure>;
}
