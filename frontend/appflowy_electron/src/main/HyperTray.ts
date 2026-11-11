import { Menu, Tray, type BrowserWindow, type NativeImage } from 'electron';

/** Keeps the window and its core connection alive until the application quits. */
export class HyperTray {
  private readonly tray: Tray;

  constructor(icon: NativeImage | string, open: () => void, quit: () => void) {
    this.tray = new Tray(icon);
    this.tray.setToolTip('HyperTask');
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open HyperTask', click: open },
      { type: 'separator' },
      { label: 'Quit HyperTask', click: quit },
    ]));
    this.tray.on('click', open);
    this.tray.on('double-click', open);
  }

  attach(window: BrowserWindow, isQuitting: () => boolean) {
    window.on('close', (event) => {
      if (isQuitting() || this.tray.isDestroyed()) return;
      event.preventDefault();
      window.hide();
    });
  }

  destroy() {
    this.tray.destroy();
  }
}
