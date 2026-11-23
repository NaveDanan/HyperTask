import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';

export type HyperTrustedIpcEvent =
  | Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>
  | Pick<IpcMainEvent, 'sender' | 'senderFrame'>;

export interface HyperTrustedWindowRegistry {
  isTrustedSender(event: HyperTrustedIpcEvent): boolean;
  broadcast(channel: string, payload: unknown): void;
  webContents(): WebContents[];
}

function liveWebContents(window: BrowserWindow | null | undefined): WebContents | null {
  if (!window || window.isDestroyed?.()) return null;
  const contents = window.webContents;
  if (!contents || contents.isDestroyed?.()) return null;
  return contents;
}

/** Tracks trusted HyperTask BrowserWindows (main window + voice overlay) for IPC verification and event broadcast. */
export class HyperTrustedWindows implements HyperTrustedWindowRegistry {
  private readonly registered = new Set<BrowserWindow>();

  add(window: BrowserWindow): () => void {
    this.registered.add(window);
    const remove = () => {
      this.registered.delete(window);
    };
    window.once?.('closed', remove);
    return remove;
  }

  remove(window: BrowserWindow): void {
    this.registered.delete(window);
  }

  windows(): BrowserWindow[] {
    const live: BrowserWindow[] = [];
    for (const window of this.registered) {
      if (window.isDestroyed?.()) {
        this.registered.delete(window);
      } else {
        live.push(window);
      }
    }
    return live;
  }

  webContents(): WebContents[] {
    const list: WebContents[] = [];
    for (const window of this.windows()) {
      const contents = liveWebContents(window);
      if (contents) list.push(contents);
    }
    return list;
  }

  hasWebContents(contents: WebContents | null | undefined): boolean {
    if (!contents || contents.isDestroyed?.()) return false;
    return this.webContents().includes(contents);
  }

  isTrustedSender(event: HyperTrustedIpcEvent): boolean {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed?.()) return false;
    if (event.senderFrame !== sender.mainFrame) return false;
    return this.hasWebContents(sender);
  }

  broadcast(channel: string, payload: unknown): void {
    for (const contents of this.webContents()) {
      try {
        contents.send(channel, payload);
      } catch {
        /* The window or its render frame is going away. */
      }
    }
  }
}

export type HyperWindowSource = (() => BrowserWindow | null) | HyperTrustedWindowRegistry;

export function isHyperTrustedWindowRegistry(source: HyperWindowSource): source is HyperTrustedWindowRegistry {
  return typeof source === 'object' && source !== null && typeof source.isTrustedSender === 'function';
}

/** Wraps either a legacy single-window getter or a HyperTrustedWindowRegistry into a uniform registry interface. */
export function hyperTrustedWindowAdapter(source: HyperWindowSource): HyperTrustedWindowRegistry {
  if (isHyperTrustedWindowRegistry(source)) return source;
  return {
    webContents() {
      const contents = liveWebContents(source());
      return contents ? [contents] : [];
    },
    isTrustedSender(event: HyperTrustedIpcEvent) {
      const contents = liveWebContents(source());
      return !!contents && event?.sender === contents && event.senderFrame === contents.mainFrame;
    },
    broadcast(channel: string, payload: unknown) {
      const contents = liveWebContents(source());
      if (!contents) return;
      try {
        contents.send(channel, payload);
      } catch {
        /* The window or its render frame is going away. */
      }
    },
  };
}
