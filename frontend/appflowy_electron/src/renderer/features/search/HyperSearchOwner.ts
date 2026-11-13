import { useAppStore } from '@/startup/app-store';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';

let generation = 0;

/** Invalidates captured work even if a session switches away and back to the same owner. */
export function hyperInvalidateSearchOwner() {
  generation++;
}

export function hyperCaptureSearchOwner(owner: HyperDocumentOwner | null = hyperGetDocumentOwner()) {
  if (!owner?.isCurrent()) return null;
  const captured = generation, launchId = useAppStore.getState().launchId;
  return {
    owner,
    key: hyperDocumentOwnerKey(owner),
    isCurrent: () => captured === generation && launchId === useAppStore.getState().launchId && owner.isCurrent(),
  };
}

export type HyperSearchOwnerScope = NonNullable<ReturnType<typeof hyperCaptureSearchOwner>>;
