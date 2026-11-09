// ViewAddButton (workspace/presentation/home/menu/view/view_add_button.dart): the "+" menu of
// creatable layouts (pluginBuilders() in registration order) plus "Import".
import { useRef, useState, type ReactNode } from 'react';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { CalendarDays, FileText, Import, MessageSquareText, Plus, SquareKanban, Table2, type LucideIcon } from 'lucide-react';
import { MenuRow, MenuSeparator } from '@/components/app/menu-row';
import { NavIconButton } from '@/components/app/nav';
import { useTr } from '@/i18n';
import { Tooltip, type PopoverController } from '@/ui';
import { ActionListPopover } from '../components';
import { showImportPanel } from '../import/ImportPanel';

interface AddItem {
  layout: ViewLayoutPB;
  icon: LucideIcon;
  label: (tr: (key: string) => string) => string;
}

const ADD_ITEMS: AddItem[] = [
  { layout: ViewLayoutPB.Document, icon: FileText, label: (tr) => tr('document.menuName') },
  { layout: ViewLayoutPB.Grid, icon: Table2, label: (tr) => tr('grid.menuName') },
  { layout: ViewLayoutPB.Board, icon: SquareKanban, label: (tr) => tr('board.menuName') },
  { layout: ViewLayoutPB.Calendar, icon: CalendarDays, label: (tr) => tr('calendar.menuName') },
  // AIChatPluginBuilder.menuName is not localized.
  { layout: ViewLayoutPB.Chat, icon: MessageSquareText, label: () => 'AI Chat' },
];

export function ViewAddButton({
  parentViewId,
  onEditing,
  onSelected,
  isHovered: _isHovered,
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
  const [open, setOpen] = useState(false);
  return (
    <ActionListPopover
      controllerRef={controller}
      direction="bottomWithLeftAligned"
      offset={{ x: 0, y: 8 }}
      constraints={{ minWidth: 208, maxWidth: 208 }}
      onOpen={() => setOpen(true)}
      onClose={() => { setOpen(false); onEditing(false); }}
      popup={(close) => (
        <>
          {ADD_ITEMS.map((item) => (
            <MenuRow
              key={item.layout}
              label={item.label(tr)}
              icon={<item.icon className="size-4" />}
              onClick={() => {
                onEditing(false);
                onSelected(item.layout, true);
                close();
              }}
            />
          ))}
          <MenuSeparator />
          <MenuRow
            label={tr('moreAction.import')}
            icon={<Import className="size-4" />}
            onClick={() => {
              onEditing(false);
              showImportPanel(parentViewId, () => onSelected(ViewLayoutPB.Document, false));
              close();
            }}
          />
        </>
      )}
    >
      <div className="flex">
        <Tooltip rich={tooltip}>
          <NavIconButton aria-expanded={open} aria-label={typeof tooltip === 'string' ? tooltip : tr('menuAppHeader.addPageTooltip')} onClick={(event) => {
            event.stopPropagation();
            onEditing(true);
            controller.current?.show();
          }}><Plus className="size-3.5" /></NavIconButton>
        </Tooltip>
      </div>
    </ActionListPopover>
  );
}
