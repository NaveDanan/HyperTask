export const HYPER_DESKTOP_DEFAULT_HOTKEY = 'Control+Alt+Space';
export const HYPER_DESKTOP_HOTKEY_LABEL = 'Ctrl+Alt+Space';
export const HYPER_DESKTOP_AUTOSTART_ARG = '--hyper-autostart';

export const HyperDesktopChannel = {
  GetSettings: 'hyper-desktop:get-settings',
  SetSettings: 'hyper-desktop:set-settings',
  OverlayResize: 'hyper-desktop:overlay-resize',
  OverlayHide: 'hyper-desktop:overlay-hide',
  OverlayOpenMain: 'hyper-desktop:overlay-open-main',
  OverlayEvent: 'hyper-desktop:overlay-event',
  MainEvent: 'hyper-desktop:main-event',
} as const;

export interface HyperDesktopSettingsPatch {
  autoStart?: boolean;
  closeToTray?: boolean;
}

export interface HyperDesktopSettingsSnapshot {
  autoStart: boolean;
  closeToTray: boolean;
  autoStartSupported: boolean;
  autoStartApplied: boolean;
  hotkey: string;
  hotkeyRegistered: boolean;
  hotkeyError?: string;
}

export type HyperDesktopOverlayEvent =
  | { type: 'trigger'; source: 'hotkey' | 'tray' | 'ipc' }
  | { type: 'hidden' };

export type HyperDesktopMainEvent = {
  type: 'navigate';
  route: 'hyper-bots' | 'settings';
  roomId?: string;
  settingsPage?: string;
};

export interface HyperDesktopOpenMainTarget {
  route?: 'hyper-bots' | 'settings';
  roomId?: string;
  settingsPage?: string;
}

export interface HyperDesktopOverlayBounds {
  width: number;
  height: number;
}

export interface HyperDesktopApi {
  getSettings(): Promise<HyperDesktopSettingsSnapshot>;
  setSettings(patch: HyperDesktopSettingsPatch): Promise<HyperDesktopSettingsSnapshot>;
  resizeOverlay(bounds: HyperDesktopOverlayBounds): Promise<void>;
  hideOverlay(): Promise<void>;
  openMain(target?: HyperDesktopOpenMainTarget): Promise<void>;
  onOverlayEvent(listener: (event: HyperDesktopOverlayEvent) => void): () => void;
  onMainEvent(listener: (event: HyperDesktopMainEvent) => void): () => void;
}
