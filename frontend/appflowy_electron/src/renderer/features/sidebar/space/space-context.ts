import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { sidebarSpace, type SpaceState, type SpaceStore } from '../stores/space-store';

/** context.read<SpaceBloc>(): the sidebar's bloc, or a fresh one (the move-to menu provides its own). */
export const SpaceStoreContext = createContext<SpaceStore>(sidebarSpace);

export const useSpaceBloc = () => useContext(SpaceStoreContext);

export function useSpaceState<U>(selector: (state: SpaceState) => U): U {
  return useStore(useSpaceBloc().store, selector);
}
