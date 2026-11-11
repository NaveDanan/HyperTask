import type { WebContents } from 'electron';

export interface HyperRowActivityRequest {
  viewId: string;
  contextId: string;
  activityId: string;
  revision: bigint;
  rowIds: string[];
  closeActivity: boolean;
}
export interface HyperRowActivityAck { contextId: string; activityId: string; revision: bigint }
export interface HyperRowActivityReply<T> { value: T; ack?: HyperRowActivityAck }
export const hyperRowActivityMaxRendererRevision = (1n << 64n) - 2n;
export const hyperRowActivityTrackerLimits = { total: 512, sender: 128 } as const;

interface HyperActivityFrame { frameTreeNodeId: number; url: string; parent: HyperActivityFrame | null; isDestroyed(): boolean }
interface HyperActivitySender { id: number; isDestroyed(): boolean }
interface HyperActivityOwner { webContentsId: number; mainFrame: HyperActivityFrame; rendererURL: string; isDestroyed(): boolean }
function documentUrl(value: string): string | null {
  try { const url = new URL(value); if (!['file:', 'http:', 'https:'].includes(url.protocol)) return null; url.hash = ''; return url.href; } catch { return null; }
}
/** Match the app's trusted top-level document, using the same frame identity and
 * normalized renderer URL checks as its existing native player boundary. */
export function hyperRowActivityTrustedSender(sender: HyperActivitySender, frame: HyperActivityFrame | null, owner: HyperActivityOwner | null): boolean {
  try {
    if (!owner || owner.isDestroyed() || sender.isDestroyed() || sender.id !== owner.webContentsId || !frame || frame.isDestroyed() || frame.parent !== null) return false;
    const main = owner.mainFrame, trusted = documentUrl(owner.rendererURL);
    return !main.isDestroyed() && frame.frameTreeNodeId === main.frameTreeNodeId && !!trusted && documentUrl(frame.url) === trusted && documentUrl(main.url) === trusted;
  } catch { return false; }
}

interface Renderer {
  id: number;
  generation: number;
  accepting: boolean;
}
export interface HyperRowActivityDocument {
  readonly renderer: Renderer;
  readonly generation: number;
}
interface Activity {
  renderer: Renderer;
  documentGeneration: number;
  coreGeneration: number;
  request: HyperRowActivityRequest;
  retired: boolean;
  cleanupRevision: bigint | null;
}
export class HyperRowActivityIpcError extends Error {
  constructor(public readonly code: 'retired' | 'limit' | 'revision' | 'binding' | 'invalid') {
    super(code === 'limit' ? 'Too many database row subscriptions are awaiting cleanup. Reopen the app.' : 'The database row subscription belongs to an unavailable renderer or view. Reopen the view.');
    this.name = 'HyperRowActivityIpcError';
  }
}

/** Main owns these records because React cleanup cannot run after renderer loss.
 * No native process is started or reset by cleanup. Pending and failed activations
 * remain tracked: native may have accepted their desired pins before an error. */
export class HyperRowActivityIpc {
  private readonly renderers = new Map<number, Renderer>();
  private readonly activities = new Set<Activity>();
  private coreGeneration = 0;

  constructor(private readonly options: {
    /** Return null unless the existing core is available. Never start it here. */
    existingCore(): ((request: HyperRowActivityRequest) => Promise<HyperRowActivityAck | undefined>) | null;
    limits?: { total: number; sender: number };
  }) {}

  get trackedCount() { return this.activities.size; }

  attach(senderId: number) {
    const prior = this.renderers.get(senderId);
    if (prior) this.retire(prior);
    const renderer: Renderer = { id: senderId, generation: 0, accepting: false };
    this.renderers.set(senderId, renderer);
    return {
      capture: (): HyperRowActivityDocument => ({ renderer, generation: renderer.generation }),
      ready: () => { if (this.renderers.get(senderId) === renderer) renderer.accepting = true; },
      navigate: (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) this.retire(renderer); },
      gone: () => this.retire(renderer),
      destroy: () => { this.retire(renderer); if (this.renderers.get(senderId) === renderer) this.renderers.delete(senderId); },
    };
  }

  /** Only a successful SDK replacement or actual child exit proves every old
   * context has retired. A failed initialization attempt must not call this. */
  coreReplaced() { this.coreGeneration++; this.activities.clear(); }
  coreExited() { this.coreGeneration++; this.activities.clear(); }

  /** After proven SDK retirement and with no existing core, a captured terminal
   * close is already complete. The typed adapter may echo this ACK without ever
   * starting a process. Pending old activation dispatches lose their record. */
  terminalAckWithoutCore(document: HyperRowActivityDocument, request: HyperRowActivityRequest): HyperRowActivityAck | undefined {
    this.validate(request);
    if (!request.closeActivity || this.coreGeneration === 0) return undefined;
    try { if (this.options.existingCore()) return undefined; } catch { return undefined; }
    const activity = [...this.activities].find(value => value.request.contextId === request.contextId && value.request.activityId === request.activityId);
    if (activity && (activity.renderer !== document.renderer || activity.request.viewId !== request.viewId)) throw new HyperRowActivityIpcError('binding');
    if (activity) { activity.retired = true; this.activities.delete(activity); }
    return { contextId: request.contextId, activityId: request.activityId, revision: request.revision };
  }

  private current(document: HyperRowActivityDocument) {
    return this.renderers.get(document.renderer.id) === document.renderer && document.renderer.accepting && document.generation === document.renderer.generation;
  }
  private validate(request: HyperRowActivityRequest) {
    if (typeof request.revision !== 'bigint' || request.revision <= 0n || request.revision > hyperRowActivityMaxRendererRevision) throw new HyperRowActivityIpcError('revision');
    if ([request.viewId, request.contextId, request.activityId].some(value => typeof value !== 'string' || !value || value.length > 128 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value))
      || !Array.isArray(request.rowIds) || typeof request.closeActivity !== 'boolean' || request.closeActivity && request.rowIds.length > 0
      || request.rowIds.length > 512 || request.rowIds.some(value => typeof value !== 'string' || !value || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value))) throw new HyperRowActivityIpcError('invalid');
  }

  /** Call before awaiting startup. The adapter validates the trusted main-frame
   * sender and captures its document before invoking this method. */
  async forward<T>(document: HyperRowActivityDocument, input: HyperRowActivityRequest, start: () => Promise<void>, dispatch: (request: HyperRowActivityRequest) => Promise<HyperRowActivityReply<T>>): Promise<T> {
    this.validate(input);
    const request = { ...input, rowIds: [...input.rowIds] }, generation = this.coreGeneration;
    let activity = [...this.activities].find(value => value.coreGeneration === generation && value.request.contextId === request.contextId && value.request.activityId === request.activityId);
    if (activity && (activity.renderer !== document.renderer || activity.request.viewId !== request.viewId)) throw new HyperRowActivityIpcError('binding');
    if (!request.closeActivity ? !this.current(document) || !!activity?.retired : !this.current(document) && !activity) throw new HyperRowActivityIpcError('retired');
    if (!activity) {
      const limits = this.options.limits ?? hyperRowActivityTrackerLimits;
      if (this.activities.size >= limits.total || [...this.activities].filter(value => value.renderer === document.renderer).length >= limits.sender) throw new HyperRowActivityIpcError('limit');
      activity = { renderer: document.renderer, documentGeneration: document.generation, coreGeneration: generation, request, retired: false, cleanupRevision: null };
      this.activities.add(activity);
    } else if (request.revision > activity.request.revision) activity.request = request;
    // A terminal intent retires the activity locally before any startup/dispatch
    // await. Native may reject the close while an older validation is still in
    // flight; its later completion is a concrete opportunity to finish cleanup.
    if (request.closeActivity && request.revision >= activity.request.revision) activity.retired = true;
    try {
      if (!request.closeActivity) await start();
      if (generation !== this.coreGeneration || !this.activities.has(activity)) throw new HyperRowActivityIpcError('retired');
      if (!request.closeActivity && (!this.current(document) || activity.retired)) { this.cleanup(activity); throw new HyperRowActivityIpcError('retired'); }
      const reply = await dispatch(request);
      if (request.closeActivity && this.matches(reply.ack, request) && activity.request.revision === request.revision) this.activities.delete(activity);
      return reply.value;
    } finally {
      // A late empty request can carry a newer revision than the first navigation
      // cleanup. Release that captured revision once too, without a polling loop.
      if (activity.retired) this.cleanup(activity);
    }
  }

  private matches(ack: HyperRowActivityAck | undefined, request: HyperRowActivityRequest) {
    return !!ack && ack.contextId === request.contextId && ack.activityId === request.activityId && ack.revision === request.revision;
  }

  private retire(renderer: Renderer) {
    renderer.accepting = false;
    renderer.generation++;
    for (const activity of this.activities) {
      if (activity.renderer === renderer) { activity.retired = true; this.cleanup(activity); }
    }
  }

  private cleanup(activity: Activity) {
    if (!this.activities.has(activity) || activity.coreGeneration !== this.coreGeneration) return;
    const revision = activity.request.revision + 1n;
    if (activity.cleanupRevision !== null && activity.cleanupRevision >= revision) return;
    let send: ReturnType<typeof this.options.existingCore>;
    try { send = this.options.existingCore(); } catch { return; }
    if (!send) return;
    activity.cleanupRevision = revision;
    const request = { ...activity.request, revision, rowIds: [], closeActivity: true };
    // An error keeps the record and allows a later concrete lifecycle event to
    // retry. No timer or failure callback schedules another attempt.
    void Promise.resolve().then(() => {
      if (activity.coreGeneration !== this.coreGeneration || !this.activities.has(activity)) return undefined;
      return send(request);
    }).then(ack => {
      if (activity.coreGeneration !== this.coreGeneration || !this.activities.has(activity)) return;
      if (this.matches(ack, request) && activity.request.revision < revision) this.activities.delete(activity);
      else if (activity.cleanupRevision === revision) activity.cleanupRevision = null;
    }).catch(() => { if (activity.cleanupRevision === revision) activity.cleanupRevision = null; });
  }
}

/** Hook only document-loss events. Iframe loads, hash changes and tray hiding
 * leave the current pane subscriptions intact. */
export function hyperBindRowActivityRenderer(tracker: HyperRowActivityIpc, contents: Pick<WebContents, 'id' | 'on' | 'removeListener'>) {
  const renderer = tracker.attach(contents.id);
  const navigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => renderer.navigate(details);
  const ready = () => renderer.ready();
  const gone = () => renderer.gone();
  const remove = () => {
    contents.removeListener('did-start-navigation', navigate);
    contents.removeListener('dom-ready', ready);
    contents.removeListener('render-process-gone', gone);
    contents.removeListener('destroyed', destroyed);
  };
  const destroyed = () => { renderer.destroy(); remove(); };
  contents.on('did-start-navigation', navigate);
  contents.on('dom-ready', ready);
  contents.on('render-process-gone', gone);
  contents.on('destroyed', destroyed);
  return { capture: renderer.capture, dispose: () => { renderer.destroy(); remove(); } };
}
