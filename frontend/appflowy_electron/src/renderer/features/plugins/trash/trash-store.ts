// TrashBloc (plugins/trash/application/trash_bloc.dart).
import { createStore, type StoreApi } from 'zustand';
import type { TrashPB } from '@shared/protobuf/flowy-folder/trash_pb';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';
import {
  FolderEventListTrashItems,
  FolderEventPermanentlyDeleteAllTrashItem,
  FolderEventPermanentlyDeleteTrashItem,
  FolderEventRecoverAllTrashItems,
  FolderEventRestoreTrashItem,
} from '@/backend/events';
import { listenTrash } from '../../view-header/view-listener';

export interface TrashState {
  /** Backend order (get_my_trash_info). */
  objects: TrashPB[];
  /** successOrFailure: stored, never shown. */
  error: FlowyError | null;
}

export interface TrashStore extends StoreApi<TrashState> {
  /** TrashEvent.initial: listen to "trash" and read the list; returns stop. */
  start(): () => void;
  putback(trashId: string): Promise<void>;
  delete(trash: TrashPB): Promise<void>;
  restoreAll(): Promise<void>;
  deleteAll(): Promise<void>;
}

export function createTrashStore(): TrashStore {
  const store = createStore<TrashState>(() => ({ objects: [], error: null }));
  let active = false;
  const record = (result: { ok: true } | { ok: false; error: FlowyError }) => {
    if (active) store.setState({ error: result.ok ? null : result.error });
  };
  return Object.assign(store, {
    start() {
      active = true;
      const stop = listenTrash((items) => {
        if (active) store.setState({ objects: items });
      });
      void FolderEventListTrashItems().then((result) => {
        if (!active) return;
        if (result.ok) store.setState({ objects: result.value.items, error: null });
        else store.setState({ error: result.error });
      });
      return () => {
        active = false;
        stop();
      };
    },
    async putback(trashId: string) {
      record(await FolderEventRestoreTrashItem({ id: trashId }));
    },
    async delete(trash: TrashPB) {
      record(await FolderEventPermanentlyDeleteTrashItem({ items: [{ id: trash.id }] }));
    },
    async restoreAll() {
      record(await FolderEventRecoverAllTrashItems());
    },
    async deleteAll() {
      record(await FolderEventPermanentlyDeleteAllTrashItem());
    },
  });
}
