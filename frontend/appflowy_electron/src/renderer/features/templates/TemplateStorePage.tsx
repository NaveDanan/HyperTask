import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { LayoutTemplate, Search, SearchX, TriangleAlert } from 'lucide-react';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { showToast } from '@/ui';
import { tabsActions } from '../tabs/tabs-store';
import { hyperTemplateRepository } from './assets';
import { HyperTemplateImporter } from './import-service';
import { createHyperTemplateStore } from './store';
import { HyperTemplateCard } from './TemplateCard';

const loadPreviewImage = (url: string) => hyperTemplateRepository.loadPreviewImage(url);
export function HyperTemplateStorePage({ userProfile }: { userProfile?: UserProfilePB | null }) {
  const [store] = useState(() => createHyperTemplateStore({ repository: hyperTemplateRepository, importer: new HyperTemplateImporter(hyperTemplateRepository),
    userId: userProfile?.id.toString(), onImported: (view, name) => {
      showToast({ message: `Imported "${name}".` });
      if (view) tabsActions.openView(view);
    } }));
  const state = useStore(store);
  useEffect(() => { void store.getState().load(); }, [store]);
  useEffect(() => {
    if (state.status === 'ready' && state.message) { showToast({ message: state.message, type: 'error' }); store.getState().clearMessage(); }
  }, [state.message, state.status, store]);
  const templates = state.manifest?.filter(state.selectedCategoryId, state.query) ?? [];
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6 text-foreground">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted"><LayoutTemplate aria-hidden="true" className="size-4 text-muted-foreground" /></div>
        <div><h1 className="text-lg font-semibold tracking-tight">Templates</h1><p className="text-xs text-muted-foreground">{state.manifest ? `${state.manifest.inventory.availableCount} templates · available offline` : 'Available offline'}</p></div>
        <InputGroup className="ml-auto w-72"><InputGroupAddon><Search aria-hidden="true" className="size-4" /></InputGroupAddon><InputGroupInput aria-label="Search templates" placeholder="Search templates" value={state.query} onChange={event => state.search(event.target.value)} /></InputGroup>
      </header>
      {state.status === 'loading' ? <div aria-label="Loading templates" className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-xl border border-border"><Skeleton className="aspect-[16/10] rounded-none" /><div className="flex flex-col gap-2 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-8" /><Skeleton className="h-7" /></div></div>)}</div> : state.status === 'failure' ? (
        <Empty><EmptyHeader><EmptyMedia variant="icon"><TriangleAlert className="size-5" /></EmptyMedia><EmptyTitle>Could not load templates.</EmptyTitle><EmptyDescription>{state.message}</EmptyDescription></EmptyHeader></Empty>
      ) : <>
        <nav aria-label="Template categories" className="flex shrink-0 gap-1.5 overflow-x-auto pb-1">
          {[{ id: null, name: 'All' }, ...(state.manifest?.categories ?? [])].map(category => <Button type="button" key={category.id ?? 'all'} size="sm" className="rounded-full" variant={state.selectedCategoryId === category.id ? 'default' : 'outline'} aria-pressed={state.selectedCategoryId === category.id} onClick={() => state.selectCategory(category.id)}>{category.name}</Button>)}
        </nav>
        {templates.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">{templates.map(entry => <HyperTemplateCard key={entry.viewId} entry={entry} importing={state.importingViewIds.has(entry.viewId)} onImport={() => void state.importTemplate(entry)} loadPreviewImage={loadPreviewImage} />)}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><SearchX className="size-5" /></EmptyMedia><EmptyTitle>No templates match</EmptyTitle></EmptyHeader></Empty>}
      </>}
    </div>
  );
}
export { HyperTemplateStorePage as TemplateStorePage };