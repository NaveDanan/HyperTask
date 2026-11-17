export const hyperJiraSyncInterval = 5 * 60_000;
export const hyperJiraStartupDelay = 3_500;
export interface HyperJiraSchedulerSource {
  load(syncOnLoad?: boolean): Promise<void>;
  sync(): Promise<void>;
  canSync: boolean;
  snapshot: { lastSuccessAt: Date | null };
}
/** One owner per signed-in user; focus and interval attempts share the store's sync lock. */
export function startHyperJiraScheduler(getState: () => HyperJiraSchedulerSource, focus: Pick<Window, 'addEventListener' | 'removeEventListener'>, now = Date.now) {
  let stopped = false, running = false, ready = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  const loaded = getState().load(false).catch(() => {});
  const tick = async (force = false) => {
    if (stopped || running) return;
    running = true;
    try {
      await loaded;
      const state = getState(), last = state.snapshot.lastSuccessAt?.getTime();
      if (!stopped && state.canSync && (force || last === undefined || now() - last >= hyperJiraSyncInterval)) await state.sync();
    } catch { /* Dashboard retains the error; background sync never toasts. */ }
    finally { running = false; }
  };
  const onFocus = () => { if (ready) void tick(); };
  const startup = setTimeout(() => {
    ready = true; void tick(true);
    interval = setInterval(() => { void tick(true); }, hyperJiraSyncInterval);
  }, hyperJiraStartupDelay);
  focus.addEventListener('focus', onFocus);
  return () => { stopped = true; clearTimeout(startup); clearInterval(interval); focus.removeEventListener('focus', onFocus); };
}
