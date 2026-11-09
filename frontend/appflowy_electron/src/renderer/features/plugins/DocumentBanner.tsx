import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventPermanentlyDeleteTrashItem, FolderEventRestoreTrashItem } from '@/backend/events';
import { useTr } from '@/i18n';
import { Button } from '@/components/ui/button';
import { showConfirmDeletionDialog } from '@/ui';
import { nameOrDefault } from '../view/view-ext';

/** DocumentBanner (plugins/document/presentation/banner.dart): the "page is in Trash" bar. */
export function DocumentBanner({ viewName, onRestore, onDelete }: { viewName: string; onRestore: () => void; onDelete: () => void }) {
  const { tr } = useTr();
  return (
    <div className="flex w-full shrink-0 items-center justify-center gap-3 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive-foreground">
      <span className="font-medium">{tr('deletePagePrompt.text')}</span>
      <Button size="sm" variant="outline" onClick={onRestore}>{tr('deletePagePrompt.restore')}</Button>
      <Button size="sm" className="bg-destructive text-white hover:bg-destructive/90" onClick={() =>
        showConfirmDeletionDialog({
          name: viewName.trim() === '' ? tr('menuAppHeader.defaultNewPageName') : viewName,
          description: tr('deletePagePrompt.deletePermanentDescription'),
          onConfirm: onDelete,
        })}>{tr('deletePagePrompt.deletePermanent')}</Button>
    </div>
  );
}

/** DocumentEvent.restorePage: TrashService.putback; the banner hides on success. */
export async function restorePage(view: ViewPB): Promise<boolean> {
  const result = await FolderEventRestoreTrashItem({ id: view.id });
  return result.ok;
}

/** DocumentEvent.deletePermanently: TrashService.deleteViews; success means forceClose. */
export async function deletePermanently(view: ViewPB): Promise<boolean> {
  const result = await FolderEventPermanentlyDeleteTrashItem({ items: [{ id: view.id }] });
  return result.ok;
}

export const bannerViewName = (view: ViewPB) => nameOrDefault(view);
