import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HyperHubAgendaItem, HyperHubInterval, HyperHubConnectionStatus, HyperHubInstant, HyperHubObservation, HyperHubPerson, HyperHubSetupScope, HyperHubState } from '@shared/HyperTaskHub';

export const hyperHubHash = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const hyperHubEmailIdentity = (email: string) => /^[^@\s]+@[^@\s]+$/.test(email) ? hyperHubHash('smtp', email.toLowerCase()) : undefined;
export const hyperHubInstant = (ms: number): HyperHubInstant => ({ kind: 'instant', iso: new Date(ms).toISOString() });

/** Identical confidential reservations need no distinct occurrence identity. */
export function hyperHubBusyInterval(interval: HyperHubInterval, sourceKind: HyperHubAgendaItem['sourceKind']): HyperHubAgendaItem {
  return { id: hyperHubHash('busy', sourceKind, interval), interval, sourceKind, allDay: false, private: true, isMeeting: false, availability: 'busy' };
}

export interface HyperHubRecord extends HyperHubObservation {
  label: string;
  projectId: string;
  initialState: HyperHubState;
  /** Canonical, validated Jira browse URL. A mirror alone never establishes an open issue. */
  jiraAlias?: string;
  originKey?: string;
  schedule?: HyperHubInterval;
  mirrorFingerprint?: string;
  predecessorEvidenceIds?: string[];
  people?: HyperHubPerson[];
  createdAt?: HyperHubInstant;
  reviewSpan?: import('@shared/HyperTaskHub').HyperHubReviewSpan;
  attachmentNames?: string[];
  occurrence?: import('@shared/HyperMeetingBrief').HyperMeetingOccurrence;
  briefExcerpt?: string;
  verifiedThreadId?: string;
  verifiedIdentityIds?: string[];
  document?: import('@shared/HyperMeetingBrief').HyperMeetingDocument;
  linkedMeetingId?: string;
  documentUrl?: string;
  ownerAssigned?: boolean;
  decisionDue?: boolean;
  mailFolder?: 'inbox' | 'sent';
  expiresAt?: number;
}
export interface HyperHubInventory {
  evidence?: HyperHubRecord[];
  agenda?: HyperHubAgendaItem[];
  lastComplete?: { interval: HyperHubInterval; asOf: HyperHubInstant };
  records: HyperHubRecord[];
  cursor: string | null;
  status: HyperHubConnectionStatus;
}
export interface HyperHubDecision {
  firstSeenAt: HyperHubInstant;
  stateChangedAt: HyperHubInstant;
  state?: HyperHubState;
  matrixQuadrant?: import('@shared/HyperTaskHub').HyperHubMatrixQuadrant;
  titleOverride?: string;
  reviewLabel?: { cohort: import('@shared/HyperTaskHub').HyperHubLanguageCohort; accepted: boolean };
  prepMeetingId?: string;
  prepBlock?: boolean;
  pinned?: boolean;
  manualOrder?: number;
  snoozeUntil?: HyperHubInstant;
  fixedBlocks?: import('@shared/HyperTaskHub').HyperHubInterval[];
}
export interface HyperHubRelations {
  merges: Record<string, import('@shared/HyperHubLinks').HyperHubMerge>;
  references: Record<string, boolean>;
  negatives: Record<string, boolean>;
}
export const hyperHubRelations = (): HyperHubRelations => ({ merges: {}, references: {}, negatives: {} });
export type HyperHubRelationChange =
  | { table: 'merges'; key: string; previous?: import('@shared/HyperHubLinks').HyperHubMerge }
  | { table: 'references' | 'negatives'; key: string; previous?: boolean };
export interface HyperHubDiskState {
  format: 1;
  revision: number;
  setup: HyperHubSetupScope | null;
  jiraBinding?: string;
  outlookStore?: string;
  newsletterBinding?: string;
  ledger: {
    writes?: Record<string, import('./HyperHubStatusWriter').HyperHubWriteEntry>;
    mirrorRows?: Record<string, Extract<import('@shared/HyperTaskHub').HyperHubOpenTarget, { kind: 'hypertask'; rowId: string }>>;
    weights?: import('@shared/HyperTaskHub').HyperHubWeights;
    meetings?: Record<string, { viewed?: boolean; confirmed?: boolean }>;
    prepHistory?: { id: string; meetingId: string; createdTaskId?: string; previousConfirmed?: boolean }[];
    availability?: Record<string, HyperHubInterval[]>;
    dayHistory?: { id: string; key: string; before: HyperHubInterval[] }[];
    actionIds: Record<string, string>;
    mirrorActionIds: Record<string, string>;
    verifiedMirrors: Record<string, string>;
    decisions: Record<string, HyperHubDecision>;
    relations?: HyperHubRelations;
    history: { id: string; targetId: string; before: Record<string, HyperHubDecision>; changes?: HyperHubRelationChange[] }[];
  };
  cache: Record<string, HyperHubInventory>;
}
export const hyperHubEmptyState = (): HyperHubDiskState => ({
  format: 1, revision: 0, setup: null, ledger: { actionIds: {}, mirrorActionIds: {}, verifiedMirrors: {}, decisions: {}, history: [] }, cache: {},
});
export interface HyperHubEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function hyperHubForgetWriteLabels(d: HyperHubDiskState, source: 'jira' | 'newsletter', evidenceId?: string) {
  for (const e of Object.values(d.ledger.writes ?? {})) {
    if (e.view.source !== source || evidenceId && e.target.id !== evidenceId) continue;
    e.before.name = '';
    if (e.after) e.after.name = '';
    Object.assign(e.view, { fromName: '', toName: '', undoAvailable: false, ownerReleaseAvailable: false });
    delete e.view.observedName;
  }
}

/** Single encrypted commit includes query membership, cursor and newly minted ledger identities. */
class HyperHubEncryptedPartition {
  private static readonly live = new Map<string, WeakRef<{ value: HyperHubDiskState }>>();
  private readonly shared: { value: HyperHubDiskState };
  private get state() { return this.shared.value; }
  private set state(value: HyperHubDiskState) { this.shared.value = value; }

  constructor(private readonly file: string, private readonly encryption: HyperHubEncryption,
    private readonly platform: NodeJS.Platform = process.platform) {
    this.shared = HyperHubEncryptedPartition.live.get(file)?.deref() ?? { value: hyperHubEmptyState() };
    HyperHubEncryptedPartition.live.set(file, new WeakRef(this.shared));
    try {
      for (const name of readdirSync(path.dirname(file))) {
        if (/^state\.enc\.[a-f0-9-]{36}\.tmp$/.test(name)) rmSync(path.join(path.dirname(file), name), { force: true });
      }
      const encrypted = readFileSync(this.file);
      this.assertSecure();
      this.state = JSON.parse(encryption.decryptString(encrypted));
      if (this.state.format !== 1) throw new Error('Unsupported Task Hub storage version.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = hyperHubEmptyState();
    }
  }

  get current(): Readonly<HyperHubDiskState> { return this.state; }

  private assertSecure() {
    if (!this.encryption.isEncryptionAvailable() || (this.platform === 'linux' && this.encryption.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Task Hub requires OS encryption to save personal decisions and source text.');
    }
  }

  /** The scope check and atomic rename run in one main-loop turn. Failed writes leave memory unchanged. */
  commit(current: () => boolean, change: (draft: HyperHubDiskState) => void) {
    if (!current()) return false;
    this.assertSecure();
    const draft = structuredClone(this.state);
    change(draft);
    draft.revision++;
    const encrypted = this.encryption.encryptString(JSON.stringify(draft));
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temp, encrypted, { mode: 0o600, flag: 'wx', flush: true });
      if (!current()) return false;
      renameSync(temp, this.file);
      this.state = draft;
      return true;
    } finally { rmSync(temp, { force: true }); }
  }

  /** A remote request can outlive a workspace switch. Check its original encrypted claim before claiming the same remote target. */
  heldInAnotherWorkspace(binding: string, evidenceId: string) {
    const workspace = path.dirname(this.file), account = path.dirname(workspace);
    if (!existsSync(account)) return false;
    for (const dir of readdirSync(account, { withFileTypes: true })) {
      if (!dir.isDirectory() || !/^[a-f0-9]{64}$/.test(dir.name) || dir.name === path.basename(workspace)) continue;
      const file = path.join(account, dir.name, 'state.enc');
      if (!existsSync(file)) continue;
      const state: HyperHubDiskState = JSON.parse(this.encryption.decryptString(readFileSync(file)));
      if (Object.values(state.ledger.writes ?? {}).some(e => e.binding === binding && e.target.id === evidenceId &&
        (e.view.held || e.view.state === 'unknown'))) return true;
    }
    return false;
  }

  clearCache(current: () => boolean) { return this.commit(current, draft => { draft.cache = {}; }); }

  reconcileMailStore(activeStore: string) {
    if (!this.state.outlookStore || activeStore === this.state.outlookStore) return;
    this.commit(() => true, draft => {
      if (draft.setup) { draft.setup.mail = null; draft.setup.outlookCalendar = false; }
      delete draft.outlookStore;
      for (const [key, inventory] of Object.entries(draft.cache)) {
        if (inventory.status.kind.startsWith('outlook-')) delete draft.cache[key];
      }
    });
  }

  bindNewsletter(binding: string) {
    if ((this.state.newsletterBinding ?? '') === binding) return;
    this.commit(() => true, draft => {
      hyperHubForgetWriteLabels(draft, 'newsletter');
      if (draft.setup?.writeBack) draft.setup.writeBack.newsletter = false;
      if (draft.newsletterBinding !== undefined && draft.setup) { draft.setup.newsletterProjects = []; draft.setup.newsletterArticles = []; }
      for (const [id, value] of Object.entries(draft.cache)) if (value.status.kind.startsWith('newsletter-')) delete draft.cache[id];
      draft.newsletterBinding = binding;
    });
  }

  bindJira(binding: string) {
    if (this.state.jiraBinding === binding || (!binding && this.state.jiraBinding === undefined)) return;
    this.commit(() => true, d => {
      hyperHubForgetWriteLabels(d, 'jira');
      if (d.setup?.writeBack) d.setup.writeBack.jira = false;
      if (d.jiraBinding !== undefined && d.setup) {
        d.setup.jiraProjects = [];
        for (const [id, i] of Object.entries(d.cache)) if (i.status.kind === 'jira') delete d.cache[id];
      }
      d.jiraBinding = binding;
    });
  }
}

const accountDirectory = (directory: string, accountId: string) => path.join(directory, 'hyper_task_hub', 'users', hyperHubHash(accountId));
export class HyperTaskHubStore extends HyperHubEncryptedPartition {
  /** A pending read cannot restore records after an access check revoked them. */
  accessGeneration = 0;
  constructor(directory: string, accountId: string, workspaceId: string, encryption: HyperHubEncryption, platform = process.platform) {
    super(path.join(accountDirectory(directory, accountId), hyperHubHash(workspaceId), 'state.enc'), encryption, platform);
  }

  /** A credential belongs to the account. Its removal also revokes cached issues in unopened workspaces. */
  static reconcileJira(directory: string, accountId: string, encryption: HyperHubEncryption, binding: string) {
    this.forAccount(directory, accountId, encryption, store => store.bindJira(binding));
  }
  static reconcileMail(directory: string, accountId: string, encryption: HyperHubEncryption, activeStore: string) {
    this.forAccount(directory, accountId, encryption, partition => partition.reconcileMailStore(activeStore));
  }
  static reconcileNewsletter(directory: string, accountId: string, encryption: HyperHubEncryption, binding: string) {
    this.forAccount(directory, accountId, encryption, store => store.bindNewsletter(binding));
  }
  private static forAccount(directory: string, accountId: string, encryption: HyperHubEncryption,
    apply: (partition: HyperHubEncryptedPartition) => void) {
    const folder = accountDirectory(directory, accountId);
    if (!existsSync(folder)) return;
    for (const partition of readdirSync(folder, { withFileTypes: true })) {
      if (!partition.isDirectory() || !/^[0-9a-f]{64}$/.test(partition.name)) continue;
      apply(new HyperHubEncryptedPartition(path.join(folder, partition.name, 'state.enc'), encryption));
    }
  }
}

/** Rebuild the view-to-action index from live origins before considering any mirror. */
export const hyperHubOriginKey = (r: HyperHubRecord) => hyperHubHash('hub-origin', r.scope.accountId, r.scope.workspaceId, r.scope.connectionId, r.id);
export function hyperHubIndex(draft: HyperHubDiskState) {
  const { decisions, actionIds } = draft.ledger;
  const aliases = new Map<string, string>();
  const records = Object.values(draft.cache).flatMap(batch => batch.records);
  for (const record of records) {
    if (record.mirrorFingerprint) {
      if (record.role === 'mirror') draft.ledger.verifiedMirrors[record.id] = record.mirrorFingerprint;
      // A disconnected instance can no longer supply its URL. Remember verified pairs by hash.
      else if (draft.ledger.verifiedMirrors[record.id] === record.mirrorFingerprint) record.role = 'mirror';
    }
    if (record.role === 'mirror') continue;
    const actionId = actionIds[record.id] ??= randomUUID();
    decisions[actionId] ??= { firstSeenAt: record.observedAt, stateChangedAt: record.observedAt };
    aliases.set(hyperHubOriginKey(record), actionId);
    if (record.key.kind === 'jira' && record.jiraAlias) aliases.set(record.jiraAlias, actionId);
  }
  for (const record of records) {
    if (record.role !== 'mirror') continue;
    const actionId = record.originKey ? aliases.get(record.originKey) : record.jiraAlias && aliases.get(record.jiraAlias);
    delete draft.ledger.mirrorActionIds[record.id];
    if (actionId) draft.ledger.mirrorActionIds[record.id] = actionId;
    // An obsolete mirror must never recreate the authoritative task.
  }
}
