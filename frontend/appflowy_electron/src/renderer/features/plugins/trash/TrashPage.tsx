import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { TrashPB } from '@shared/protobuf/flowy-folder/trash_pb';
import { tr, useTr } from '@/i18n';
import { FileText, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, showConfirmDeletionDialog, showConfirmDialog } from '@/ui';
import { formatTrashDate } from '../../view-header/date-format';
import { createTrashStore, type TrashStore } from './trash-store';

// TrashSizes (plugins/trash/src/sizes.dart), scale 0.8.
const SCALE = 0.8;
export const TrashSizes = {
  headerHeight: 60 * SCALE,
  fileNameWidth: 320 * SCALE,
  lastModifiedWidth: 230 * SCALE,
  createTimeWidth: 230 * SCALE,
  padding: 40 * SCALE,
  actionIconWidth: 40 * SCALE,
  get totalWidth() {
    return this.fileNameWidth + this.lastModifiedWidth + this.createTimeWidth + this.padding + 2 * this.actionIconWidth;
  },
};

/** showCancelAndConfirmDialog (workspace/presentation/widgets/dialogs.dart): primary confirm button. */
function showCancelAndConfirmDialog(options: { title: string; description: string; confirmLabel: string; onConfirm: () => void }) {
  showConfirmDialog({
    title: options.title,
    description: options.description,
    style: 'cancelAndOk',
    confirmLabel: options.confirmLabel,
    onConfirm: () => options.onConfirm(),
  });
}

function TopBar({ store }: { store: TrashStore }) {
  const { tr } = useTr();
  return (
    <div className="flex h-10 shrink-0 items-center gap-2">
      <h1 className="text-lg font-semibold tracking-tight">{tr('trash.text')}</h1>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => showCancelAndConfirmDialog({
          confirmLabel: tr('trash.restore'), title: tr('trash.confirmRestoreAll.title'), description: tr('trash.confirmRestoreAll.caption'), onConfirm: () => void store.restoreAll(),
        })}><RotateCcw className="size-4" />{tr('trash.restoreAll')}</Button>
        <Button variant="destructive" size="sm" onClick={() => showConfirmDeletionDialog({
          name: tr('trash.confirmDeleteAll.title'), description: tr('trash.confirmDeleteAll.caption'), onConfirm: () => void store.deleteAll(),
        })}><Trash2 className="size-4" />{tr('trash.deleteAll')}</Button>
      </div>
    </div>
  );
}

function TrashHeader() {
  const { tr } = useTr();
  return (
    <TableHeader className="sticky top-0 z-1 bg-background">
      <TableRow>
        <TableHead className="text-xs font-medium text-muted-foreground">{tr('trash.pageHeader.fileName')}</TableHead>
        <TableHead className="text-xs font-medium text-muted-foreground">{tr('trash.pageHeader.lastModified')}</TableHead>
        <TableHead className="text-xs font-medium text-muted-foreground">{tr('trash.pageHeader.created')}</TableHead>
        <TableHead><span className="sr-only">Actions</span></TableHead>
      </TableRow>
    </TableHeader>
  );
}

function TrashCell({ object, onRestore, onDelete }: { object: TrashPB; onRestore: () => void; onDelete: () => void }) {
  return (
    <TableRow className="group/row">
      <TableCell><span className="flex max-w-64 items-center gap-2"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{object.name || tr('menuAppHeader.defaultNewPageName')}</span></span></TableCell>
      <TableCell className="text-muted-foreground tabular-nums">{formatTrashDate(object.modifiedTime)}</TableCell>
      <TableCell className="text-muted-foreground tabular-nums">{formatTrashDate(object.createTime)}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
          <Tooltip message={tr('trash.restore')}><Button variant="ghost" size="icon-sm" aria-label={tr('trash.restore')} onClick={onRestore}><RotateCcw className="size-4" /></Button></Tooltip>
          <Tooltip message={tr('deletePagePrompt.deletePermanent')}><Button variant="ghost" size="icon-sm" className="hover:bg-destructive/10 hover:text-destructive" aria-label={tr('deletePagePrompt.deletePermanent')} onClick={onDelete}><Trash2 className="size-4" /></Button></Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** TrashPage (plugins/trash/trash_page.dart). */
export function TrashPage() {
  const [store] = useState(createTrashStore);
  useEffect(() => store.start(), [store]);
  const objects = useStore(store, (s) => s.objects);
  const { tr } = useTr();

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-8 py-6">
      <TopBar store={store} />
      <div className="trash-list min-h-0 flex-1 overflow-auto pt-6">
        {objects.length === 0 ? (
          <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><Trash2 className="size-5" /></EmptyMedia><EmptyTitle>{tr('trash.mobile.empty')}</EmptyTitle><EmptyDescription>{tr('trash.mobile.emptyDescription')}</EmptyDescription></EmptyHeader></Empty>
        ) : (
          <Table>
            <TrashHeader />
            <TableBody>
          {objects.map((object) => (
            <TrashCell
              key={object.id}
              object={object}
              onRestore={() =>
                showCancelAndConfirmDialog({
                  title: tr('trash.restorePage.title', { args: [object.name] }),
                  description: tr('trash.restorePage.caption'),
                  confirmLabel: tr('trash.restore'),
                  onConfirm: () => void store.putback(object.id),
                })
              }
              onDelete={() =>
                showConfirmDeletionDialog({
                  name: object.name.trim() === '' ? tr('menuAppHeader.defaultNewPageName') : object.name,
                  description: tr('deletePagePrompt.deletePermanentDescription'),
                  onConfirm: () => void store.delete(object),
                })
              }
            />
          ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
