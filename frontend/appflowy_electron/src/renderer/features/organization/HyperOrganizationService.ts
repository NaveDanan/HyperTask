import { ViewLayoutPB, ViewSectionPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { unwrap } from '@/backend/dispatch';
import {
  FolderEventCreateView, FolderEventGetAllViews, FolderEventGetView,
  FolderEventReadCurrentWorkspace, FolderEventUpdateView, FolderEventListTrashItems,
} from '@/backend/events/flowy-folder';
import { UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { uuidV5 } from '../templates/converter';
import { hyperIsJournalDate, hyperMergeOrganizationMetadata, hyperOrganizationMetadata, hyperOrganizationPages } from './HyperOrganizationModel';
import { hyperMergeCollection, hyperMergePageProperty, hyperValidateCollection, type HyperCollectionConfig, type HyperPageProperty } from './HyperCollectionModel';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';

export interface HyperOrganizationBackend {
  owner(): HyperDocumentOwner | null;
  workspaceId(): Promise<string>;
  userId(): Promise<string>;
  views(): Promise<ViewPB[]>;
  view(id: string): Promise<ViewPB>;
  exists(id: string): Promise<boolean>;
  trashIds(): Promise<string[]>;
  createJournal(workspaceId: string, id: string, date: string, section: ViewSectionPB, extra: string): Promise<ViewPB>;
  updateExtra(viewId: string, extra: string): Promise<void>;
}
const backend: HyperOrganizationBackend = {
  owner: hyperGetDocumentOwner,
  workspaceId: async () => unwrap(await FolderEventReadCurrentWorkspace()).id,
  userId: async () => String(unwrap(await UserEventGetUserProfile()).id),
  views: async () => unwrap(await FolderEventGetAllViews()).items,
  view: async value => unwrap(await FolderEventGetView({ value })),
  exists: async value => {
    const result = await FolderEventGetView({ value });
    if (result.ok) return true;
    if (result.error.code === ErrorCode.RecordNotFound) return false;
    throw result.error;
  },
  trashIds: async () => unwrap(await FolderEventListTrashItems()).items.map(item => item.id),
  createJournal: async (parentViewId, viewId, name, section, extra) => unwrap(await FolderEventCreateView({
    parentViewId, name, layout: ViewLayoutPB.Document, setAsCurrent: false,
    oneOfSection: { case: 'section', value: section }, oneOfViewId: { case: 'viewId', value: viewId }, oneOfExtra: { case: 'extra', value: extra },
  })),
  updateExtra: async (viewId, extra) => {
    // The Rust handler acknowledges UpdateView with an empty payload even though the
    // upstream event map declares ViewPB. Read the updated view instead of decoding the
    // acknowledgement as an empty page. The service performs its separately guarded read.
    unwrap(await FolderEventUpdateView({ viewId, oneOfExtra: { case: 'extra', value: extra } }));
  },
};

export class HyperOrganizationService {
  private readonly journalRequests = new Map<string, { owner: HyperDocumentOwner; request: Promise<ViewPB> }>();
  private readonly tagWrites = new Map<string, { owner: HyperDocumentOwner; settled: Promise<void> }>();
  constructor(private readonly service: HyperOrganizationBackend = backend) {}

  private capture(workspaceId: string, expected?: HyperDocumentOwner, expectedUserId?: string): HyperDocumentOwner {
    const owner = expected ?? this.service.owner();
    if (!owner || !workspaceId || owner.workspaceId !== workspaceId) throw new Error('The workspace changed. Reopen All docs and try again.');
    if (expectedUserId !== undefined && owner.actorId !== expectedUserId) throw new Error('The signed-in user changed. Reopen All docs and try again.');
    this.current(owner); return { ...owner };
  }
  private current(owner: HyperDocumentOwner) {
    const actual = this.service.owner();
    if (!actual || actual.workspaceId !== owner.workspaceId) throw new Error('The workspace changed. Reopen All docs and try again.');
    if (actual.actorId !== owner.actorId) throw new Error('The signed-in user changed. Reopen All docs and try again.');
    if (!owner.isCurrent() || hyperDocumentOwnerKey(actual) !== hyperDocumentOwnerKey(owner)) throw new Error('The workspace storage or server changed. Reopen All docs and try again.');
  }
  private async assertOwner(owner: HyperDocumentOwner) {
    this.current(owner); const workspaceId = await this.service.workspaceId(); this.current(owner);
    if (workspaceId !== owner.workspaceId) throw new Error('The workspace changed. Reopen All docs and try again.');
    const actorId = await this.service.userId(); this.current(owner);
    if (actorId !== owner.actorId) throw new Error('The signed-in user changed. Reopen All docs and try again.');
  }
  private async dispatch<T>(owner: HyperDocumentOwner, operation: () => Promise<T>): Promise<T> {
    this.current(owner); const result = await operation(); this.current(owner); await this.assertOwner(owner); return result;
  }
  async assertWorkspace(workspaceId: string) { await this.assertOwner(this.capture(workspaceId)); }
  async pages(workspaceId: string, expected?: HyperDocumentOwner): Promise<ViewPB[]> {
    const owner = this.capture(workspaceId, expected); await this.assertOwner(owner);
    return hyperOrganizationPages(await this.dispatch(owner, () => this.service.views()));
  }
  async page(workspaceId: string, viewId: string, expected?: HyperDocumentOwner): Promise<ViewPB> {
    const owner = this.capture(workspaceId, expected); await this.assertOwner(owner);
    const view = await this.dispatch(owner, () => this.service.view(viewId));
    if (view.id !== viewId) throw new Error('This page is no longer available.'); return view;
  }
  async isTrashed(workspaceId: string, viewId: string, expected?: HyperDocumentOwner): Promise<boolean> {
    const owner = this.capture(workspaceId, expected); await this.assertOwner(owner);
    return (await this.dispatch(owner, () => this.service.trashIds())).includes(viewId);
  }
  ensureJournal(workspaceId: string, date: string, section: ViewSectionPB, expectedUserId?: string, expected?: HyperDocumentOwner): Promise<ViewPB> {
    if (!hyperIsJournalDate(date)) return Promise.reject(new Error('Choose a valid journal date.'));
    let owner: HyperDocumentOwner; try { owner = this.capture(workspaceId, expected, expectedUserId); } catch (error) { return Promise.reject(error); }
    const key = JSON.stringify([hyperDocumentOwnerKey(owner), section, date]);
    const existing = this.journalRequests.get(key);
    if (existing?.owner.isCurrent()) return existing.request;
    const request = this.createOrReadJournal(owner, date, section).finally(() => { if (this.journalRequests.get(key)?.request === request) this.journalRequests.delete(key); });
    this.journalRequests.set(key, { owner, request }); return request;
  }
  private async createOrReadJournal(owner: HyperDocumentOwner, date: string, section: ViewSectionPB): Promise<ViewPB> {
    const pages = await this.pages(owner.workspaceId, owner);
    const existing = pages.filter(view => view.layout === ViewLayoutPB.Document && hyperOrganizationMetadata(view).journalDate === date).sort((a, b) => a.createTime < b.createTime ? -1 : a.createTime > b.createTime ? 1 : a.id.localeCompare(b.id))[0];
    if (existing) return existing;
    const id = uuidV5(owner.workspaceId, section === ViewSectionPB.Private ? `HyperTask:journal:private:${owner.actorId}:${date}` : `HyperTask:journal:${date}`);
    if ((await this.dispatch(owner, () => this.service.trashIds())).includes(id)) throw new Error('This journal is in Trash. Restore it from Trash to open it again.');
    if (await this.dispatch(owner, () => this.service.exists(id))) throw new Error('This journal already exists but is not available in this page list. Its data has not been changed.');
    try { return await this.dispatch(owner, () => this.service.createJournal(owner.workspaceId, id, date, section, JSON.stringify({ hyperOrganization: { journalDate: date, tags: [] } }))); }
    catch (error) {
      this.current(owner);
      const concurrent = (await this.pages(owner.workspaceId, owner)).find(view => view.id === id && hyperOrganizationMetadata(view).journalDate === date);
      if (concurrent) return concurrent; throw error;
    }
  }
  setTags(workspaceId: string, viewId: string, tags: string[], owner?: HyperDocumentOwner): Promise<ViewPB> { return this.updateMetadata(workspaceId, viewId, current => hyperMergeOrganizationMetadata(current, { tags }), owner); }
  setProperty(workspaceId: string, viewId: string, key: string, property: HyperPageProperty | null, owner?: HyperDocumentOwner): Promise<ViewPB> { return this.updateMetadata(workspaceId, viewId, current => hyperMergePageProperty(current, key, property), owner); }
  saveCollection(workspaceId: string, viewId: string, config: HyperCollectionConfig, owner?: HyperDocumentOwner): Promise<ViewPB> { hyperValidateCollection(config); return this.updateMetadata(workspaceId, viewId, current => hyperMergeCollection(current, config), owner); }
  async createCollection(workspaceId: string, parentId: string, name: string, config: HyperCollectionConfig, section: ViewSectionPB, expected?: HyperDocumentOwner): Promise<ViewPB> {
    const owner = this.capture(workspaceId, expected);
    if (!name.trim()) throw new Error('Enter a collection name.');
    const extra = hyperMergeCollection({ oneOfExtra: { case: undefined } }, config); await this.assertOwner(owner);
    if (parentId !== workspaceId) { const parent = await this.dispatch(owner, () => this.service.view(parentId)); if (parent.id !== parentId || parent.oneOfIsLocked.case === 'isLocked' && parent.oneOfIsLocked.value) throw new Error('The parent page is unavailable or locked.'); }
    return this.dispatch(owner, () => this.service.createJournal(parentId, crypto.randomUUID(), name.trim(), section, extra));
  }
  private updateMetadata(workspaceId: string, viewId: string, build: (view: ViewPB) => string, expected?: HyperDocumentOwner): Promise<ViewPB> {
    let owner: HyperDocumentOwner; try { owner = this.capture(workspaceId, expected); } catch (error) { return Promise.reject(error); }
    const key = JSON.stringify([hyperDocumentOwnerKey(owner), viewId]), queued = this.tagWrites.get(key), previous = queued?.owner.isCurrent() ? queued.settled : Promise.resolve();
    const write = previous.then(async () => {
      await this.assertOwner(owner);
      const current = await this.dispatch(owner, () => this.service.view(viewId));
      if (current.id !== viewId || current.oneOfIsLocked.case === 'isLocked' && current.oneOfIsLocked.value) throw new Error('This page is unavailable or locked. Unlock it before changing its properties.');
      const extra = build(current); await this.assertOwner(owner);
      await this.dispatch(owner, () => this.service.updateExtra(viewId, extra));
      return this.dispatch(owner, () => this.service.view(viewId));
    });
    const settled = write.then(() => {}, () => {});
    this.tagWrites.set(key, { owner, settled });
    void settled.then(() => { if (this.tagWrites.get(key)?.settled === settled) this.tagWrites.delete(key); });
    return write;
  }
}
export const hyperOrganizationService = new HyperOrganizationService();
