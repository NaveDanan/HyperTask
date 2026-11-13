import { useEffect, useRef } from 'react';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperAcquireCodeSyntaxClient } from './HyperCodeSyntaxClient';
import { HyperCodeSyntaxController } from './HyperCodeSyntaxController';
import { hyperCodeSyntaxAvailable } from './HyperCodeSyntaxRegistry';
/** Optional paint only: this component never sends document actions or alters the editable DOM. */
export function HyperDocumentCodeSyntax({ session, editorHost, revision }: { session: HyperDocumentSession; editorHost: { current: HTMLElement | null }; revision: unknown }) {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner), launch = useAppStore(state => state.launchId), controller = useRef<HyperCodeSyntaxController | null>(null);
  useEffect(() => {
    const host = editorHost.current, captured = hyperCaptureDuplicateOwner(owner);
    if (!host || !captured || !session.belongsTo(captured) || !hyperCodeSyntaxAvailable(host.ownerDocument)) return;
    const pool = hyperAcquireCodeSyntaxClient(JSON.stringify([key, launch]), captured.isCurrent), current = () => captured.isCurrent() && session.belongsTo(captured) && session.isCurrentOwner();
    const active = new HyperCodeSyntaxController(host, pool.client, () => session.store.getState().document, current); controller.current = active;
    const invalidate = () => { if (!captured.isCurrent()) { pool.client.dispose(); active.dispose(); } };
    const app = useAppStore.subscribe(invalidate), workspace = useWorkspaceStore.subscribe(invalidate); active.sync();
    return () => { app(); workspace(); active.dispose(); pool.release(); if (controller.current === active) controller.current = null; };
  }, [session, editorHost, key, launch]);
  useEffect(() => { controller.current?.sync(); }, [revision]);
  return null;
}
