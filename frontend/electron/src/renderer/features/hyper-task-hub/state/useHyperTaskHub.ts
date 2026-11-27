import { create } from 'zustand';
import type { HyperHubFeedbackEvent, HyperHubSetupOptions, HyperHubFeedbackResult, HyperHubOpenResult, HyperHubSetupScope,
  HyperHubVersion, HyperTaskHubM5Actions, HyperHubSnapshot, HyperTaskHubApi } from '@shared/HyperTaskHub';
import { HyperTaskHubClient, hyperHubOptimisticTasks } from './HyperTaskHubClient';

type Intent<T> = T extends unknown ? Omit<T, 'expectedRevision' | 'scopeGeneration'> : never;
export type HyperHubFeedbackIntent = Intent<HyperHubFeedbackEvent>;
export interface HyperTaskHubState extends HyperTaskHubM5Actions {
  snapshot: HyperHubSnapshot | null;
  brief: import('@shared/HyperMeetingBrief').HyperMeetingBrief | null;
  summariesAvailable: boolean;
  summary: Extract<import('@shared/HyperTaskHub').HyperHubSummaryResult, { ok: true }> | null;
  getBrief(meetingId: string): Promise<import('@shared/HyperTaskHub').HyperHubBriefResult>;
  openBriefEvidence(meetingId: string, evidenceId: string): Promise<HyperHubOpenResult>;
  summarizeBrief(meetingId: string, evidenceIds: string[]): Promise<import('@shared/HyperTaskHub').HyperHubSummaryResult>;
  loading: boolean;
  error: string | null;
  pending: HyperHubFeedbackEvent | null;
  load(): Promise<void>;
  refresh(): Promise<void>;
  sendFeedback(intent: HyperHubFeedbackIntent | HyperHubFeedbackEvent): Promise<HyperHubFeedbackResult>;
  openSource(handle: string): Promise<HyperHubOpenResult>;
  getSetupScope(): Promise<HyperHubSetupScope | null>;
  getSetupOptions(): Promise<HyperHubSetupOptions>;
  setFocusVisible(visible: boolean): Promise<void>;
  setSetupScope(scope: HyperHubSetupScope): Promise<void>;
  reset(): void;
}

export function createHyperTaskHubStore(client: HyperTaskHubApi = HyperTaskHubClient) {
  return create<HyperTaskHubState>((set, get) => {
    let canonical: HyperHubSnapshot | null = null;
    let unsubscribe: (() => void) | undefined;
    let briefRead = 0, weightRead = 0;
    let epoch = 0, reading = 0;
    const cleared = { brief: null, summary: null, summariesAvailable: false, loading: false, error: null, pending: null };
    function receive(next: HyperHubSnapshot) {
      if (canonical && (next.scopeGeneration < canonical.scopeGeneration ||
        (next.scopeGeneration === canonical.scopeGeneration && next.revision < canonical.revision))) return;
      const changed = !!canonical && canonical.scopeGeneration !== next.scopeGeneration;
      if (changed) { epoch++; reading++; }
      const obsolete = changed || canonical?.revision !== next.revision;
      canonical = next;
      const pending = get().pending;
      if (!changed && pending?.expectedRevision === next.revision && pending.scopeGeneration === next.scopeGeneration) {
        set({ snapshot: { ...next, tasks: hyperHubOptimisticTasks(next, pending) } });
      } else set({ snapshot: next, pending: null, ...(obsolete && { brief: null, summary: null, summariesAvailable: false }), ...(changed && cleared) });
    }
    function subscribe() { unsubscribe ??= client.onSnapshot(receive); }
    const version = () => ({ expectedRevision: canonical?.revision ?? 0, scopeGeneration: canonical?.scopeGeneration ?? 0 });
    const failure = (code: 'unavailable' | 'scope-changed' | 'revision-conflict') =>
      ({ ok: false as const, code, scopeGeneration: version().scopeGeneration, revision: version().expectedRevision });
    const detail = (e: unknown) => e instanceof Error ? e.message : 'Task Hub is unavailable.';
    type Failure = ReturnType<typeof failure>;
    type RequestVersion = { scopeGeneration: number; expectedRevision: number };
    async function runM5<T extends HyperHubVersion>(invoke: (() => Promise<T>) | undefined,
      base?: RequestVersion, mutation = false): Promise<T | Failure> {
      const lease = epoch;
      const start = version();
      if (!canonical || !invoke) return failure('unavailable');
      if (base && base.scopeGeneration !== start.scopeGeneration) return failure('scope-changed');
      if (base && base.expectedRevision !== start.expectedRevision) return failure('revision-conflict');
      try {
        const result = await invoke();
        if (lease !== epoch || result.scopeGeneration !== start.scopeGeneration) return failure('scope-changed');
        if (mutation && result.revision > canonical.revision) {
          const latest = await client.getSnapshot();
          if (lease !== epoch) return failure('scope-changed');
          receive(latest);
        }
        if (lease !== epoch) return failure('scope-changed');
        if (canonical.revision !== result.revision || (!mutation && canonical.revision !== start.expectedRevision)) {
          return failure('revision-conflict');
        }
        return result;
      } catch { return failure(lease === epoch ? 'unavailable' : 'scope-changed'); }
    }
    async function read(refresh: boolean) {
      let lease = epoch;
      const id = ++reading;
      set({ loading: true, error: null });
      try {
        subscribe();
        if (!canonical || !refresh) {
          const snapshot = await client.getSnapshot();
          if (lease !== epoch || id !== reading) return;
          receive(snapshot);
          lease = epoch;
        }
        const stale = canonical?.settings.setupComplete && canonical.sources.some(source =>
          source.status === 'stale' || source.status === 'unconfigured' || source.status === 'error' || source.status === 'partial');
        if ((refresh || stale) && canonical) {
          const result = await client.refresh({ ...version(), ...(!refresh && { automatic: true }) });
          if (lease === epoch && id === reading) receive(result);
        }
      } catch (e) { if (lease === epoch && id === reading) set({ error: detail(e) }); }
      finally { if (lease === epoch && id === reading) set({ loading: false }); }
    }
    return {
      ...cleared, snapshot: null,
      reset() {
        epoch++; reading++; unsubscribe?.(); unsubscribe = undefined; canonical = null;
        set({ ...cleared, snapshot: null });
      },
      load: () => read(false),
      refresh: () => read(true),
      previewStatus: request => runM5(client.previewStatus && (() => client.previewStatus!(request)), request),
      async approveStatus(request) {
        const result = await runM5(client.approveStatus && (() => client.approveStatus!(request)), undefined, true);
        if ('outcome' in result) return result;
        return { outcome: 'failed', code: result.code, revision: result.revision, scopeGeneration: result.scopeGeneration };
      },
      discardStatus: request => runM5(client.discardStatus && (() => client.discardStatus!(request))),
      releaseHold: request => runM5(client.releaseHold && (() => client.releaseHold!(request)), request, true),
      async previewWeights(request) {
        const read = ++weightRead;
        const result = await runM5(client.previewWeights && (() => client.previewWeights!(request)), request);
        if (result.ok && (read !== weightRead || request.seq !== result.seq)) return failure('revision-conflict');
        return result;
      },
      saveWeights: request => runM5(client.saveWeights && (() => client.saveWeights!(request)), request, true),
      previewMirror: request => runM5(client.previewMirror && (() => client.previewMirror!(request)), request),
      applyMirror: request => runM5(client.applyMirror && (() => client.applyMirror!(request)), undefined, true),
      async sendFeedback(intent) {
        if (!canonical) return failure('unavailable');
        if (get().pending) return failure('revision-conflict');
        const lease = epoch, event = 'scopeGeneration' in intent ? intent : { ...intent, ...version() };
        if (event.scopeGeneration !== canonical.scopeGeneration) return failure('scope-changed');
        if (event.expectedRevision !== canonical.revision) return failure('revision-conflict');
        set({ pending: event, error: null, snapshot: { ...canonical, tasks: hyperHubOptimisticTasks(canonical, event) } });
        try {
          const result = await client.sendFeedback(event);
          if (lease !== epoch || result.scopeGeneration !== event.scopeGeneration) return failure('scope-changed');
          if (!result.ok || canonical.revision < result.revision) {
            const latest = await client.getSnapshot();
            if (lease !== epoch) return failure('scope-changed');
            receive(latest);
          }
          if (lease !== epoch) return failure('scope-changed');
          if (!result.ok) set({ error: result.code });
          return result;
        } catch (e) {
          if (lease !== epoch) return failure('scope-changed');
          set({ error: detail(e) });
          return failure('unavailable');
        } finally {
          if (lease === epoch && get().pending === event) set({ pending: null, snapshot: canonical });
        }
      },
      async getBrief(meetingId) {
        if (!canonical || !client.getBrief) return failure('unavailable');
        const lease = epoch, seq = ++briefRead;
        set({ brief: null, summary: null, summariesAvailable: false });
        try {
          const result = await client.getBrief({ ...version(), meetingId });
          if (lease !== epoch || canonical.scopeGeneration !== result.scopeGeneration) return failure('scope-changed');
          if (result.ok && canonical.revision < result.revision) {
            const latest = await client.getSnapshot();
            if (lease !== epoch) return failure('scope-changed');
            receive(latest);
          }
          if (lease !== epoch) return failure('scope-changed');
          if (seq !== briefRead || canonical.revision !== result.revision) return failure('revision-conflict');
          if (result.ok) set({ brief: result.brief, summariesAvailable: result.summariesAvailable });
          return result;
        } catch { return failure(lease === epoch ? 'unavailable' : 'scope-changed'); }
      },
      async openBriefEvidence(meetingId, evidenceId) {
        const brief = get().brief;
        if (!canonical || !client.openBriefEvidence || !brief?.eligible || brief.meeting.id !== meetingId) return failure('unavailable');
        const lease = epoch;
        try {
          const result = await client.openBriefEvidence({ ...version(), meetingId, evidenceId });
          if (lease !== epoch || result.scopeGeneration !== canonical.scopeGeneration) return failure('scope-changed');
          if (result.ok && result.revision !== canonical.revision) return failure('revision-conflict');
          return result;
        } catch { return failure(lease === epoch ? 'unavailable' : 'scope-changed'); }
      },
      async summarizeBrief(meetingId, evidenceIds) {
        const brief = get().brief, lease = epoch;
        if (!canonical || !client.summarizeBrief || !brief?.eligible || brief.meeting.id !== meetingId) return failure('unavailable');
        set({ summary: null });
        try {
          const result = await client.summarizeBrief({ ...version(), meetingId, evidenceIds });
          if (lease !== epoch || result.scopeGeneration !== canonical.scopeGeneration) return failure('scope-changed');
          if (!result.ok) return result;
          if (get().brief !== brief || canonical.revision !== result.revision) return failure('revision-conflict');
          set({ summary: result });
          return result;
        } catch { return failure(lease === epoch ? 'unavailable' : 'scope-changed'); }
      },
      async openSource(handle) {
        const lease = epoch;
        try {
          const result = await client.openSource(handle);
          if (lease !== epoch) return failure('scope-changed');
          if (!result.ok) set({ error: result.code });
          return result;
        } catch (e) {
          if (lease !== epoch) return failure('scope-changed');
          set({ error: detail(e) }); return failure('unavailable');
        }
      },
      async getSetupScope() {
        const lease = epoch;
        const result = await client.getSetupScope();
        if (lease !== epoch || (canonical && canonical.scopeGeneration !== result.scopeGeneration)) throw new Error('scope-changed');
        return result.scope;
      },
      async getSetupOptions() {
        if (!client.getSetupOptions) throw new Error('Task Hub setup options are unavailable.');
        const lease = epoch;
        const result = await client.getSetupOptions();
        if (lease !== epoch) throw new Error('scope-changed');
        return result;
      },
      async setFocusVisible(visible) {
        const lease = epoch;
        try { await client.setFocusVisible?.(visible); }
        catch (e) { if (lease === epoch) set({ error: detail(e) }); }
      },
      async setSetupScope(scope) {
        const lease = epoch;
        if (!canonical) await get().load();
        if (!canonical || lease !== epoch) return;
        try {
          const next = await client.setSetupScope({ ...version(), scope });
          if (canonical.scopeGeneration > next.scopeGeneration) return;
          await get().refresh();
        } catch (e) { if (lease === epoch) set({ error: detail(e) }); }
      },
    };
  });
}

export const useHyperTaskHub = createHyperTaskHubStore();
