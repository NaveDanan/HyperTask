import path from 'node:path';
import {
  BrowserWindow,
  screen,
  systemPreferences,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from 'electron';
import {
  HyperDesktopChannel,
  type HyperDesktopOverlayBounds,
  type HyperDesktopOverlayEvent,
} from '@shared/HyperDesktop';
import type { HyperTrustedWindows } from './HyperTrustedWindows';

export const HYPER_OVERLAY_DEFAULT_SIZE: HyperDesktopOverlayBounds = { width: 320, height: 320 };
const OVERLAY_MIN_WIDTH = 220;
const OVERLAY_MIN_HEIGHT = 220;
const OVERLAY_MAX_WIDTH = 640;
const OVERLAY_MAX_HEIGHT = 760;
const OVERLAY_EDGE_MARGIN = 24;

export function clampOverlayBounds(workArea: Rectangle, requested: HyperDesktopOverlayBounds): Rectangle {
  const maxWidth = Math.max(OVERLAY_MIN_WIDTH, Math.min(OVERLAY_MAX_WIDTH, workArea.width - OVERLAY_EDGE_MARGIN * 2));
  const maxHeight = Math.max(OVERLAY_MIN_HEIGHT, Math.min(OVERLAY_MAX_HEIGHT, workArea.height - OVERLAY_EDGE_MARGIN * 2));
  const width = Math.min(maxWidth, Math.max(OVERLAY_MIN_WIDTH, Math.round(requested.width)));
  const height = Math.min(maxHeight, Math.max(OVERLAY_MIN_HEIGHT, Math.round(requested.height)));
  const bottomMargin = Math.min(72, Math.max(OVERLAY_EDGE_MARGIN, Math.round(workArea.height * 0.08)));
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const idealY = workArea.y + workArea.height - height - bottomMargin;
  const y = Math.round(Math.max(workArea.y + OVERLAY_EDGE_MARGIN, Math.min(workArea.y + workArea.height - height - OVERLAY_EDGE_MARGIN, idealY)));
  return { x, y, width, height };
}

export interface HyperVoiceOverlayWindowDeps {
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl?: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  trustedWindows: Pick<HyperTrustedWindows, 'add' | 'remove'>;
  createBrowserWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  getCursorWorkArea?: () => Rectangle;
  askMicrophoneAccess?: () => Promise<boolean>;
}

/**
 * Owns the floating, frameless, transparent, always-on-top overlay BrowserWindow for the Hyper-Bot
 * spinning voice sphere and inline confirmation HUD. Pre-warmed and reused across triggers.
 */
export class HyperVoiceOverlayWindow {
  private win: BrowserWindow | null = null;
  private readyPromise: Promise<void> | null = null;
  private disposing = false;
  private currentSize: HyperDesktopOverlayBounds = { ...HYPER_OVERLAY_DEFAULT_SIZE };
  private activeWorkArea: Rectangle | null = null;

  private readonly platform: NodeJS.Platform;
  private readonly createBrowserWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  private readonly getCursorWorkArea: () => Rectangle;
  private readonly askMicrophoneAccess: () => Promise<boolean>;

  constructor(private readonly deps: HyperVoiceOverlayWindowDeps) {
    this.platform = deps.platform ?? process.platform;
    this.createBrowserWindow = deps.createBrowserWindow ?? ((options) => new BrowserWindow(options));
    this.getCursorWorkArea =
      deps.getCursorWorkArea ??
      (() => {
        const point = screen.getCursorScreenPoint();
        return screen.getDisplayNearestPoint(point).workArea;
      });
    this.askMicrophoneAccess =
      deps.askMicrophoneAccess ??
      (async () => {
        if (this.platform !== 'darwin') return true;
        if (typeof systemPreferences.getMediaAccessStatus === 'function') {
          if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
        }
        if (typeof systemPreferences.askForMediaAccess === 'function') {
          return systemPreferences.askForMediaAccess('microphone').catch(() => false);
        }
        return true;
      });
  }

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed?.() ? this.win : null;
  }

  private overlayDevUrl(): string | null {
    if (this.deps.isPackaged || !this.deps.rendererUrl) return null;
    const sep = this.deps.rendererUrl.includes('?') ? '&' : '?';
    return `${this.deps.rendererUrl}${sep}mode=voice-overlay`;
  }

  private ensureCreated(): Promise<void> {
    if (this.win && !this.win.isDestroyed?.() && this.readyPromise) {
      return this.readyPromise;
    }
    const workArea = this.getCursorWorkArea();
    this.activeWorkArea = workArea;
    const initialBounds = clampOverlayBounds(workArea, this.currentSize);
    const win = this.createBrowserWindow({
      ...initialBounds,
      show: false,
      frame: false,
      transparent: true,
      thickFrame: false,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      title: 'Hyper-Bot Voice',
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop?.(true, 'floating');
    win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    this.deps.trustedWindows.add(win);

    win.on('close', (event) => {
      if (!this.disposing) {
        event.preventDefault();
        this.hide();
      }
    });
    win.on('closed', () => {
      this.deps.trustedWindows.remove(win);
      if (this.win === win) {
        this.win = null;
        this.readyPromise = null;
      }
    });

    win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    win.webContents.on?.('will-navigate', (event, url) => {
      if (url !== win.webContents.getURL?.()) event.preventDefault();
    });

    this.win = win;
    const devUrl = this.overlayDevUrl();
    this.readyPromise = (
      devUrl
        ? win.loadURL(devUrl)
        : win.loadFile(path.resolve(this.deps.rendererHtmlPath), { query: { mode: 'voice-overlay' } })
    ).catch((error) => {
      console.error('[hyper-desktop] failed to load voice overlay', error);
      throw error;
    });
    return this.readyPromise;
  }

  async prewarm(): Promise<void> {
    if (this.disposing) return;
    await this.ensureCreated().catch(() => undefined);
  }

  private sendEvent(event: HyperDesktopOverlayEvent): void {
    const win = this.window;
    if (!win || win.webContents.isDestroyed?.()) return;
    try {
      win.webContents.send(HyperDesktopChannel.OverlayEvent, event);
    } catch {
      /* Ignore delivery error if overlay is tearing down. */
    }
  }

  async trigger(source: 'hotkey' | 'tray' | 'ipc'): Promise<void> {
    if (this.disposing) return;
    await this.ensureCreated();
    const win = this.window;
    if (!win) return;
    if (this.platform === 'darwin') {
      void this.askMicrophoneAccess().catch(() => false);
    }
    const visible = win.isVisible?.() ?? false;
    if (!visible) {
      const workArea = this.getCursorWorkArea();
      this.activeWorkArea = workArea;
      const bounds = clampOverlayBounds(workArea, this.currentSize);
      win.setBounds?.(bounds, false);
      win.setAlwaysOnTop?.(true, 'floating');
      win.show();
    }
    win.focus?.();
    this.sendEvent({ type: 'trigger', source });
  }

  resize(bounds: HyperDesktopOverlayBounds): void {
    this.currentSize = {
      width: Number.isFinite(bounds.width) ? bounds.width : this.currentSize.width,
      height: Number.isFinite(bounds.height) ? bounds.height : this.currentSize.height,
    };
    const win = this.window;
    if (!win) return;
    const workArea = this.activeWorkArea ?? this.getCursorWorkArea();
    const next = clampOverlayBounds(workArea, this.currentSize);
    win.setBounds?.(next, false);
  }

  hide(): void {
    const win = this.window;
    if (!win) return;
    const wasVisible = win.isVisible?.() ?? true;
    win.hide?.();
    if (wasVisible) {
      this.sendEvent({ type: 'hidden' });
    }
  }

  dispose(): void {
    this.disposing = true;
    const win = this.win;
    this.win = null;
    this.readyPromise = null;
    if (!win) return;
    this.deps.trustedWindows.remove(win);
    try {
      if (!win.isDestroyed?.()) win.destroy();
    } catch {
      /* Ignore teardown error on exit. */
    }
  }
}
