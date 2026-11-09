// RenameViewPopover (workspace/presentation/widgets/rename_view_popover.dart), opened with F2
// under the selected sidebar row (RenameViewBloc's single shared PopoverController).
import { useRef } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ViewBackendService } from '@/features/view/view-service';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { viewIconData } from '@/features/view/view-ext';
import { ViewIcon } from './ViewIcon';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';

let currentAnchor: (() => void) | null = null;

/** The selected row registers itself; the last registration is the anchor. */
export function registerRenameAnchor(show: () => void): () => void {
  currentAnchor = show;
  return () => {
    if (currentAnchor === show) currentAnchor = null;
  };
}

/** RenameViewEvent.open(). */
export function openRenamePopover() {
  currentAnchor?.();
}

export function RenameViewPopover({ view, close }: { view: ViewPB; close: () => void }) {
  const done = useRef(false);
  // _updateViewName: only a non-empty, changed name is saved; otherwise the popover stays open.
  const update = (name: string) => {
    if (done.current || name === '' || name === view.name) return;
    done.current = true;
    void ViewBackendService.updateView({ viewId: view.id, name }).then(() => close());
  };
  return (
    <div className={cn(floatingSurfaceClass, 'w-72 p-1.5')}>
      <InputGroup>
        <InputGroupAddon><span className="flex size-5 items-center justify-center text-base"><ViewIcon icon={viewIconData(view)} size={16} /></span></InputGroupAddon>
        <InputGroupInput defaultValue={view.name} maxLength={256} spellCheck={false}
          ref={(el) => {
            if (el && !el.dataset.focused) {
              el.dataset.focused = 'true';
              requestAnimationFrame(() => { el.focus(); el.select(); });
            }
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') update(event.currentTarget.value); }}
          onBlur={(event) => update(event.currentTarget.value)} />
      </InputGroup>
    </div>
  );
}
