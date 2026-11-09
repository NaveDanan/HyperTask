import { create } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';

// Global notifiers from workspace/presentation/home/hotkeys.dart, as a tiny event bus.

type Listener<T> = (value: T) => void;

function bus<T = void>() {
  const listeners = new Set<Listener<T>>();
  return {
    emit: (value: T) => listeners.forEach((l) => l(value)),
    on: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** switchToTheNextSpace (Mod+O). */
export const switchToNextSpace = bus();
/** createNewPageNotifier (Mod+N). */
export const createNewPage = bus();
/** openSettingsHotKey (Mod+,). */
export const openSettings = bus<string | void>();
/** RenameViewBloc.open (F2): rename the selected sidebar item. */
export const renameSelectedView = bus();
/** CommandPalette toggle (Mod+P). */
export const toggleCommandPalette = bus();
/** AFFocusManager.notifyLoseFocus: blur the editor when clicking shell chrome. */
export const loseFocus = bus();

/** switchToSpaceNotifier: set to make the sidebar show the given space. */
export const useSwitchToSpace = create<{ space: ViewPB | null }>(() => ({ space: null }));
