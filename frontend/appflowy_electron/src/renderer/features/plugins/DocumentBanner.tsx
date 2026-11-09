import { useState } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventPermanentlyDeleteTrashItem, FolderEventRestoreTrashItem } from '@/backend/events';
import { useTr } from '@/i18n';
import { FlowyText, showConfirmDeletionDialog } from '@/ui';
import { nameOrDefault } from '../view/view-ext';

/** BaseStyledButton: transparent, 1.5px tertiaryContainer outline, no hover fill, highlight while pressed. */
function BannerButton({ label, minWidth, highlight, onPressed }: { label: string; minWidth: number; highlight: string; onPressed: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={onPressed}
      style={{
        minWidth,
        minHeight: 40,
        padding: 0,
        borderRadius: 8,
        border: '1.5px solid var(--cs-tertiary-container)',
        background: pressed ? highlight : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <FlowyText.medium fontSize={13} color="var(--cs-tertiary)">
        {label}
      </FlowyText.medium>
    </button>
  );
}

/** DocumentBanner (plugins/document/presentation/banner.dart): the "page is in Trash" bar. */
export function DocumentBanner({ viewName, onRestore, onDelete }: { viewName: string; onRestore: () => void; onDelete: () => void }) {
  const { tr } = useTr();
  return (
    <div
      style={{
        minHeight: 60,
        width: '100%',
        background: 'var(--cs-surface-container-highest)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FlowyText.medium fontSize={14} color="var(--cs-tertiary)">
          {tr('deletePagePrompt.text')}
        </FlowyText.medium>
        <div style={{ width: 20 }} />
        <BannerButton label={tr('deletePagePrompt.restore')} minWidth={160} highlight="var(--cs-on-error)" onPressed={onRestore} />
        <div style={{ width: 20 }} />
        <BannerButton
          label={tr('deletePagePrompt.deletePermanent')}
          minWidth={220}
          highlight="var(--cs-error)"
          onPressed={() =>
            showConfirmDeletionDialog({
              name: viewName.trim() === '' ? tr('menuAppHeader.defaultNewPageName') : viewName,
              description: tr('deletePagePrompt.deletePermanentDescription'),
              onConfirm: onDelete,
            })
          }
        />
      </div>
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
