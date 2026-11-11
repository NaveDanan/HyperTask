import { useLayoutEffect, useMemo, useRef } from 'react';
import { hyperDocumentOwnerKey, useHyperDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';

/** Requests from a closed Organization pane stay cancelled even if that owner returns. */
export function useHyperOrganizationOwner(): HyperDocumentOwner | null {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner);
  const scope = useMemo(() => {
    const lifetime = { active: true };
    return { lifetime, owner: owner ? { ...owner, isCurrent: () => lifetime.active && owner.isCurrent() } : null };
  }, [key]);
  useLayoutEffect(() => { scope.lifetime.active = true; return () => { scope.lifetime.active = false; }; }, [scope]);
  return scope.owner;
}
/** A dialog belongs to the owner that opened it; changing owners closes it. */
export function useHyperOrganizationDialogOwner(workspaceId: string, onClose: () => void): HyperDocumentOwner | null {
  const owner = useHyperOrganizationOwner(), key = hyperDocumentOwnerKey(owner), original = useRef(key), closed = useRef(false);
  const current = !!owner && owner.workspaceId === workspaceId && key === original.current && owner.isCurrent();
  useLayoutEffect(() => { if (!current && !closed.current) { closed.current = true; onClose(); } }, [current, onClose]);
  return current ? owner : null;
}
