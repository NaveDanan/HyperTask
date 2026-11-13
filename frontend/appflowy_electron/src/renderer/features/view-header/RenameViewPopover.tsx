import { useEffect, useRef, useState } from 'react';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { CalendarDays, FileText, MessageSquareText, SquareKanban, Table2 } from 'lucide-react';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { AppFlowyPopover, usePopoverContainer } from '@/ui';
import { type SelectedIcon } from './IconPicker';
import { HyperViewIconPicker } from '../view-appearance/HyperViewIconPicker';
import { hyperUpdateViewIcon, hyperViewAppearance, type HyperAppearanceTarget } from '../view-appearance/HyperViewAppearanceService';
import { RawEmojiIcon } from './ViewIcon';

/** Guarded compatibility entrypoint; callers should pass the captured source view. */
export async function updateViewIcon(view: ViewPB | string, icon: SelectedIcon, target?: HyperAppearanceTarget) {
  if (typeof view === 'string') {
    const scope = hyperViewAppearance.api.capture();
    if (!scope) return { ok: false as const, error: new Error('The workspace changed.') };
    const loaded = await hyperViewAppearance.api.view(view);
    if (!scope.isCurrent()) return { ok: false as const, error: new Error('The workspace changed.') };
    return hyperUpdateViewIcon(loaded, icon, hyperViewAppearance.capture(loaded, 'icon', () => scope.isCurrent(), undefined, scope.owner));
  }
  return hyperUpdateViewIcon(view, icon, target);
}

/** EmojiPickerButton (desktop): input addon opening the icon picker. */
function EmojiPickerButton({
  icon,
  view,
  onSubmitted,
}: {
  icon: { ty: ViewIconTypePB; value: string } | undefined;
  view: ViewPB;
  onSubmitted: (close: () => void) => void;
}) {
  const layout = view.layout;
  const showDefault = !icon || icon.value === '';
  const Icon = layout === ViewLayoutPB.Board ? SquareKanban : layout === ViewLayoutPB.Calendar ? CalendarDays : layout === ViewLayoutPB.Chat ? MessageSquareText : layout === ViewLayoutPB.Document ? FileText : Table2;
  return (
    <AppFlowyPopover
      direction="bottomWithCenterAligned"
      offset={{ x: 0, y: 18 }}
      plain
      popup={(close) => (
        <HyperViewIconPicker view={view} onApplied={keep => { if (!keep) onSubmitted(close); }} />
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
  const [captured] = useState(() => { try { return hyperViewAppearance.capture(view, 'name'); } catch { return null; } });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Saved names, so the submit and the focus-loss save do not send the same rename twice.
  const savedRef = useRef(name);
  const save = (text: string) => {
    if (text === '' || text === name || text === savedRef.current) return false;
    savedRef.current = text;
    if (!captured) return false;
    void hyperViewAppearance.save(captured, text).catch(() => {});
    return true;
  };

  // FlowyTextField.onCanceled fires when the field loses focus (Esc or a click outside closes
  // the popover) and saves the current text.
  useEffect(() => () => void save(textRef.current), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${floatingSurfaceClass} w-72 p-1.5`}>
      <InputGroup>
        <InputGroupAddon>
          <EmojiPickerButton icon={icon} view={view} onSubmitted={(closePicker) => {
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
