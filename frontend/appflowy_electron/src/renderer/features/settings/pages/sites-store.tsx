import { createStore } from 'zustand/vanilla';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';
import type { PublishInfoViewPB } from '@shared/protobuf/flowy-folder/publish_pb';
import { RecurringIntervalPB, SubscriptionPlanPB, type WorkspaceSubscriptionInfoPB } from '@shared/protobuf/flowy-user/workspace_pb';
import {
  FolderEventGetDefaultPublishInfo,
  FolderEventGetPublishNamespace,
  FolderEventListPublishedViews,
  FolderEventRemoveDefaultPublishView,
  FolderEventSetDefaultPublishView,
  FolderEventSetPublishName,
  FolderEventSetPublishNamespace,
  FolderEventUnpublishViews,
  UserEventGetWorkspaceSubscriptionInfo,
  UserEventSubscribeWorkspace,
} from '@/backend/events';
import { tr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { showToast } from '@/ui';
import { sortPublishedViews } from './sites-core';

export interface SettingsSitesState {
  publishedViews: PublishInfoViewPB[];
  namespace: string;
  subscriptionInfo: WorkspaceSubscriptionInfoPB | null;
  isLoading: boolean;
  homePageView: PublishInfoViewPB | null;
}

export type ActionOutcome = { ok: true } | { ok: false; error: FlowyError };

// workspaceId -> namespace (kept across page openings, as the Dart top-level cache).
const namespaceCache = new Map<string, string | null>();

const viewIdOf = (view: PublishInfoViewPB) => view.info?.viewId ?? '';

/**
 * SettingsSitesBloc (pages/sites/settings_sites_bloc.dart). The page listener's toasts for
 * upgradeSubscription / unpublishView / setHomePage / removeHomePage are emitted here; the
 * namespace and path-name dialogs handle their own results, as in Flutter.
 */
export function createSettingsSitesStore(workspaceId: string) {
  const store = createStore<SettingsSitesState>(() => ({
    publishedViews: [],
    namespace: '',
    subscriptionInfo: null,
    isLoading: true,
    homePageView: null,
  }));
  let closed = false;
  const set = (partial: Partial<SettingsSitesState>) => {
    if (!closed) store.setState(partial);
  };

  async function fetchPublishNamespace(): Promise<string> {
    const result = await FolderEventGetPublishNamespace();
    namespaceCache.set(workspaceId, result.ok ? result.value.namespace : null);
    return namespaceCache.get(workspaceId) ?? '';
  }

  const actions = {
    async initial() {
      set({ isLoading: true, namespace: namespaceCache.get(workspaceId) ?? '' });
      const [subscription, namespace] = await Promise.all([UserEventGetWorkspaceSubscriptionInfo({ workspaceId }), fetchPublishNamespace()]);
      set({ subscriptionInfo: subscription.ok ? subscription.value : null, namespace });
      const [views, homePage] = await Promise.all([FolderEventListPublishedViews(), FolderEventGetDefaultPublishInfo()]);
      const publishedViews = views.ok ? sortPublishedViews(views.value.items) : [];
      const homePageId = homePage.ok ? homePage.value.viewId : null;
      set({
        publishedViews,
        homePageView: publishedViews.find((view) => viewIdOf(view) === homePageId) ?? null,
        isLoading: false,
      });
    },

    async unpublishView(viewId: string) {
      const result = await FolderEventUnpublishViews({ viewIds: [viewId] });
      const state = store.getState();
      if (result.ok) {
        set({
          publishedViews: state.publishedViews.filter((view) => viewIdOf(view) !== viewId),
          homePageView: state.homePageView && viewIdOf(state.homePageView) === viewId ? null : state.homePageView,
        });
        showToast({ message: tr('publish.unpublishSuccessfully') });
      } else {
        showToast({
          type: 'error',
          message: (
            <>
              {tr('publish.unpublishFailed')}
              {result.error.msg && <div style={{ opacity: 0.7, fontSize: 'calc(12px * var(--text-scale, 1))' }}>{result.error.msg}</div>}
            </>
          ),
        });
      }
    },

    async updateNamespace(namespace: string): Promise<ActionOutcome> {
      const result = await FolderEventSetPublishNamespace({ newNamespace: namespace });
      if (result.ok) set({ namespace });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },

    async updatePublishName(viewId: string, name: string): Promise<ActionOutcome> {
      const result = await FolderEventSetPublishName({ viewId, newName: name });
      if (result.ok) {
        set({
          publishedViews: store.getState().publishedViews.map((view) =>
            viewIdOf(view) === viewId && view.info ? { ...view, info: { ...view.info, publishName: name } } : view,
          ),
        });
      }
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },

    async upgradeSubscription() {
      const debug = useAppStore.getState().info?.isPackaged === false;
      const result = await UserEventSubscribeWorkspace({
        workspaceId,
        recurringInterval: RecurringIntervalPB.Year,
        workspaceSubscriptionPlan: SubscriptionPlanPB.Pro,
        successUrl: `${debug ? 'https://beta.appflowy.com' : 'https://appflowy.com'}/after-payment?plan=pro`,
      });
      if (result.ok) {
        await window.appflowy.shell.openExternal(result.value.paymentLink).catch(() => {});
      } else {
        showToast({ type: 'error', message: tr('settings.sites.error.failedToGeneratePaymentLink') });
      }
    },

    async setHomePage(viewId: string | null) {
      if (viewId === null) return;
      const result = await FolderEventSetDefaultPublishView({ value: viewId });
      set({ homePageView: store.getState().publishedViews.find((view) => viewIdOf(view) === viewId) ?? null });
      if (result.ok) showToast({ message: tr('settings.sites.success.setHomepageSuccess') });
      else showToast({ type: 'error', message: tr('settings.sites.error.setHomepageFailed') });
    },

    async removeHomePage() {
      const result = await FolderEventRemoveDefaultPublishView();
      if (result.ok) {
        set({ homePageView: null });
        showToast({ message: tr('settings.sites.success.removeHomePageSuccess') });
      } else {
        showToast({ type: 'error', message: tr('settings.sites.error.removeHomePageFailed') });
      }
    },

    close() {
      closed = true;
    },
  };

  return { store, actions };
}

export type SettingsSitesStore = ReturnType<typeof createSettingsSitesStore>;
