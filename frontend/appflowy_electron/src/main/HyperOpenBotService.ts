import type { HyperOpenBotBackendReport, HyperOpenBotServiceAction, HyperOpenBotServiceProblem, HyperOpenBotServiceState } from '@shared/HyperOpenBotService';
export interface HyperOpenBotServiceDependencies {
  supported: boolean;
  authorize(): Promise<{ signal: AbortSignal; assertCurrent(): void }>;
  execute(action: Exclude<HyperOpenBotServiceAction, 'ensure'>, signal: AbortSignal): Promise<HyperOpenBotBackendReport>;
  saveAutoStart(value: boolean): Promise<void>;
  disconnect(): void;
}
export class HyperOpenBotServiceError extends Error {
  constructor(readonly problem: HyperOpenBotServiceProblem) { super(problem); }
}
/** Owns operation ordering and authentication cancellation; never accepts a shell command. */
export class HyperOpenBotService {
  private version = 0;
  private listeners = new Set<(state: HyperOpenBotServiceState) => void>();
  private operation?: { action: string; controller: AbortController; promise: Promise<HyperOpenBotServiceState> };
  private state: HyperOpenBotServiceState;
  private configuration: Promise<unknown> = Promise.resolve();
  constructor(private readonly dependencies: HyperOpenBotServiceDependencies, autoStart: boolean) {
    this.state = { backend: 'mmems-personal', phase: 'idle', ready: false, problem: dependencies.supported ? 'services_stopped' : 'unsupported', checks: [], autoStart, checkedAt: null };
  }
  snapshot(): HyperOpenBotServiceState { return { ...this.state, checks: this.state.checks.map(row => ({ ...row })) }; }
  subscribe(listener: (state: HyperOpenBotServiceState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private update(change: Partial<HyperOpenBotServiceState>) {
    const wasReady = this.state.ready;
    this.state = { ...this.state, ...change };
    if (wasReady && !this.state.ready) this.dependencies.disconnect();
    for (const listener of this.listeners) { try { listener(this.snapshot()); } catch { /* A closed renderer must not interrupt service management. */ } }
  }
  /** Native sign-out/core exit invalidates status and pending results synchronously. */
  invalidate() {
    ++this.version;
    this.operation?.controller.abort(); this.operation = undefined;
    const wasReady = this.state.ready;
    this.update({ ready: false, phase: 'idle', problem: 'signed_out', checks: [], checkedAt: null });
    if (!wasReady) this.dependencies.disconnect();
  }
  async configure(autoStart: boolean) {
    const lease = await this.dependencies.authorize(); lease.assertCurrent();
    const work = this.configuration.catch(() => {}).then(async () => {
      lease.assertCurrent(); await this.dependencies.saveAutoStart(autoStart); lease.assertCurrent();
      this.update({ autoStart }); return this.snapshot();
    });
    this.configuration = work;
    return work;
  }
  async run(action: HyperOpenBotServiceAction): Promise<HyperOpenBotServiceState> {
    if (action === 'ensure') {
      const status = await this.run('check');
      return status.autoStart && status.problem === 'services_stopped' ? this.run('start') : status;
    }
    if (!this.dependencies.supported) return this.snapshot();
    if (this.operation) {
      if (action === 'check' || this.operation.action === action) return this.operation.promise;
      throw new HyperOpenBotServiceError('operation_failed');
    }
    const version = this.version;
    const controller = new AbortController();
    // Defer so the operation record exists before authorization or remote execution can settle.
    const promise = Promise.resolve().then(async () => {
      try {
        const lease = await this.dependencies.authorize(); lease.assertCurrent();
        controller.signal.throwIfAborted();
        if (version !== this.version) return this.snapshot();
        this.update({ phase: action === 'check' ? 'checking' : action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'restarting', ...(action === 'check' ? {} : { ready: false }) });
        const result = await this.dependencies.execute(action, AbortSignal.any([controller.signal, lease.signal]));
        lease.assertCurrent(); controller.signal.throwIfAborted();
        if (version === this.version) this.update({ ready: result.ready, problem: result.problem, checks: result.checks, phase: 'idle', checkedAt: new Date().toISOString() });
      } catch (error) {
        if (version === this.version && !controller.signal.aborted) this.update({ ready: false, phase: 'idle', problem: error instanceof HyperOpenBotServiceError ? error.problem : 'signed_out', checkedAt: new Date().toISOString() });
      } finally { if (this.operation?.controller === controller) this.operation = undefined; }
      return this.snapshot();
    });
    this.operation = { action, controller, promise };
    return promise;
  }
}
