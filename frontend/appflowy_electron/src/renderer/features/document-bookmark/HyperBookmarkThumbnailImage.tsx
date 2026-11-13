import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { useHyperDocumentOwner, hyperDocumentOwnerKey } from '../document/HyperDocumentOwner';
import { hyperCloudAssetIsProtected, hyperPreviewCloudAsset } from '../cloud-assets/HyperCloudAssetPreview';
import type { HyperBookmarkThumbnail } from './HyperBookmarkThumbnailValue';
/** A saved snapshot resolves only from managed files or the owner-bound protected image bridge. */
export function HyperBookmarkThumbnailImage({ thumbnail, alt, unavailable }: { thumbnail: HyperBookmarkThumbnail; alt: string; unavailable: string }) {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner), source = thumbnail.media.url;
  const [result, setResult] = useState<{ source: string; key: string; url: string; failed: boolean; current(): boolean } | null>(null);
  useEffect(() => {
    let active = true; const captured = hyperCaptureDuplicateOwner(owner); setResult(null);
    if (!captured) return;
    const resolve = async () => {
      if (thumbnail.media.source === 'local') return window.appflowy.assets.previewUrl(source);
      if (!hyperCloudAssetIsProtected(source)) throw Error('The protected thumbnail is unavailable.');
      return hyperPreviewCloudAsset(source);
    };
    void resolve().then(url => { if (active && captured.isCurrent()) setResult({ source, key, url, failed: false, current: captured.isCurrent }); }).catch(() => { if (active && captured.isCurrent()) setResult({ source, key, url: '', failed: true, current: captured.isCurrent }); });
    return () => { active = false; };
  }, [source, thumbnail.media.source, key, owner]);
  if (!owner?.isCurrent()) return null;
  if (!result || !result.current() || result.source !== source || result.key !== key) return <span aria-busy="true" className="block h-24 rounded-md bg-muted" />;
  return result.failed ? <Alert variant="warning"><AlertDescription>{unavailable}</AlertDescription></Alert> : <img data-hyper-bookmark-thumbnail src={result.url} alt={alt} width={thumbnail.width} height={thumbnail.height} className="h-auto max-h-64 w-full rounded-md object-contain" referrerPolicy="no-referrer" draggable={false} onError={() => setResult(current => current ? { ...current, failed: true } : null)} />;
}
