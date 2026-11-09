import { createStore } from 'zustand/vanilla';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetCurrentWorkspaceSetting } from '@/backend/events';
import type { HyperTemplateEntry, HyperTemplateManifest } from './models';
import type { HyperTemplateRepository } from './repository';
import type { HyperTemplateImporter } from './import-service';

export interface HyperTemplateStoreState {
  status: 'loading' | 'ready' | 'failure'; manifest: HyperTemplateManifest | null; selectedCategoryId: string | null;
  query: string; importingViewIds: Set<string>; lastImportedName: string | null; message: string | null;
  load(): Promise<void>; selectCategory(id: string | null): void; search(query: string): void; clearMessage(): void;
  importTemplate(entry: HyperTemplateEntry): Promise<void>;
}
export async function resolveHyperTemplateWorkspace() {
  const result = await FolderEventGetCurrentWorkspaceSetting();
  if (!result.ok) throw new Error(`Current workspace not found: ${result.error.msg}`);
  return result.value.workspaceId;
}
export function createHyperTemplateStore({ repository, importer, userId = '', resolveParentViewId = resolveHyperTemplateWorkspace, onImported }: {
  repository: HyperTemplateRepository; importer: Pick<HyperTemplateImporter, 'importTemplate'>; userId?: string;
  resolveParentViewId?: () => Promise<string>; onImported?: (view: ViewPB | null, name: string) => void;
}) {
  return createStore<HyperTemplateStoreState>((set, get) => ({
    status: 'loading', manifest: null, selectedCategoryId: null, query: '', importingViewIds: new Set(), lastImportedName: null, message: null,
    async load() {
      try { set({ status: 'ready', manifest: await repository.loadManifest(), message: null }); }
      catch (error) { console.error('Failed to load local templates', error); set({ status: 'failure', message: 'Could not read the bundled template store.' }); }
    },
    selectCategory: selectedCategoryId => set({ selectedCategoryId }), search: query => set({ query }),
    clearMessage: () => set({ message: null, lastImportedName: null }),
    async importTemplate(entry) {
      if (!entry.isAvailable || get().importingViewIds.has(entry.viewId)) return;
      set({ importingViewIds: new Set([...get().importingViewIds, entry.viewId]), message: null, lastImportedName: null });
      let created: ViewPB | null = null, name: string | null = null, message: string | null = null;
      try {
        const result = await importer.importTemplate(entry, await resolveParentViewId());
        if (!result.ok) throw result.error;
        created = result.value; name = entry.name;
      } catch (error) {
        console.error(`Import of ${entry.publishName} for user ${userId} failed`, error);
        message = `Could not import "${entry.name}".`;
      }
      const importingViewIds = new Set(get().importingViewIds); importingViewIds.delete(entry.viewId);
      set({ importingViewIds, lastImportedName: name, message });
      if (name !== null) onImported?.(created, name);
    },
  }));
}