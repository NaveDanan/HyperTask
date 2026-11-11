import { useEffect, useState, type CSSProperties } from 'react';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperPreviewCloudAsset } from '../cloud-assets/HyperCloudAssetPreview';
import { hyperCaptureAppearanceOwner } from './HyperViewAppearanceService';

/** Only trusted managed-file URLs or credential-free HTTP(S); never fabricate file://. */
export function HyperViewAppearanceImage({ value, alt = '', className, style }: { value: string; alt?: string; className?: string; style?: CSSProperties }) {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner);
  const [result, setResult] = useState<{ key: string; value: string; url: string; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true; const scope = hyperCaptureAppearanceOwner(owner); setResult(null);
    if (!scope) return;
    const resolve = /^https?:/iu.test(value) ? hyperPreviewCloudAsset(value) : window.appflowy.assets.previewUrl(value);
    void resolve.then(url => { if (active && scope.isCurrent()) setResult({ key, value, url, failed: false }); }).catch(() => { if (active && scope.isCurrent()) setResult({ key, value, url: '', failed: true }); });
    return () => { active = false; };
  }, [value, key, owner]);
  if (!result || result.key !== key || result.value !== value) return <span className={`inline-block ${className ?? ''}`} style={style} aria-busy="true" />;
  return result.failed ? <span role="img" aria-label={alt || 'Image unavailable'} className={`inline-block ${className ?? ''}`} style={style}>❓</span> : <img src={result.url} alt={alt} referrerPolicy="no-referrer" draggable={false} className={className} style={style} onError={() => setResult(current => current && current.value === value ? { ...current, failed: true } : current)} />;
}
