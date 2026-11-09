import { useEffect, useState } from 'react';
import { FileText, Plus, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/reui/badge';
import { cn } from '@/lib/utils';
import type { HyperTemplateEntry } from './models';

export type HyperTemplatePreviewLoader = (url: string) => Promise<Uint8Array | null>;
export function HyperTemplateCard({ entry, importing, onImport, loadPreviewImage }: {
  entry: HyperTemplateEntry; importing: boolean; onImport: () => void; loadPreviewImage?: HyperTemplatePreviewLoader;
}) {
  const Icon = entry.kind === 'database' ? Table2 : FileText;
  const primaryIndex = entry.primaryCategoryId ? entry.categoryIds.indexOf(entry.primaryCategoryId) : -1;
  const primaryCategory = entry.categoryNames[primaryIndex >= 0 ? primaryIndex : 0];
  return (
    <article className={cn('group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md', !entry.isAvailable && 'opacity-60')}>
      <HyperTemplatePreview entry={entry} loadPreviewImage={loadPreviewImage} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">{entry.name}</h2>
        <p className="line-clamp-2 text-xs text-muted-foreground">{entry.isAvailable ? entry.description : entry.blocker}</p>
        <div className="flex flex-wrap gap-1.5">
          {entry.kind && <Badge variant="secondary" size="sm"><Icon className="size-3" />{entry.kind === 'database' ? 'Database' : 'Document'}</Badge>}
          {primaryCategory && <Badge variant="secondary" size="sm">{primaryCategory}</Badge>}
          {entry.isNew && <Badge variant="info-light" size="sm">New</Badge>}
          {!entry.isAvailable && <Badge variant="outline" size="sm">Unavailable</Badge>}
        </div>
        <div className="mt-auto pt-2">
          <Button type="button" size="sm" className="w-full" disabled={!entry.isAvailable || importing} onClick={onImport}>
            {importing ? <><Spinner className="size-4" />Importing…</> : <><Plus className="size-4" />Use template</>}
          </Button>
        </div>
      </div>
    </article>
  );
}
function HyperTemplatePreview({ entry, loadPreviewImage }: { entry: HyperTemplateEntry; loadPreviewImage?: HyperTemplatePreviewLoader }) {
  const [image, setImage] = useState<string | null>(null);
  const url = entry.preview?.hasImage ? entry.preview.imageUrl : null;
  useEffect(() => {
    let active = true, objectUrl: string | null = null;
    setImage(null);
    if (url && loadPreviewImage) {
      void loadPreviewImage(url).then(bytes => {
        if (!active || !bytes) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
        setImage(objectUrl);
      }).catch(() => { if (active) setImage(null); });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, loadPreviewImage]);
  return (
    <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-muted">
      {image ? <img src={image} alt={`Preview of ${entry.name}`} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" onError={() => setImage(null)} /> : <HyperTemplateContentPreview entry={entry} />}
    </div>
  );
}
export function HyperTemplateContentPreview({ entry }: { entry: HyperTemplateEntry }) {
  const highlights = entry.preview?.highlights ?? [], database = entry.kind === 'database', Icon = database ? Table2 : FileText;
  const label = `Preview of ${entry.name}. No image in the published template.${highlights.length ? ` Contains: ${highlights.join(', ')}.` : ''}`;
  return (
    <div role="img" aria-label={label} className="flex size-full flex-col justify-center gap-3 overflow-hidden p-4">
      {highlights.length === 0 ? <Icon aria-hidden="true" className="size-5 text-muted-foreground" /> : database ? (
        <div aria-hidden="true" className={cn('grid gap-1.5', highlights.length === 1 ? 'grid-cols-1' : highlights.length === 2 ? 'grid-cols-2' : highlights.length === 3 ? 'grid-cols-3' : 'grid-cols-4')}>
          {highlights.map((text, index) => <div key={index} className="truncate rounded-md bg-muted-foreground/15 p-2 text-2xs font-medium text-muted-foreground">{text}</div>)}
          {Array.from({ length: highlights.length * 3 }, (_, index) => <div key={`cell-${index}`} className="h-5 rounded-md bg-muted-foreground/15" />)}
        </div>
      ) : (
        <div aria-hidden="true" className="flex flex-col gap-2">
          {highlights.map((text, index) => <div key={index} className="flex flex-col gap-1.5"><span className="truncate text-xs font-medium text-muted-foreground">{text}</span><div className="h-2 w-4/5 rounded-md bg-muted-foreground/15" /></div>)}
        </div>
      )}
    </div>
  );
}
export { HyperTemplateCard as TemplateCard };