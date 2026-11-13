import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { FileUploadTypePB } from '@shared/protobuf/flowy-database2/file_entities_pb';
import type { MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { hyperPreviewCloudAsset } from '../cloud-assets/HyperCloudAssetPreview';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';

/** The popover mounts only one bounded page; preview bytes never become cell metadata. */
export function HyperDatabaseMediaPreview({ file, scope }: { file: MediaFilePB; scope: string }) {
  const owner = useHyperDocumentOwner(), ownerKey = hyperDocumentOwnerKey(owner), key = JSON.stringify([ownerKey, scope, file.id, file.url, file.uploadType]);
  const [result, setResult] = useState<{ key: string; url: string; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true; const captured = hyperCaptureDuplicateOwner(owner); setResult(null);
    const valid = () => active && (!owner || !!captured?.isCurrent());
    const resolve = Promise.resolve().then(() => file.uploadType === FileUploadTypePB.LocalFile ? window.appflowy.assets.previewUrl(file.url) : hyperPreviewCloudAsset(file.url));
    void resolve.then(url => { if (valid()) setResult({ key, url, failed: false }); }).catch(() => { if (valid()) setResult({ key, url: '', failed: true }); });
    return () => { active = false; };
  }, [key, owner]);
  if (!result || result.key !== key) return <span className="inline-block size-12 shrink-0 rounded-md bg-muted" aria-busy="true" />;
  if (result.failed) return <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" role="img" aria-label={file.name}><ImageOff aria-hidden className="size-4" /></span>;
  return <img data-hyper-media-preview src={result.url} alt={file.name} referrerPolicy="no-referrer" loading="lazy" className="size-12 shrink-0 rounded-md object-contain" onError={() => setResult(current => current?.key === key ? { ...current, failed: true } : current)} />;
}
