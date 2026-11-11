import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { ViewLayoutPB, ViewPBSchema, ViewSectionPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperOrganizationService, type HyperOrganizationBackend } from './HyperOrganizationService';
import { hyperOrganizationMetadata } from './HyperOrganizationModel';
import { hyperDefaultCollection, hyperPageProperties, hyperReadCollection } from './HyperCollectionModel';

const workspaceId = '78b95563-9560-4765-aead-70d1ed902fb1';
const otherWorkspaceId = 'e90e0434-0ad0-4992-8f00-07311b675a14';
const journalDate = '2026-11-10';
function setup() {
  let currentWorkspace = workspaceId;
  let currentUser = 'user-1';
  let realm = 'local-one';
  const views = new Map<string, ViewPB>();
  const trash = new Set<string>();
  const backend = {
    owner: () => { const workspace = currentWorkspace, actor = currentUser, context = realm; return { workspaceId: workspace, actorId: actor, contextKey: context, isCurrent: () => workspace === currentWorkspace && actor === currentUser && context === realm }; },
    workspaceId: vi.fn(async () => currentWorkspace),
    userId: vi.fn(async () => currentUser),
    views: vi.fn(async () => [...views.values()].filter(view => !trash.has(view.id))),
    view: vi.fn(async (id: string) => { const view = views.get(id); if (!view) throw new Error('Not found'); return view; }),
    exists: vi.fn(async (id: string) => views.has(id)),
    trashIds: vi.fn(async () => [...trash]),
    createJournal: vi.fn<HyperOrganizationBackend['createJournal']>(async (workspace, id, date, _section, extra) => {
      if (views.has(id)) throw new Error('Already exists');
      const view = create(ViewPBSchema, { id, parentViewId: workspace, name: date, layout: ViewLayoutPB.Document, oneOfExtra: { case: 'extra', value: extra } });
      views.set(id, view); return view;
    }),
    updateExtra: vi.fn<HyperOrganizationBackend['updateExtra']>(async (id, extra) => {
      const view = create(ViewPBSchema, { ...views.get(id)!, oneOfExtra: { case: 'extra', value: extra } });
      views.set(id, view);
    }),
  } satisfies HyperOrganizationBackend;
  return { service: new HyperOrganizationService(backend), backend, views, trash, switchWorkspace: (id: string) => { currentWorkspace = id; }, switchUser: (id: string) => { currentUser = id; }, switchRealm: (value: string) => { realm = value; } };
}
describe('Hyper organization service', () => {
  it('serializes tags, typed properties and collection rules through the same metadata queue', async () => {
    const { service, views } = setup();
    views.set('page', create(ViewPBSchema, { id: 'page', oneOfExtra: { case: 'extra', value: '{"cover":"kept","hyperOrganization":{"journalDate":"2026-11-10"}}' } }));
    await Promise.all([
      service.setTags(workspaceId, 'page', ['Work']),
      service.setProperty(workspaceId, 'page', 'priority', { name: 'Priority', type: 'number', value: 3 }),
      service.saveCollection(workspaceId, 'page', { ...hyperDefaultCollection(), tag: 'Work' }),
    ]);
    const final = views.get('page')!;
    expect(hyperOrganizationMetadata(final)).toEqual({ tags: ['Work'], journalDate });
    expect(hyperPageProperties(final).properties.priority.value).toBe(3);
    expect(hyperReadCollection(final)?.tag).toBe('Work');
    expect(JSON.parse(final.oneOfExtra.case === 'extra' ? final.oneOfExtra.value : '{}').cover).toBe('kept');
  });
  it('creates collections under the chosen accessible parent and refuses locked parents', async () => {
    const { service, backend, views } = setup();
    views.set('parent', create(ViewPBSchema, { id: 'parent', name: 'Parent' }));
    const created = await service.createCollection(workspaceId, 'parent', ' Work collection ', hyperDefaultCollection(), ViewSectionPB.Private);
    expect(created.name).toBe('Work collection'); expect(created.parentViewId).toBe('parent');
    expect(hyperReadCollection(created)).toEqual(hyperDefaultCollection());
    expect(backend.createJournal).toHaveBeenCalledWith('parent', created.id, 'Work collection', ViewSectionPB.Private, expect.any(String));
    views.set('parent', create(ViewPBSchema, { id: 'parent', oneOfIsLocked: { case: 'isLocked', value: true } }));
    await expect(service.createCollection(workspaceId, 'parent', 'Bad', hyperDefaultCollection(), ViewSectionPB.Public)).rejects.toThrow('locked');
    expect(backend.createJournal).toHaveBeenCalledTimes(1);
  });
  it('refuses property writes after an account change or to a locked page', async () => {
    const { service, backend, views, switchUser } = setup();
    views.set('page', create(ViewPBSchema, { id: 'page', oneOfIsLocked: { case: 'isLocked', value: true } }));
    await expect(service.setProperty(workspaceId, 'page', 'done', { name: 'Done', type: 'checkbox', value: false })).rejects.toThrow('locked');
    views.set('page', create(ViewPBSchema, { id: 'page' }));
    backend.view.mockImplementationOnce(async () => { switchUser('other'); return views.get('page')!; });
    await expect(service.setProperty(workspaceId, 'page', 'done', { name: 'Done', type: 'checkbox', value: true })).rejects.toThrow('user changed');
    expect(backend.updateExtra).not.toHaveBeenCalled();
  });
  it('reuses persisted journal metadata even when the title was renamed', async () => {
    const { service, backend, views } = setup();
    const original = create(ViewPBSchema, { id: 'existing', name: 'Renamed journal', layout: ViewLayoutPB.Document, oneOfExtra: { case: 'extra', value: JSON.stringify({ hyperOrganization: { journalDate } }) } });
    views.set(original.id, original);
    expect(await service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public)).toBe(original);
    expect(backend.createJournal).not.toHaveBeenCalled();
  });
  it('coalesces concurrent requests and derives stable ids across service instances', async () => {
    const { service, backend, views } = setup();
    const first = service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Private);
    const second = service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Private);
    expect(second).toBe(first);
    const page = await first;
    expect(backend.createJournal).toHaveBeenCalledTimes(1);
    expect(backend.createJournal).toHaveBeenCalledWith(workspaceId, page.id, journalDate, ViewSectionPB.Private, expect.any(String));
    const freshService = new HyperOrganizationService(backend);
    expect((await freshService.ensureJournal(workspaceId, journalDate, ViewSectionPB.Private)).id).toBe(page.id);
    views.clear();
    expect((await freshService.ensureJournal(workspaceId, journalDate, ViewSectionPB.Private)).id).toBe(page.id);
  });
  it('uses distinct ids for another workspace and does not write after a workspace switch', async () => {
    const { service, backend, switchWorkspace } = setup();
    const first = await service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public);
    switchWorkspace(otherWorkspaceId);
    backend.views.mockResolvedValue([]);
    const second = await service.ensureJournal(otherWorkspaceId, journalDate, ViewSectionPB.Public);
    expect(second.id).not.toBe(first.id);
    backend.createJournal.mockClear();
    await expect(service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public)).rejects.toThrow('workspace changed');
    expect(backend.createJournal).not.toHaveBeenCalled();
  });
  it('detects a workspace switch during list loading', async () => {
    const { service, backend, switchWorkspace } = setup();
    backend.views.mockImplementationOnce(async () => { switchWorkspace(otherWorkspaceId); return []; });
    await expect(service.pages(workspaceId)).rejects.toThrow('workspace changed');
  });
  it('rejects a page list from the previous account in the same workspace', async () => {
    const { service, backend, views, switchUser } = setup();
    const privatePage = create(ViewPBSchema, { id: 'private-page', name: 'Previous account private page' });
    views.set(privatePage.id, privatePage);
    backend.views.mockImplementationOnce(async () => { switchUser('user-2'); return [privatePage]; });
    await expect(service.pages(workspaceId)).rejects.toThrow('user changed');
  });
  it('captures the account before the first async dispatch and drops a same-ID realm response', async () => {
    const first = setup(); first.backend.workspaceId.mockImplementationOnce(async () => { first.switchUser('user-2'); return workspaceId; });
    await expect(first.service.pages(workspaceId)).rejects.toThrow('user changed'); expect(first.backend.views).not.toHaveBeenCalled();
    const second = setup(); second.backend.views.mockImplementationOnce(async () => { second.switchRealm('other-storage'); return [create(ViewPBSchema, { id: 'private', name: 'Old private title' })]; });
    await expect(second.service.pages(workspaceId)).rejects.toThrow('storage or server changed');
  });
  it('does not share an in-flight journal request with the same IDs in another realm', async () => {
    const f = setup(); let release!: (views: ViewPB[]) => void; f.backend.views.mockImplementationOnce(() => new Promise<ViewPB[]>(resolve => { release = resolve; }));
    const first = f.service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public); const rejected = first.catch(error => error); await vi.waitFor(() => expect(release).toBeDefined());
    f.switchRealm('other-server'); const second = f.service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public); expect(second).not.toBe(first); const created = await second;
    release([]); expect(await rejected).toBeInstanceOf(Error); expect(f.backend.createJournal).toHaveBeenCalledOnce(); expect(created.name).toBe(journalDate);
  });
  it('separates metadata queues by full owner and cancels queued writes from the previous realm', async () => {
    const f = setup(); f.views.set('page', create(ViewPBSchema, { id: 'page', oneOfExtra: { case: 'extra', value: '{"realm":"old"}' } })); let release!: () => void;
    f.backend.updateExtra.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = f.service.setTags(workspaceId, 'page', ['Old']); const firstError = first.catch(error => error), queued = f.service.setProperty(workspaceId, 'page', 'old', { type: 'text', name: 'Old', value: 'private' }); const queuedError = queued.catch(error => error);
    await vi.waitFor(() => expect(release).toBeDefined()); f.switchRealm('new-storage'); f.views.set('page', create(ViewPBSchema, { id: 'page', oneOfExtra: { case: 'extra', value: '{"realm":"new"}' } }));
    const current = await f.service.setTags(workspaceId, 'page', ['New']); expect(hyperOrganizationMetadata(current).tags).toEqual(['New']); release(); expect(await firstError).toBeInstanceOf(Error); expect(await queuedError).toBeInstanceOf(Error); expect(f.backend.updateExtra).toHaveBeenCalledTimes(2); expect(hyperPageProperties(f.views.get('page')!).properties.old).toBeUndefined();
  });
  it('does not issue a private follow-up read after a write changes the account or realm', async () => {
    for (const change of ['user', 'realm'] as const) {
      const f = setup(); f.views.set('page', create(ViewPBSchema, { id: 'page', oneOfExtra: { case: 'extra', value: '{}' } }));
      f.backend.updateExtra.mockImplementationOnce(async () => { if (change === 'user') f.switchUser('user-2'); else f.switchRealm('new-server'); });
      await expect(f.service.setTags(workspaceId, 'page', ['Tag'])).rejects.toThrow(); expect(f.backend.view).toHaveBeenCalledOnce();
    }
  });
  it('rejects stale expected owners on otherwise matching IDs', async () => {
    const f = setup(), owner = f.backend.owner(); f.switchRealm('other-server'); await expect(f.service.pages(workspaceId, owner)).rejects.toThrow('storage or server changed'); expect(f.backend.workspaceId).not.toHaveBeenCalled();
  });
  it('reuses a concurrently created journal without retrying a destructive create', async () => {
    const { service, backend, views } = setup();
    backend.createJournal.mockImplementationOnce(async (workspace, id, date, _section, extra) => {
      views.set(id, create(ViewPBSchema, { id, parentViewId: workspace, layout: ViewLayoutPB.Document, name: date, oneOfExtra: { case: 'extra', value: extra } }));
      throw new Error('Already exists');
    });
    expect(hyperOrganizationMetadata(await service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public)).journalDate).toBe(journalDate);
    expect(backend.createJournal).toHaveBeenCalledTimes(1);
  });
  it('reports an inaccessible or trashed deterministic id instead of recreating or reopening it', async () => {
    const { service, backend } = setup();
    backend.createJournal.mockRejectedValue(new Error('Already exists'));
    await expect(service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public)).rejects.toThrow('Already exists');
    expect(backend.view).not.toHaveBeenCalled();
  });
  it('refuses a known trashed journal before issuing CreateView', async () => {
    const { service, backend, trash } = setup();
    const journal = await service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public);
    trash.add(journal.id); backend.createJournal.mockClear();
    await expect(service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public)).rejects.toThrow('Trash');
    expect(backend.createJournal).not.toHaveBeenCalled();
  });
  it('does not overwrite an existing id hidden from the visible page list', async () => {
    const { service, backend } = setup();
    backend.exists.mockResolvedValue(true);
    await expect(service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Public)).rejects.toThrow('not available');
    expect(backend.createJournal).not.toHaveBeenCalled();
  });
  it('uses separate deterministic private journal ids for each user and detects account switches', async () => {
    const { service, backend, switchUser } = setup();
    const first = await service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Private, 'user-1');
    switchUser('user-2'); backend.views.mockResolvedValue([]);
    const second = await service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Private, 'user-2');
    expect(second.id).not.toBe(first.id);
    backend.createJournal.mockClear();
    await expect(service.ensureJournal(workspaceId, journalDate, ViewSectionPB.Private, 'user-1')).rejects.toThrow('user changed');
    expect(backend.createJournal).not.toHaveBeenCalled();
  });
  it('validates date before making any backend request', async () => {
    const { service, backend } = setup();
    await expect(service.ensureJournal(workspaceId, '2026-02-30', ViewSectionPB.Public)).rejects.toThrow('valid journal date');
    expect(backend.workspaceId).not.toHaveBeenCalled();
  });
  it('serializes tag writes and merges into the latest page metadata', async () => {
    const { service, backend, views } = setup();
    views.set('page', create(ViewPBSchema, { id: 'page', oneOfExtra: { case: 'extra', value: '{"cover":{"type":"2"},"hyperOrganization":{"journalDate":"2026-11-10"}}' } }));
    let release: (() => void) | undefined;
    backend.updateExtra.mockImplementationOnce(async (id, extra) => {
      await new Promise<void>(resolve => { release = resolve; });
      const merged = { ...JSON.parse(extra), newValue: 'preserved from a concurrent update' };
      const page = create(ViewPBSchema, { id, oneOfExtra: { case: 'extra', value: JSON.stringify(merged) } });
      views.set(id, page);
    });
    const first = service.setTags(workspaceId, 'page', ['First']);
    const second = service.setTags(workspaceId, 'page', ['Second']);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(backend.view).toHaveBeenCalledTimes(1);
    release!(); await first;
    const page = await second;
    expect(JSON.parse(page.oneOfExtra.case === 'extra' ? page.oneOfExtra.value : '{}')).toEqual({ cover: { type: '2' }, newValue: 'preserved from a concurrent update', hyperOrganization: { journalDate, tags: ['Second'] } });
  });
  it('refuses locked or malformed page metadata without issuing a write', async () => {
    const { service, backend, views } = setup();
    views.set('locked', create(ViewPBSchema, { id: 'locked', oneOfIsLocked: { case: 'isLocked', value: true } }));
    await expect(service.setTags(workspaceId, 'locked', ['Tag'])).rejects.toThrow('locked');
    views.set('broken', create(ViewPBSchema, { id: 'broken', oneOfExtra: { case: 'extra', value: '{bad' } }));
    await expect(service.setTags(workspaceId, 'broken', ['Tag'])).rejects.toThrow();
    expect(backend.updateExtra).not.toHaveBeenCalled();
  });
});
