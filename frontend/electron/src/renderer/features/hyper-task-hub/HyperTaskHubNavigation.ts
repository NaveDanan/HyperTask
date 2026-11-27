// Opening Task Hub from elsewhere (HyperHome, the command palette) on a chosen view. The Hub page consumes
// the request once, so a later visit keeps the owner's saved view.
import { create } from 'zustand';
import { localToolPlugin } from '@/features/tabs/plugin';
import { tabsActions } from '@/features/tabs/tabs-store';
import type { HyperTaskHubViewId } from './HyperTaskHubView';

interface HyperTaskHubNavigation {
  view: HyperTaskHubViewId | null;
  clear: () => void;
}

export const useHyperTaskHubNavigation = create<HyperTaskHubNavigation>(set => ({ view: null, clear: () => set({ view: null }) }));

export function hyperOpenTaskHub(view?: HyperTaskHubViewId): void {
  if (view) useHyperTaskHubNavigation.setState({ view });
  tabsActions.openPlugin(localToolPlugin('taskhub'));
}
