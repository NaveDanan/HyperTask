import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { TrashPB } from '@shared/protobuf/flowy-folder/trash_pb';
import { tr, useTr } from '@/i18n';
import { FlowyButton, FlowyIconButton, FlowySvg, FlowyText, showConfirmDeletionDialog, showConfirmDialog } from '@/ui';
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
    confirmButtonColor: 'var(--cs-primary)',
    onConfirm: () => options.onConfirm(),
  });
}

function TopBar({ store }: { store: TrashStore }) {
  const { tr } = useTr();
  return (
    <div style={{ height: 36, display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
      <FlowyText.semibold fontSize={16} color="var(--cs-tertiary)" style={{ display: 'flex', alignItems: 'center' }}>
        {tr('trash.text')}
      </FlowyText.semibold>
      <div style={{ flex: 1 }} />
      <FlowyButton
        useIntrinsicWidth
        leftIcon={<FlowySvg svg="restore_s" />}
        text={<FlowyText.medium lineHeight={14}>{tr('trash.restoreAll')}</FlowyText.medium>}
        onTap={() =>
          showCancelAndConfirmDialog({
            confirmLabel: tr('trash.restore'),
            title: tr('trash.confirmRestoreAll.title'),
            description: tr('trash.confirmRestoreAll.caption'),
            onConfirm: () => void store.restoreAll(),
          })
        }
      />
      <div style={{ width: 6 }} />
      <FlowyButton
        useIntrinsicWidth
        leftIcon={<FlowySvg svg="delete_s" />}
        text={<FlowyText.medium lineHeight={14}>{tr('trash.deleteAll')}</FlowyText.medium>}
        onTap={() =>
          showConfirmDeletionDialog({
            name: tr('trash.confirmDeleteAll.title'),
            description: tr('trash.confirmDeleteAll.caption'),
            onConfirm: () => void store.deleteAll(),
          })
        }
      />
    </div>
  );
}

function TrashHeader() {
  const { tr } = useTr();
  const items: Array<[string, number]> = [
    [tr('trash.pageHeader.fileName'), TrashSizes.fileNameWidth],
    [tr('trash.pageHeader.lastModified'), TrashSizes.lastModifiedWidth],
    [tr('trash.pageHeader.created'), TrashSizes.createTimeWidth],
  ];
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        height: TrashSizes.headerHeight,
        background: 'var(--cs-surface)',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {items.map(([title, width]) => (
        <div key={title} style={{ width, flexShrink: 0 }}>
          <FlowyText color="var(--th-disabled)">{title}</FlowyText>
        </div>
      ))}
    </div>
  );
}

/** TrashCell (plugins/trash/src/trash_cell.dart). */
function TrashCell({ object, onRestore, onDelete }: { object: TrashPB; onRestore: () => void; onDelete: () => void }) {
  return (
    <div style={{ height: 42, display: 'flex', alignItems: 'center' }}>
      <div style={{ width: TrashSizes.fileNameWidth, flexShrink: 0 }}>
        <FlowyText>{object.name || tr('menuAppHeader.defaultNewPageName')}</FlowyText>
      </div>
      <div style={{ width: TrashSizes.lastModifiedWidth, flexShrink: 0 }}>
        <FlowyText>{formatTrashDate(object.modifiedTime)}</FlowyText>
      </div>
      <div style={{ width: TrashSizes.createTimeWidth, flexShrink: 0 }}>
        <FlowyText>{formatTrashDate(object.createTime)}</FlowyText>
      </div>
      <div style={{ flex: 1 }} />
      <FlowyIconButton
        width={TrashSizes.actionIconWidth}
        iconPadding={5}
        iconColorOnHover="var(--cs-on-surface)"
        onPressed={onRestore}
        icon={<FlowySvg svg="restore_s" />}
      />
      <div style={{ width: 20, flexShrink: 0 }} />
      <FlowyIconButton
        width={TrashSizes.actionIconWidth}
        iconPadding={5}
        iconColorOnHover="var(--cs-on-surface)"
        onPressed={onDelete}
        icon={<FlowySvg svg="delete_s" />}
      />
    </div>
  );
}

/** TrashPage (plugins/trash/trash_page.dart). */
export function TrashPage() {
  const [store] = useState(createTrashStore);
  useEffect(() => store.start(), [store]);
  const objects = useStore(store, (s) => s.objects);
  const { tr } = useTr();

  return (
    <div
      style={{
        height: '100%',
        boxSizing: 'border-box',
        padding: '48px 80px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TopBar store={store} />
      <div style={{ height: 32, flexShrink: 0 }} />
      <div className="trash-list" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={{ width: TrashSizes.totalWidth }}>
          <TrashHeader />
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
        </div>
      </div>
    </div>
  );
}
