import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperDocumentLinkService, hyperDocumentReferences, hyperPageMention, type HyperLinkBackend, type HyperBacklinkProgress } from './HyperDocumentLinkService';

const view = (id: string) => create(ViewPBSchema, { id, name: id, layout: ViewLayoutPB.Document });
function document(target = 'target') {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', data: '{}', childrenId: 'root-children' },
    p: { id: 'p', parentId: 'root', ty: 'paragraph', data: JSON.stringify({ delta: [{ insert: 'See ' }, ...hyperPageMention(target)] }), childrenId: 'p-children' },
    orphan: { id: 'orphan', ty: 'paragraph', data: JSON.stringify({ delta: hyperPageMention('orphan-target') }) },
  }, meta: { childrenMap: { 'root-children': { children: ['p'] }, 'p-children': { children: [] } }, textMap: { deleted: JSON.stringify(hyperPageMention('deleted-target')) } } });
}
function setup(ids = ['target', 'source']) {
  let identity = { workspaceId: 'workspace', userId: 'user' };
  const api: HyperLinkBackend = {
    identity: vi.fn(async () => identity), views: vi.fn(async () => ids.map(view)),
    view: vi.fn(async id => view(id)), document: vi.fn(async () => document()),
  };
  return { api, service: new HyperDocumentLinkService(api), setIdentity: (next: typeof identity) => { identity = next; } };
}
describe('Hyper document links', () => {
  it('writes upstream-compatible page mention attributes', () => {
    expect(hyperPageMention('page')).toEqual([{ insert: '$', attributes: { mention: { type: 'page', page_id: 'page' } } }]);
    expect(() => hyperPageMention('')).toThrow('Choose');
  });
  it('finds only live tree references and rejects broken trees', () => {
    expect(hyperDocumentReferences(document(), 'target')).toEqual({ blockIds: ['p'], preview: 'See $' });
    expect(hyperDocumentReferences(document(), 'orphan-target').blockIds).toEqual([]);
    expect(hyperDocumentReferences(document(), 'deleted-target').blockIds).toEqual([]);
    const broken = document(); broken.meta!.childrenMap['p-children'].children.push('p');
    expect(() => hyperDocumentReferences(broken, 'target')).toThrow('repeated');
  });
  it('scans accessible document pages with bounded concurrency and reports read failures', async () => {
    const { api, service } = setup(['target', 'a', 'b', 'c', 'd', 'bad']);
    let active = 0, maximum = 0;
    vi.mocked(api.document).mockImplementation(async id => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      if (id === 'bad') throw new Error('Could not read document');
      return document();
    });
    const reports: HyperBacklinkProgress[] = [];
    const result = await service.backlinks('target', progress => reports.push(progress));
    expect(maximum).toBeLessThanOrEqual(3); expect(maximum).toBeGreaterThan(1);
    expect(result.links.map(link => link.view.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(result.failures).toEqual([{ id: 'bad', message: 'Could not read document' }]);
    expect(result.completed).toBe(5); expect(reports[0].completed).toBe(0);
    expect(api.document).not.toHaveBeenCalledWith('target');
  });
  it('rejects results when the signed-in actor changes during a document read', async () => {
    const { api, service, setIdentity } = setup();
    vi.mocked(api.document).mockImplementation(async () => { setIdentity({ workspaceId: 'workspace', userId: 'another-user' }); return document(); });
    const reports: HyperBacklinkProgress[] = [];
    await expect(service.backlinks('target', progress => reports.push(progress))).rejects.toThrow('signed-in user changed');
    expect(reports.every(progress => !progress.links.length)).toBe(true);
  });
  it('cancels in-flight scans without publishing late results', async () => {
    const { api, service } = setup(), controller = new AbortController();
    let finish!: () => void;
    vi.mocked(api.document).mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return document(); });
    const reports: HyperBacklinkProgress[] = [];
    const scanning = service.backlinks('target', progress => reports.push(progress), controller.signal);
    const rejected = expect(scanning).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort(); finish(); await rejected;
    expect(reports.every(progress => !progress.links.length)).toBe(true);
  });
  it('revalidates workspace and target access before inserting', async () => {
    const { api, service, setIdentity } = setup();
    const { identity } = await service.pages();
    setIdentity({ workspaceId: 'other-workspace', userId: 'user' });
    await expect(service.insertTarget('source', identity)).rejects.toThrow('workspace');
    expect(api.view).not.toHaveBeenCalled();
  });
  it('rejects a mismatched view before inserting or opening a page', async () => {
    const { api, service } = setup();
    const { identity } = await service.pages();
    vi.mocked(api.view).mockResolvedValue(view('another-page'));
    await expect(service.insertTarget('source', identity)).rejects.toThrow('no longer available');
  });
  it('omits the structural workspace root and spaces while retaining pages with invalid metadata', async () => {
    const { api, service } = setup();
    const space = view('space'); space.oneOfExtra = { case: 'extra', value: '{"is_space":true}' };
    const broken = view('broken'); broken.oneOfExtra = { case: 'extra', value: 'unreadable' };
    vi.mocked(api.views).mockResolvedValue([view('workspace'), space, broken, view('page')]);
    expect((await service.pages()).views.map(page => page.id)).toEqual(['broken', 'page']);
  });
});
