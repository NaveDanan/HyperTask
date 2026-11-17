import type { HyperOutlookPresenceState } from '@shared/HyperOutlookPresence';
import type { HyperOutlookBridge } from './HyperOutlookBridge';
import { HyperOutlookWindows, type HyperOutlookProcessState } from './HyperOutlookPresenceWindows';

export interface HyperOutlookPresenceDeps {
  detect(): Promise<HyperOutlookProcessState>;
  launch(): Promise<void>;
  hidden?(): boolean;
  now?(): number;
}
/** Process checks never wait for COM; a blocked profile load must not hide a later process exit. */
export class HyperOutlookPresence {
  private state: HyperOutlookPresenceState = { installed: false, running: false, connected: false };
  private listeners = new Set<(state: HyperOutlookPresenceState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private checking = false;
  private probing = false;
  private stopped = true;
  private generation = 0;
  private identity = '';
  private retryAt = 0;
  private retryStarted = 0;
  private retryDelay = 1000;
  private offAvailability: (() => void) | null = null;
  private launching: Promise<void> | null = null;
  constructor(private bridge: Pick<HyperOutlookBridge, 'request' | 'setRunning' | 'onAvailability'>, private deps: HyperOutlookPresenceDeps = new HyperOutlookWindows()) {}
  current = (): HyperOutlookPresenceState => ({ ...this.state });
  onChange = (listener: (state: HyperOutlookPresenceState) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: HyperOutlookPresenceState) {
    if (state.installed === this.state.installed && state.running === this.state.running && state.connected === this.state.connected) return;
    this.state = state;
    for (const listener of this.listeners) listener(this.current());
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.offAvailability = this.bridge.onAvailability(connected => {
      if (this.stopped || !this.state.running) return;
      if (!connected && this.state.connected) { this.retryStarted = this.now(); this.retryDelay = 1000; this.retryAt = 0; }
      this.publish({ ...this.state, connected });
    });
    void this.check();
  }
  private now() { return this.deps.now?.() ?? Date.now(); }
  private async check() {
    if (this.stopped || this.checking) return;
    this.checking = true;
    try {
      const process = await this.deps.detect();
      if (this.stopped) return;
      const changed = process.identity !== this.identity || process.running !== this.state.running;
      if (changed) {
        this.generation++; this.identity = process.identity;
        this.bridge.setRunning(false);
        this.retryStarted = this.now(); this.retryAt = 0; this.retryDelay = 1000;
      }
      this.bridge.setRunning(process.running);
      this.publish({ installed: this.state.installed || process.installed || process.running, running: process.running, connected: process.running && !changed && this.state.connected });
      if (process.running && !this.probing && this.now() >= this.retryAt) this.probe();
    } catch { /* A failed process check is unknown, not proof that Outlook closed. */ }
    finally {
      this.checking = false;
      if (!this.stopped) { this.timer = setTimeout(() => { this.timer = null; void this.check(); }, this.deps.hidden?.() ? 12000 : 4000); this.timer.unref?.(); }
    }
  }
  private probe() {
    const generation = this.generation;
    this.probing = true;
    void this.bridge.request('status', undefined).then(status => {
      if (!this.stopped && generation === this.generation) this.publish({ ...this.state, connected: this.state.running && status.available });
    }, () => {
      if (!this.stopped && generation === this.generation) this.publish({ ...this.state, connected: false });
    }).finally(() => {
      this.probing = false;
      if (generation !== this.generation) return;
      this.retryAt = this.now() + (this.state.connected || this.now() - this.retryStarted >= 90000 ? 30000 : this.retryDelay);
      this.retryDelay = Math.min(15000, this.retryDelay * 2);
    });
  }
  launch(): Promise<void> {
    this.launching ??= this.deps.launch().finally(() => { this.launching = null; });
    return this.launching;
  }
  stop() { this.stopped = true; this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = null; this.offAvailability?.(); this.offAvailability = null; }
}
