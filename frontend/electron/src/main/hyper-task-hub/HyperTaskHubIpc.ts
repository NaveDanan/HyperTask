import { fromBinary } from '@bufbuild/protobuf';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain, net, safeStorage, shell } from 'electron';
import type { z } from 'zod';
import { HyperTaskHubArgs as args, HyperTaskHubChannel as C, type HyperHubSnapshot } from '@shared/HyperTaskHub';
import { SubscribeObjectSchema } from '@shared/protobuf/hyper-notification/subject_pb';
import { UserNotification } from '@shared/protobuf/hyper-user/notification_pb';
import { DatabaseNotification } from '@shared/protobuf/hyper-database2/notification_pb';
import { JiraCredentialFiles } from '../jira-credentials';
import type { JiraCredentials } from '@shared/api';
import { hyperBotsReadIdentity } from '../HyperBotsHub';
import { hyperBotsJiraBinding, hyperBotsReadJira } from '../HyperBotsConnectors';
import { HyperBotsProjectCore, type HyperBotsProjectRequest } from '../HyperBotsProjectCore';
import { hyperTrustedWindowAdapter, type HyperWindowSource } from '../HyperTrustedWindows';
import { HyperHubMirror } from './HyperHubMirror';
import { HyperHubJiraStatusWriter } from './HyperHubJiraStatusWriter';
import { HyperHubNewsletterStatusWriter } from './HyperHubNewsletterStatusWriter';
import type { HyperHubDocument } from './HyperTaskHubWriteback';
import { HyperHubStatusError } from './HyperHubStatusWriter';
import { HyperHubJiraSource } from './HyperHubJiraSource';
import type { HyperOutlookBridge } from '../HyperOutlookBridge';
import { HyperNewsletterConnection } from '../HyperNewsletterConnection';
import { HyperHubOutlookSource, HyperHubMailSource, HyperHubPersonalFlagsVerified, hyperHubMailConsent } from './HyperHubOutlookSource';
import { HyperHubCalendarSource } from './HyperHubCalendarSource';
import { HyperHubArticleSource, HyperHubNewsletterReader, HyperHubNewsletterSource } from './HyperHubNewsletterSource';
import { HyperHubPageSource, HyperHubProjectSource } from './HyperHubProjectSource';
import { HyperHubRejection, HyperTaskHubService } from './HyperTaskHubService';
import { hyperHubHash, hyperHubInstant, HyperTaskHubStore } from './HyperTaskHubStore';
import { HyperHubAccessLost } from './HyperTaskHubSync';

/** Keep the existing credential file format and immediately recheck the Hub on disconnect. */
export class HyperHubJiraCredentials extends JiraCredentialFiles {
  changed?: () => Promise<void>;
  override async write(id: string, value: JiraCredentials) {
    await super.write(id, value);
    await this.changed?.();
  }
  override async delete(id: string) {
    await super.delete(id);
    await this.changed?.();
  }
}

export class HyperHubNewsletterConnection extends HyperNewsletterConnection {
  changed?: (account: string, binding: string) => Promise<void>;
  override async save(account: string, input: Parameters<HyperNewsletterConnection['save']>[1]) {
    const result = await super.save(account, input);
    const binding = result ? (await this.access(account)).fingerprint : '';
    await this.changed?.(account, binding);
    return result;
  }
}

export function registerHyperTaskHubIpc(options: { window: HyperWindowSource; directory: string; request: HyperBotsProjectRequest;
  calendar?: import('../HyperOutlookCalendarCache').HyperOutlookCalendarCache;
  outlook?: Pick<HyperOutlookBridge, 'request'>; newsletter?: HyperNewsletterConnection;
  summaryConfigured?(): Promise<boolean>;
  summary?: import('./HyperHubSummaryTransport').HyperHubSummaryTransport;
  active?(): boolean; outlookAvailable?(): boolean;
  prefs: Parameters<typeof hyperBotsReadJira>[0]; credentials: Parameters<typeof hyperBotsReadJira>[1] & { isPersistent?: boolean } }) {
  const registry = hyperTrustedWindowAdapter(options.window);
  const broadcast = (snapshot: HyperHubSnapshot) => registry.broadcast(C.Snapshot, snapshot);
  let generation = 0, transitions = 0, used = false;
  let service: HyperTaskHubService | null = null;
  let partition = '';
  let jiraPrefsPrefix = '';
  let jiraConnected = false;
  let focusVisible = false;
  let acquiring: Promise<HyperTaskHubService | null> | undefined;
  let reconcileCredentials = false;
  function empty(): HyperHubSnapshot {
    return { revision: 0, scopeGeneration: generation, asOf: hyperHubInstant(Date.now()), tasks: [], ranking: [], sources: [],
      settings: { setupComplete: false, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, workdays: [], weights: { slack: 45, importance: 25, unblocking: 20, age: 10 } } };
  }
  function invalidate(keepAcquisition = false) {
    options.calendar?.reset();
    service?.close();
    service = null;
    partition = '';
    jiraPrefsPrefix = '';
    jiraConnected = false;
    if (!keepAcquisition) acquiring = undefined;
    generation++;
    if (used) broadcast(empty());
  }

  async function resolve() {
    if (transitions) return null;
    const start = generation;
    const unchanged = () => {
      if (start !== generation || transitions) throw new HyperHubRejection('scope-changed');
    };
    const user = await hyperBotsReadIdentity(options.request);
    unchanged();
    if (!user) { if (service) invalidate(); return null; }
    const core = new HyperBotsProjectCore(options.request, user.key, new AbortController().signal);
    const workspaceId = await core.pin();
    const configKey = 'hypertask.jira.' + user.userId + '.config';
    const raw = await options.prefs.get(configKey);
    let config = raw;
    if (typeof raw === 'string') {
      try { config = JSON.parse(raw); } catch { config = null; }
    }
    const settings = config && typeof config === 'object' ? config as Record<string, unknown> : {};
    const access = await hyperBotsReadJira(options.prefs, options.credentials, user.userId).catch(() => null);
    unchanged();
    const configId = hyperHubHash(user.userId, settings.baseUrl, settings.projectKey, settings.authType, settings.username);
    const binding = access ? configId + '.' + hyperHubHash(hyperBotsJiraBinding(access).fingerprint, access.authorization) : '';
    const filter = typeof settings.customJql === 'string' ? settings.customJql : '';
    const newsletter = await options.newsletter?.status(user.key);
    const newsletterAccess = newsletter ? await options.newsletter?.access(user.key) : undefined;
    unchanged();
    const newsletterBinding = newsletterAccess?.fingerprint ?? '';
    const signature = hyperHubHash(user.key, workspaceId, configId, binding, filter, newsletterBinding, newsletter?.baseUrl);
    if (reconcileCredentials) {
      HyperTaskHubStore.reconcileJira(options.directory, user.key, safeStorage, binding);
      reconcileCredentials = false;
    }
    if (partition === signature && service) return service;
    invalidate(true);
    const checkingGeneration = generation;
    let store = new HyperTaskHubStore(options.directory, user.key, workspaceId, safeStorage);
    if (store.current.setup && (store.current.setup.outlookCalendar || hyperHubMailConsent(store.current.setup)) && options.outlookAvailable?.() && options.outlook) {
      const activeStore = await options.outlook.request('hub.store', undefined);
      if (checkingGeneration !== generation || transitions) throw new HyperHubRejection('scope-changed');
      if (activeStore !== store.current.outlookStore) {
        HyperTaskHubStore.reconcileMail(options.directory, user.key, safeStorage, activeStore);
        store = new HyperTaskHubStore(options.directory, user.key, workspaceId, safeStorage);
      }
    }
    // Off Windows Jira tokens live only in memory. A restart is not an explicit disconnect.
    // Explicit credential removal reconciles every partition above, before this check.
    const offlineSession = !access && options.credentials.isPersistent === false && store.current.jiraBinding?.startsWith(configId + '.');
    if (!offlineSession) store.bindJira(binding);
    const instance = access?.baseUrl ?? (typeof settings.baseUrl === 'string' ? settings.baseUrl.replace(/\/+$/, '') : undefined);
    store.bindNewsletter(newsletterBinding);
    const reader = newsletterAccess && options.newsletter && new HyperHubNewsletterReader(options.newsletter, user.key, newsletterBinding,
      (input, init) => net.fetch(String(input), init),
      projectId => new Set(store.current.setup?.newsletterProjects?.filter(p => p.projectId === projectId).map(p => p.resourceId)));
    const bound = generation;
    service = new HyperTaskHubService(store, { generation, workspaceId, accountId: user.key, changed: broadcast,
      mirror: new HyperHubMirror(options.request, user.key, workspaceId),
      checkMirrorRow: async (row, originKey, signal) => {
        const source = new HyperHubProjectSource(options.request, row.databaseId, row.viewId, store.current.setup!.zone);
        const scope = { generation: bound, accountId: user.key, workspaceId, connectionId: 'hypertask' };
        const current = await source.read(scope, signal);
        if (!current.records.some(r => r.key.kind === 'hypertask' && r.key.rowId === row.rowId && r.originKey === originKey)) throw new HyperHubRejection('access-denied');
      },
      writers: {
        jira: access ? new HyperHubJiraStatusWriter(access, binding, (url, init) => net.fetch(String(url), init), filter) : undefined,
        newsletter: newsletterAccess && newsletter?.gantt ? new HyperHubNewsletterStatusWriter(newsletterAccess, newsletterBinding,
          (url, init) => net.fetch(String(url), init), (project, resource) => !!store.current.setup?.newsletterProjects?.some(p =>
            p.connectionId === 'newsletter' && p.projectId === project && p.resourceId === resource)) : undefined,
      },
      outlookOffline: () => options.outlookAvailable?.() === false,
      summary: options.summary, summaryConfigured: options.summaryConfigured,
      openExternal: url => shell.openExternal(url),
      setupOptions: async signal => ({
        jira: { configured: !!access, defaultProjectKey: typeof settings.projectKey === 'string' ? settings.projectKey : undefined },
        mailbox: { available: !!options.outlook && (options.outlookAvailable?.() ?? false), flagsVerified: HyperHubPersonalFlagsVerified },
        outlook: { available: options.outlookAvailable?.() ?? false },
        newsletter: { configured: !!newsletter, gantt: !!newsletter?.gantt, projects: newsletter?.gantt && reader ? await reader.options(signal) : [] },
      }),
      validate: async () => !!await current() && bound === generation,
      queries: scope => [
        ...scope.jiraProjects.map(p => new HyperHubJiraSource(p.connectionId, p.projectId, filter, scope.zone, async () => {
          if (offlineSession) throw new Error('Jira credentials are unavailable for this session.');
          if (!access || p.connectionId !== 'jira') throw new HyperHubAccessLost();
          return access;
        }, (input, init) => net.fetch(String(input), init))),
        ...(hyperHubMailConsent(scope) ? [new HyperHubMailSource(options.outlook, store.current.outlookStore, scope)] : []),
        ...(scope.outlookCalendar ? [new HyperHubOutlookSource(options.outlook, store.current.outlookStore, scope.zone, Date.now, options.calendar)] : []),
        ...(scope.nativeCalendars ?? []).map(v => new HyperHubCalendarSource(options.request, v.databaseId, v.viewId, scope.zone)),
        ...[...new Set(scope.newsletterProjects?.map(p => p.projectId))].map(projectId => new HyperHubNewsletterSource(reader, projectId,
          new Set(scope.newsletterProjects!.filter(p => p.projectId === projectId && p.connectionId === 'newsletter').map(p => p.resourceId)),
          scope.zone, newsletter?.baseUrl ?? '')),
        ...(scope.newsletterArticles ?? []).map(a => new HyperHubArticleSource(reader, newsletter?.baseUrl ?? '', a.articleId, a.meetingId)),
        ...(scope.nativePages ?? []).map(p => new HyperHubPageSource(options.request, p.viewId, p.meetingId)),
        ...scope.nativeViews.map(v => new HyperHubProjectSource(options.request, v.databaseId, v.viewId, scope.zone, instance)),
      ],
    });
    partition = signature;
    jiraPrefsPrefix = 'hypertask.jira.' + user.userId + '.';
    jiraConnected = !!access;
    broadcast(service.snapshot());
    return service;
  }
  function current() {
    if (acquiring) return acquiring;
    const bound = generation;
    const pending = resolve().catch(error => {
      if (bound === generation && service) invalidate();
      throw error;
    }).finally(() => { if (acquiring === pending) acquiring = undefined; });
    acquiring = pending;
    return pending;
  }

  // A same-site navigation can reuse the native frame. Retire the document before navigation commits.
  const documents = new WeakMap<Electron.WebContents, { epoch: number }>();
  function documentEpoch(sender: Electron.WebContents) {
    let state = documents.get(sender);
    if (!state) {
      state = { epoch: 0 };
      documents.set(sender, state);
      const current = state;
      sender.on?.('did-start-navigation', (_event, _url, inPlace, main) => { if (main && !inPlace) current.epoch++; });
    }
    return state.epoch;
  }
  function handle<T>(channel: string, schema: z.ZodType<T>, run: (s: HyperTaskHubService, value: T, trusted: () => boolean, doc: HyperHubDocument) => unknown) {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      const rejected = (code: string) => ({ ...(channel === C.ApproveStatus ? { outcome: 'failed' } : { ok: false }), code, ...(service?.version ?? { scopeGeneration: generation, revision: 0 }) });
      if (!registry.isTrustedSender(event)) return rejected('access-denied');
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return rejected('invalid');
      const frame = event.senderFrame!;
      const epoch = documentEpoch(event.sender);
      const trusted = () => epoch === documentEpoch(event.sender) && !frame.detached && frame === event.sender.mainFrame && registry.isTrustedSender(event);
      const doc: HyperHubDocument = { window: event.sender, frame, trusted, async confirm(params) {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || !trusted()) return false;
        return (await dialog.showMessageBox(window, params)).response === 1;
      } };
      used = true;
      try {
        const s = await current();
        if (!s) return channel === C.GetSnapshot ? empty() : rejected('scope-changed');
        const reply = await run(s, parsed.data, trusted, doc);
        if (!trusted() || (channel !== C.SetSetupScope && s !== service)) return rejected('scope-changed');
        return reply;
      } catch (error) {
        return { ...rejected(error instanceof HyperHubRejection || error instanceof HyperHubStatusError ? error.code : 'unavailable'),
          ...(error instanceof Error && error.message.includes('OS encryption') && { message: error.message }) };
      }
    });
  }
  handle(C.PreviewStatus, args.previewStatus, (s, v, _, doc) => s.previewStatus(v, doc));
  handle(C.ApproveStatus, args.approveStatus, (s, v, _, doc) => s.writeback.approve(doc, v.previewId, v.candidateId, v.resolutionId));
  handle(C.DiscardStatus, args.discardStatus, (s, v, _, doc) => s.writeback.discard(doc, v.previewId));
  handle(C.ReleaseHold, args.releaseHold, (s, v, _, doc) => s.releaseHold(v, doc));
  handle(C.PreviewWeights, args.previewWeights, (s, v) => s.previewWeights(v));
  handle(C.SaveWeights, args.saveWeights, (s, v) => s.saveWeights(v));
  handle(C.PreviewMirror, args.previewMirror, (s, v, _, doc) => s.previewMirror(v, doc));
  handle(C.ApplyMirror, args.applyMirror, (s, v, _, doc) => s.applyMirror(v.token, doc));
  handle(C.GetSnapshot, args.getSnapshot, s => s.setup.scope?.outlookCalendar
    ? s.refresh({ scopeGeneration: s.version.scopeGeneration, expectedRevision: s.version.revision }, 'outlook-calendar', false) : s.snapshot());
  handle(C.GetSetupOptions, args.getSetupOptions, async s => {
    const result = await s.getSetupOptions();
    if (await current() !== s) throw new HyperHubRejection('scope-changed');
    return result;
  });
  handle(C.SetFocusVisible, args.setFocusVisible, (_s, visible) => {
    focusVisible = visible;
    if (visible) wakeOutlook();
  });
  handle(C.GetSetupScope, args.getSetupScope, s => s.setup);
  handle(C.SendFeedback, args.sendFeedback, (s, v) => s.sendFeedback(v));
  handle(C.OpenSource, args.openSource, (s, v) => s.openSource(v));
  handle(C.GetBrief, args.getBrief, (s, v) => s.getBrief(v));
  handle(C.OpenBriefEvidence, args.openBriefEvidence, (s, v) => s.openBriefEvidence(v));
  handle(C.SummarizeBrief, args.summarizeBrief, (s, v, trusted) => s.summarizeBrief(v, trusted));
  handle(C.Refresh, args.refresh, (s, v) => s.refresh(v, undefined, !v.automatic));
  handle(C.SetSetupScope, args.setSetupScope, async (s, v) => {
    if (v.scope.jiraProjects.some(p => p.connectionId !== 'jira')) throw new HyperHubRejection('invalid');
    if (!jiraConnected && v.scope.jiraProjects.length) throw new HyperHubRejection('unavailable');
    if (v.scope.newsletterProjects.some(p => p.connectionId !== 'newsletter' || !/^[\w-]{1,128}$/.test(p.projectId))) throw new HyperHubRejection('invalid');
    const needsStore = v.scope.outlookCalendar || hyperHubMailConsent(v.scope);
    const keepCalendar = !hyperHubMailConsent(v.scope) && v.scope.outlookCalendar && s.setup.scope?.outlookCalendar && s.outlookStore;
    const storeId = keepCalendar || (needsStore ? await options.outlook?.request('hub.store', undefined) : undefined);
    if (needsStore && !storeId) throw new HyperHubRejection('unavailable');
    if (await current() !== s) throw new HyperHubRejection('scope-changed');
    s.setSetupScope(v, v.scope, storeId);
    const expected = partition;
    invalidate();
    const next = await current();
    if (!next || expected !== partition || next !== service || next.setup.scope === null) throw new HyperHubRejection('scope-changed');
    return next.setup;
  });

  async function refresh(kind?: 'hypertask' | 'jira' | 'outlook-calendar' | 'newsletter-task' | 'outlook-mail' | 'newsletter-article', cadence?: number) {
    if (!used || transitions) return;
    const s = await current();
    if (s) await s.refresh({ scopeGeneration: s.version.scopeGeneration, expectedRevision: s.version.revision }, kind, false, cadence);
  }
  function wakeOutlook(cadence = 60_000) {
    if (service?.setup.scope?.outlookCalendar) void refresh('outlook-calendar', cadence).catch(() => {});
  }
  const availabilityTimer = setInterval(() => {
    void service?.writeback.reconcile().catch(() => {});
    if (options.active?.() !== false) wakeOutlook(focusVisible ? 60_000 : 5 * 60_000);
    if (service?.setup.scope && hyperHubMailConsent(service.setup.scope)) void refresh('outlook-mail').catch(() => {});
    if (service?.setup.scope?.newsletterArticles?.length) void refresh('newsletter-article').catch(() => {});
    if (service?.setup.scope?.newsletterProjects?.length) void refresh('newsletter-task').catch(() => {});
  }, 60_000);
  availabilityTimer.unref();
  let lastJiraTrigger = 0;
  const tick = () => {
    if (!service?.setup.scope?.jiraProjects.length || Date.now() - lastJiraTrigger < 5 * 60_000) return;
    lastJiraTrigger = Date.now();
    void refresh('jira').catch(() => {});
  };
  const timer = setInterval(tick, 5 * 60_000);
  timer.unref();
  let nativeRefresh: NodeJS.Timeout | undefined;
  return {
    meetingIds(store: string) {
      return service?.meetingIds(store) ?? new Map<string, string>();
    },
    wakeOutlook,
    outlookRecovered() {
      if (service?.setup.scope && (service.setup.scope.outlookCalendar || hyperHubMailConsent(service.setup.scope))) {
        invalidate();
        void current().then(() => wakeOutlook()).catch(() => {});
      } else wakeOutlook();
    },
    notify(bytes: Uint8Array) {
      if (!used) return;
      let subject;
      try { subject = fromBinary(SubscribeObjectSchema, bytes); } catch { return; }
      if (subject.source === 'User' && [UserNotification.UserAuthStateChanged, UserNotification.DidOpenWorkspace].includes(subject.ty)) {
        invalidate();
        if (!transitions) void current().catch(() => {});
      } else if ((subject.source === 'Database' && ![DatabaseNotification.DidFetchRow, DatabaseNotification.DidUpdateDatabaseSyncUpdate,
        DatabaseNotification.DidUpdateDatabaseSnapshotState].includes(subject.ty) || subject.source === 'Workspace') && !nativeRefresh && (service?.setup.scope?.nativeViews.length || service?.setup.scope?.nativeCalendars?.length || service?.setup.scope?.nativePages?.length)) {
        nativeRefresh = setTimeout(() => { nativeRefresh = undefined; void refresh('hypertask').catch(() => {}); }, 250);
      }
    },
    invalidate: () => invalidate(),
    async newsletterChanged(account: string, binding: string) {
      if (!existsSync(path.join(options.directory, 'hyper_task_hub'))) return;
      invalidate();
      HyperTaskHubStore.reconcileNewsletter(options.directory, account, safeStorage, binding);
      if (used) await current().catch(() => {});
    },
    async connectionChanged() {
      if (!used && !existsSync(path.join(options.directory, 'hyper_task_hub'))) return;
      invalidate();
      reconcileCredentials = true;
      // The credential operation already succeeded. Keep the Hub closed if its own storage is unavailable.
      await current().catch(() => {});
    },
    preferenceChanged(key: string) {
      if (!jiraPrefsPrefix) return;
      // The existing Jira scheduler writes its cache after a sync. Share that wake-up without reading its text.
      if (key === jiraPrefsPrefix + 'cache') tick();
      if (key === jiraPrefsPrefix + 'config') void current().catch(() => {});
    },
    begin(event: string) {
      if (!['CoreInit', 'SignOut', 'DeleteAccount', 'SignUp', 'OauthSignIn', 'SignInWithEmailPassword', 'PasscodeSignIn', 'MagicLinkSignIn',
        'InitUser', 'OpenAnonUser', 'OpenWorkspace', 'CreateWorkspace', 'DeleteWorkspace'].includes(event)) return () => {};
      transitions++;
      invalidate();
      return () => { transitions--; if (used && !transitions) void current().catch(() => {}); };
    },
  };
}
