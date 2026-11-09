// ViewAddButton (workspace/presentation/home/menu/view/view_add_button.dart): the "+" menu of
// creatable layouts (pluginBuilders() in registration order) plus "Import".
import { useRef, type ReactNode } from 'react';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useTr } from '@/i18n';
import { ActionRow, FlowySvg, Tooltip, type PopoverController } from '@/ui';
import { ActionListPopover, SbIconButton } from '../components';
import { showImportPanel } from '../import/ImportPanel';

interface AddItem {
  layout: ViewLayoutPB;
  icon: FlowySvgName;
  label: (tr: (key: string) => string) => string;
}

const ADD_ITEMS: AddItem[] = [
  { layout: ViewLayoutPB.Document, icon: 'icon_document_s', label: (tr) => tr('document.menuName') },
  { layout: ViewLayoutPB.Grid, icon: 'icon_grid_s', label: (tr) => tr('grid.menuName') },
  { layout: ViewLayoutPB.Board, icon: 'icon_board_s', label: (tr) => tr('board.menuName') },
  { layout: ViewLayoutPB.Calendar, icon: 'icon_calendar_s', label: (tr) => tr('calendar.menuName') },
  // AIChatPluginBuilder.menuName is not localized.
  { layout: ViewLayoutPB.Chat, icon: 'chat_ai_page_s', label: () => 'AI Chat' },
];

export function ViewAddButton({
  parentViewId,
  onEditing,
  onSelected,
  isHovered,
  tooltip,
}: {
  parentViewId: string;
  onEditing: (value: boolean) => void;
  /** (layout, createNewView): "Import" reports a Document with createNewView = false. */
  onSelected: (layout: ViewLayoutPB, createNewView: boolean) => void;
  isHovered?: boolean;
  tooltip?: ReactNode;
}) {
  const { tr } = useTr();
  const controller = useRef<PopoverController>(null);
  return (
    <ActionListPopover
      controllerRef={controller}
      direction="bottomWithLeftAligned"
      offset={{ x: 0, y: 8 }}
      constraints={{ minWidth: 200 }}
      onClose={() => onEditing(false)}
      popup={(close) => (
        <>
          {ADD_ITEMS.map((item) => (
            <ActionRow
              key={item.layout}
              name={item.label(tr)}
              leftIcon={<FlowySvg svg={item.icon} size={16} />}
              onTap={() => {
                onEditing(false);
                onSelected(item.layout, true);
                close();
              }}
            />
          ))}
          <ActionRow
            name={tr('moreAction.import')}
            leftIcon={<FlowySvg svg="icon_import_s" />}
            onTap={() => {
              onEditing(false);
              showImportPanel(parentViewId, () => onSelected(ViewLayoutPB.Document, false));
              close();
            }}
          />
        </>
      )}
    >
      <div style={{ display: 'flex' }}>
        <Tooltip rich={tooltip}>
          <SbIconButton
            width={24}
            icon={<FlowySvg svg="view_item_add_s" color={isHovered ? 'var(--cs-on-surface)' : undefined} />}
            onPressed={() => {
              onEditing(true);
              controller.current?.show();
            }}
          />
        </Tooltip>
      </div>
    </ActionListPopover>
  );
}
