import { existsSync } from 'node:fs';
import path from 'node:path';
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { HYPER_DESKTOP_HOTKEY_LABEL } from '@shared/HyperDesktop';

export interface HyperTrayLike {
  setToolTip(toolTip: string): void;
  setContextMenu(menu: Menu | null): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  isDestroyed?(): boolean;
  destroy(): void;
}

export interface HyperTrayDeps {
  appRoot: string;
  platform?: NodeJS.Platform;
  hotkeyLabel?: string;
  isMainVisible: () => boolean;
  onAskVoice: () => void;
  onShowMain: () => void;
  onHideMain: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
  createTray?: (icon: NativeImage | string) => HyperTrayLike;
  buildMenu?: (template: MenuItemConstructorOptions[]) => Menu;
  createImageFromPath?: (filePath: string) => NativeImage;
  createEmptyImage?: () => NativeImage;
  exists?: (filePath: string) => boolean;
}

/** Resolves the best tray icon path available for the current platform. */
export function resolveHyperTrayIconPath(
  appRoot: string,
  platform: NodeJS.Platform,
  exists: (filePath: string) => boolean = existsSync,
): string | null {
  const candidates =
    platform === 'win32'
      ? [
          path.join(appRoot, 'resources/hypertask.ico'),
          path.join(appRoot, 'out/renderer/favicon.png'),
          path.join(appRoot, 'src/renderer/public/favicon.png'),
        ]
      : [
          path.join(appRoot, 'resources/hypertask.png'),
          path.join(appRoot, 'out/renderer/favicon.png'),
          path.join(appRoot, 'src/renderer/public/favicon.png'),
          path.join(appRoot, 'resources/hypertask.ico'),
        ];
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

/** Manages the HyperTask system tray icon, tooltip, left-click restore, and context menu. */
export class HyperTray {
  private tray: HyperTrayLike | null = null;
  private readonly platform: NodeJS.Platform;
  private readonly hotkeyLabel: string;
  private readonly createTrayImpl: (icon: NativeImage | string) => HyperTrayLike;
  private readonly buildMenuImpl: (template: MenuItemConstructorOptions[]) => Menu;
  private readonly createImageFromPathImpl: (filePath: string) => NativeImage;
  private readonly createEmptyImageImpl: () => NativeImage;
  private readonly existsImpl: (filePath: string) => boolean;

  constructor(private readonly deps: HyperTrayDeps) {
    this.platform = deps.platform ?? process.platform;
    this.hotkeyLabel = deps.hotkeyLabel ?? HYPER_DESKTOP_HOTKEY_LABEL;
    this.createTrayImpl = deps.createTray ?? ((icon) => new Tray(icon));
    this.buildMenuImpl = deps.buildMenu ?? ((template) => Menu.buildFromTemplate(template));
    this.createImageFromPathImpl = deps.createImageFromPath ?? ((filePath) => nativeImage.createFromPath(filePath));
    this.createEmptyImageImpl = deps.createEmptyImage ?? (() => nativeImage.createEmpty());
    this.existsImpl = deps.exists ?? existsSync;
  }

  private loadIcon(): NativeImage {
    const iconPath = resolveHyperTrayIconPath(this.deps.appRoot, this.platform, this.existsImpl);
    if (!iconPath) return this.createEmptyImageImpl();
    let image = this.createImageFromPathImpl(iconPath);
    if (this.platform === 'darwin' && !image.isEmpty?.()) {
      image = image.resize({ width: 18, height: 18 });
    } else if (this.platform === 'linux' && !image.isEmpty?.()) {
      image = image.resize({ width: 22, height: 22 });
    }
    return image;
  }

  buildTemplate(): MenuItemConstructorOptions[] {
    const visible = this.deps.isMainVisible();
    return [
      {
        label: `Ask Hyper-Bot (${this.hotkeyLabel})`,
        click: () => this.deps.onAskVoice(),
      },
      {
        label: visible ? 'Hide HyperTask' : 'Show HyperTask',
        click: () => (visible ? this.deps.onHideMain() : this.deps.onShowMain()),
      },
      {
        label: 'Settings',
        click: () => this.deps.onOpenSettings(),
      },
      { type: 'separator' },
      {
        label: 'Quit HyperTask',
        click: () => this.deps.onQuit(),
      },
    ];
  }

  init(): void {
    if (this.tray) return;
    const tray = this.createTrayImpl(this.loadIcon());
    tray.setToolTip('HyperTask');
    tray.on('click', () => this.deps.onShowMain());
    tray.on('double-click', () => this.deps.onShowMain());
    tray.on('right-click', () => this.refreshMenu());
    this.tray = tray;
    this.refreshMenu();
  }

  refreshMenu(): void {
    if (!this.tray || this.tray.isDestroyed?.()) return;
    this.tray.setContextMenu(this.buildMenuImpl(this.buildTemplate()));
  }

  dispose(): void {
    if (!this.tray) return;
    const current = this.tray;
    this.tray = null;
    try {
      if (!current.isDestroyed?.()) current.destroy();
    } catch {
      /* Ignore tray teardown errors during app shutdown. */
    }
  }
}
