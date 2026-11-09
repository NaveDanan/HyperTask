import { create } from '@bufbuild/protobuf';
import { useEffect, useRef } from 'react';
import { ViewIconPBSchema, ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventUpdateView, FolderEventUpdateViewIcon } from '@/backend/events';
import { AppFlowyPopover, FlowyButton, FlowySvg, usePopoverContainer } from '@/ui';
import { layoutIcon } from '../tabs/plugin';
import { FlowyTextField } from './FlowyTextField';
import { IconEmojiPicker, type SelectedIcon } from './IconPicker';
import { RawEmojiIcon } from './ViewIcon';

/** ViewBackendService.updateViewIcon (old custom-image cleanup is left to the document milestone). */
export function updateViewIcon(viewId: string, icon: SelectedIcon) {
  return FolderEventUpdateViewIcon({
    viewId,
    oneOfIcon: { case: 'icon', value: create(ViewIconPBSchema, { ty: icon.ty, value: icon.value }) },
  });
}

/** EmojiPickerButton (desktop): 30×30 bordered button opening the icon picker. */
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
  return (
    <AppFlowyPopover
      direction="bottomWithCenterAligned"
      offset={{ x: 0, y: 18 }}
      margin={0}
      constraints={{ width: 360, maxWidth: 360, maxHeight: 380 }}
      popup={(close) => (
        <IconEmojiPicker
          initialTab={icon?.ty === ViewIconTypePB.Icon ? 'icon' : 'emoji'}
          onSelected={(selected) => onSubmitted(selected, close)}
        />
      )}
    >
      <div style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--th-divider)', boxSizing: 'border-box' }}>
        <FlowyButton
          margin={showDefault ? 0 : '0 0 0 2px'}
          expandText={false}
          style={{ height: '100%', justifyContent: 'center' }}
          text={showDefault ? <FlowySvg svg={layoutIcon(layout)} /> : <RawEmojiIcon icon={icon!} size={18} />}
        />
      </div>
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
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ width: 30 }}>
        <EmojiPickerButton
          icon={icon}
          layout={view.layout}
          onSubmitted={(selected, closePicker) => {
            void updateViewIcon(view.id, selected);
            closePicker();
            popover?.close();
          }}
        />
      </div>
      <div style={{ width: 6 }} />
      <FlowyTextField
        ref={inputRef}
        defaultValue={name}
        maxLength={256}
        style={{ width: 220 }}
        onChange={(text) => (textRef.current = text)}
        onSubmit={(text) => {
          textRef.current = text;
          // Empty or unchanged names are ignored and the popover stays open.
          if (save(text)) popover?.close();
        }}
      />
    </div>
  );
}
