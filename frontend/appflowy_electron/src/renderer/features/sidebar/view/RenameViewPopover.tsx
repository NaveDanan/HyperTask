// RenameViewPopover (workspace/presentation/widgets/rename_view_popover.dart), opened with F2
// under the selected sidebar row (RenameViewBloc's single shared PopoverController).
import { useRef } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ViewBackendService } from '@/features/view/view-service';
import { FlowyTextField } from '../components';

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
    <div style={{ height: 32, width: 220 }}>
      <FlowyTextField defaultValue={view.name} maxLength={256} selectAll onSubmitted={update} onCanceled={update} />
    </div>
  );
}
