import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedViewSectionPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';

type Handler = (ty: number, result: { ok: true; value: Uint8Array }) => void;
vi.mock('@/backend/notifications', () => ({
  NotificationSource: { Folder: 'Workspace' },
  listen: (_s: string, _h: Handler) => () => {},
}));
let lockOk = true;
vi.mock('@/backend/events', () => ({
  FolderEventGetSharedViewSection: vi.fn(async () => ({ ok: true, value: { section: SharedViewSectionPB.PrivateSection } })),
  FolderEventLockView: vi.fn(async () => (lockOk ? { ok: true, value: undefined } : { ok: false, error: { code: 1 } })),
  FolderEventUnlockView: vi.fn(async () => ({ ok: true, value: undefined })),
  FolderEventGetView: vi.fn(),
  FolderEventGetSharedUsers: vi.fn(),
  FolderEventReadCurrentWorkspace: vi.fn(),
  UserEventGetAllWorkspace: vi.fn(),
  UserEventGetUserProfile: vi.fn(),
}));
vi.mock('@/startup/kv', () => ({
  KVKeys: { featureFlag: 'featureFlag' },
  KeyValueStorage: { getJson: () => null },
}));

const { createPageAccessLevelStore, isEditable, ShareAccessLevel, SharedSectionType } = await import('./page-access-level-store');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// PageAccessLevelBloc (docs/parity/02-home-shell.md §3.4.6) with FeatureFlag.sharedSection off.
describe('page access level store', () => {
  beforeEach(() => {
    lockOk = true;
  });

  it('loads full access, the lock state and the section type', async () => {
    const view = create(ViewPBSchema, { id: 'v', oneOfIsLocked: { case: 'isLocked', value: true } });
    const store = createPageAccessLevelStore(view);
    expect(store.getState().isLoadingLockStatus).toBe(true);
    const stop = store.start();
    await flush();
    const state = store.getState();
    expect(state).toMatchObject({
      isLoadingLockStatus: false,
      isLocked: true,
      accessLevel: ShareAccessLevel.fullAccess,
      sectionType: SharedSectionType.private,
    });
    expect(isEditable(state)).toBe(false);
    stop();
  });

  it('counts unlocks (for the Re-lock chip) and follows lock results', async () => {
    const store = createPageAccessLevelStore(create(ViewPBSchema, { id: 'v' }));
    const stop = store.start();
    await flush();
    await store.lock();
    expect(store.getState().isLocked).toBe(true);
    expect(store.getState().view.oneOfIsLocked).toEqual({ case: 'isLocked', value: true });
    await store.unlock();
    expect(store.getState()).toMatchObject({ isLocked: false, lockCounter: 1 });
    lockOk = false;
    await store.lock();
    expect(store.getState()).toMatchObject({ isLocked: false, lockCounter: 1 });
    stop();
  });

  it('does not emit an unchanged lock state', async () => {
    const store = createPageAccessLevelStore(create(ViewPBSchema, { id: 'v' }));
    const stop = store.start();
    await flush();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.updateLockStatus(false);
    expect(listener).not.toHaveBeenCalled();
    store.updateLockStatus(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    stop();
  });
});
