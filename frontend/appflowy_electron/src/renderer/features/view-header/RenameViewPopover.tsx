import { create } from '@bufbuild/protobuf';
import { useEffect, useRef } from 'react';
import { ViewIconPBSchema, ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventUpdateView, FolderEventUpdateViewIcon } from '@/backend/events';
import { CalendarDays, FileText, MessageSquareText, SquareKanban, Table2 } from 'lucide-react';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { AppFlowyPopover, usePopoverContainer } from '@/ui';
import { IconEmojiPicker, type SelectedIcon } from './IconPicker';
import { RawEmojiIcon } from './ViewIcon';

/** ViewBackendService.updateViewIcon (old custom-image cleanup is left to the document milestone). */
export function updateViewIcon(viewId: string, icon: SelectedIcon) {
  return FolderEventUpdateViewIcon({
    viewId,
    oneOfIcon: { case: 'icon', value: create(ViewIconPBSchema, { ty: icon.ty, value: icon.value }) },
  });
}

/** EmojiPickerButton (desktop): input addon opening the icon picker. */
function EmojiPickerButton({
  icon,
  layout,
  onSubmitted,
}: {
  icon: { ty: ViewIconTypePB; value: string } | undefined;
  layout: ViewPB['layout'];
  onSubmitted: (icon: SelectedIcon, close: () => void) => void;
}) {
  const showDefault = !icon || icon.value === '';
  const Icon = layout === ViewLayoutPB.Board ? SquareKanban : layout === ViewLayoutPB.Calendar ? CalendarDays : layout === ViewLayoutPB.Chat ? MessageSquareText : layout === ViewLayoutPB.Document ? FileText : Table2;
  return (
    <AppFlowyPopover
      direction="bottomWithCenterAligned"
      offset={{ x: 0, y: 18 }}
      plain
      popup={(close) => (
        <IconEmojiPicker
          initialTab={icon?.ty === ViewIconTypePB.Icon ? 'icon' : 'emoji'}
          onSelected={(selected) => onSubmitted(selected, close)}
        />
      )}
    >
      <InputGroupButton size="icon-xs">
        {showDefault ? <Icon className="size-4 text-muted-foreground" /> : <RawEmojiIcon icon={icon!} size={18} />}
      </InputGroupButton>
    </AppFlowyPopover>
  );
}

/** RenameViewPopover (workspace/presentation/widgets/rename_view_popover.dart). */
export function RenameViewPopover({
  view,
  name,
  icon,
}: {
  view: ViewPB;
  name: string;
  icon: { ty: ViewIconTypePB; value: string } | undefined;
}) {
  const popover = usePopoverContainer();
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef(name);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Saved names, so the submit and the focus-loss save do not send the same rename twice.
  const savedRef = useRef(name);
  const save = (text: string) => {
    if (text === '' || text === name || text === savedRef.current) return false;
    savedRef.current = text;
    void FolderEventUpdateView({ viewId: view.id, oneOfName: { case: 'name', value: text } });
    return true;
  };

  // FlowyTextField.onCanceled fires when the field loses focus (Esc or a click outside closes
  // the popover) and saves the current text.
  useEffect(() => () => void save(textRef.current), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${floatingSurfaceClass} w-72 p-1.5`}>
      <InputGroup>
        <InputGroupAddon>
          <EmojiPickerButton icon={icon} layout={view.layout} onSubmitted={(selected, closePicker) => {
            void updateViewIcon(view.id, selected);
            closePicker();
            popover?.close();
          }} />
        </InputGroupAddon>
        <InputGroupInput ref={inputRef} defaultValue={name} maxLength={256} spellCheck={false}
          onChange={(event) => (textRef.current = event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const text = event.currentTarget.value;
            textRef.current = text;
            // Empty or unchanged names are ignored and the popover stays open.
            if (save(text)) popover?.close();
          }} />
      </InputGroup>
    </div>
  );
}
