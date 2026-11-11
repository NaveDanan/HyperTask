import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { rowDocumentIdForRow } from '../templates/converter';
import { HyperDocumentMediaPreparedError, HyperDocumentMediaService, type HyperDocumentMediaBackend } from './HyperDocumentMediaService';

const values = { name: '', caption: 'Caption', alt: 'Alt' };
function setup(local = true) {
  let identity = { workspaceId: 'workspace', userId: 'user', local }, writable = true;
  const view = create(ViewPBSchema, { id: 'document', layout: ViewLayoutPB.Document });
  const api: HyperDocumentMediaBackend = {
    identity: vi.fn(async () => identity), view: vi.fn(async () => view),
    row: vi.fn(async () => create(RowMetaPBSchema, { id: 'row', oneOfDocumentId: { case: 'documentId', value: 'document' }, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } })),
    importFile: vi.fn(async () => ({ path: '/storage/images/copied.png', name: 'Original.png', size: 4, previewUrl: 'appflowy-file://local/images/copied.png' })),
    upload: vi.fn(async () => 'https://self-hosted.example/blob/uploaded.png'), preview: vi.fn(async () => 'appflowy-file://local/images/copied.png'),
    openPath: vi.fn(async () => ''), openExternal: vi.fn(async () => {}), saveFile: vi.fn(async () => '/downloads/file.png'), download: vi.fn(async () => {}),
  };
  const options = { documentId: 'document', identity, writable: () => writable };
  return { api, options, view, service: new HyperDocumentMediaService(api), readOnly: () => { writable = false; }, changeIdentity: () => { identity = { ...identity, userId: 'another' }; } };
}
describe('Hyper document media service', () => {
  it('copies local files and uses the native cloud uploader for self-hosted workspaces', async () => {
    const local = setup(), cloud = setup(false);
    expect(await local.service.start('document', () => true)).toEqual(local.options.identity);
    const copied = await local.service.prepareLocal('/original/image.png', 'image', values, local.options);
    expect(copied.media).toMatchObject({ source: 'local', url: '/storage/images/copied.png', name: 'Original.png', caption: 'Caption', alt: 'Alt' });
    expect(local.api.importFile).toHaveBeenCalledWith('/original/image.png', 'image'); expect(local.api.upload).not.toHaveBeenCalled();
    const uploaded = await cloud.service.prepareLocal('/original/image.png', 'file', values, cloud.options);
    expect(uploaded.media).toMatchObject({ kind: 'file', source: 'cloud', url: 'https://self-hosted.example/blob/uploaded.png' });
    expect(cloud.api.upload).toHaveBeenCalledWith('workspace', 'document', '/original/image.png'); expect(cloud.api.importFile).not.toHaveBeenCalled();
    const network = await local.service.prepareNetwork('https://example.org/file.pdf', 'file', values, local.options);
    expect(network.media).toMatchObject({ source: 'network', name: 'file.pdf' });
  });
  it('blocks read-only, locked, cancelled and stale actor writes before saving any file', async () => {
    for (const mode of ['readonly', 'locked', 'cancelled', 'actor']) {
      const current = setup(), controller = new AbortController();
      if (mode === 'readonly') current.readOnly();
      if (mode === 'locked') current.view.oneOfIsLocked = { case: 'isLocked', value: true };
      if (mode === 'cancelled') controller.abort();
      if (mode === 'actor') current.changeIdentity();
      await expect(current.service.prepareLocal('/original', 'image', values, { ...current.options, signal: controller.signal })).rejects.toThrow();
      expect(current.api.importFile).not.toHaveBeenCalled(); expect(current.api.upload).not.toHaveBeenCalled();
    }
  });
  it('retains completed copies and uploads when permissions, user or cancellation change during saving', async () => {
    for (const local of [true, false]) {
      const current = setup(local);
      if (local) vi.mocked(current.api.importFile).mockImplementation(async () => { current.readOnly(); return { path: '/storage/copied.png', name: 'kept.png', size: 3, previewUrl: 'appflowy-file://local/files/copied.png' }; });
      else vi.mocked(current.api.upload).mockImplementation(async () => { current.changeIdentity(); return 'https://self-hosted.example/kept.png'; });
      let failure: unknown;
      try { await current.service.prepareLocal('/original', 'image', values, current.options); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(HyperDocumentMediaPreparedError);
      expect((failure as HyperDocumentMediaPreparedError).prepared.media.url).toContain(local ? 'copied.png' : 'kept.png');
      expect(Object.keys(current.api).some(key => /delete|remove/i.test(key))).toBe(false);
    }
    const cancelled = setup(), controller = new AbortController();
    vi.mocked(cancelled.api.importFile).mockImplementation(async () => { controller.abort(); return { path: '/storage/kept.png', name: 'kept.png', size: 1, previewUrl: 'appflowy-file://local/files/kept.png' }; });
    await expect(cancelled.service.prepareLocal('/original', 'file', values, { ...cancelled.options, signal: controller.signal })).rejects.toBeInstanceOf(HyperDocumentMediaPreparedError);
  });
  it('opens local/network files, downloads cloud files, and rechecks identity after the save dialog', async () => {
    const current = setup();
    const local = (await current.service.prepareLocal('/original', 'file', values, current.options)).media;
    await current.service.open(local, 'document'); expect(current.api.openPath).toHaveBeenCalledWith(local.url);
    expect(await current.service.preview(local)).toContain('appflowy-file:');
    const network = (await current.service.prepareNetwork('https://example.org/file', 'file', values, current.options)).media;
    await current.service.open(network, 'document'); expect(current.api.openExternal).toHaveBeenCalledWith(network.url);
    await current.service.download({ ...network, source: 'cloud' }, 'document'); expect(current.api.download).toHaveBeenCalledWith(network.url, '/downloads/file.png');
    vi.mocked(current.api.download).mockClear(); vi.mocked(current.api.saveFile).mockImplementation(async () => { current.changeIdentity(); return '/downloads/changed'; });
    await expect(current.service.download(network, 'document')).rejects.toThrow('changed'); expect(current.api.download).not.toHaveBeenCalled();
  });
  it('supports explicit and fallback row document IDs through the owning database scope', async () => {
    const current = setup(); current.view.id = 'database'; current.view.layout = ViewLayoutPB.Grid;
    const rowScope = { viewId: 'database', rowId: 'row' };
    const copied = await current.service.prepareLocal('/original', 'file', values, { ...current.options, rowScope });
    expect(current.api.view).toHaveBeenCalledWith('database'); expect(current.api.view).not.toHaveBeenCalledWith('document');
    expect(current.api.row).toHaveBeenCalledWith('database', 'row');
    await current.service.open(copied.media, 'document', undefined, undefined, rowScope);
    expect(current.api.openPath).toHaveBeenCalledWith(copied.media.url);
    const fallbackRow = '44444444-1111-2222-3333-555555555555';
    vi.mocked(current.api.row).mockResolvedValue(create(RowMetaPBSchema, { id: fallbackRow, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }));
    const fallback = rowDocumentIdForRow(fallbackRow);
    expect(await current.service.start(fallback, () => true, undefined, { ...rowScope, rowId: fallbackRow })).toEqual(current.options.identity);
    const cloud = setup(false); cloud.view.id = 'database'; cloud.view.layout = ViewLayoutPB.Board;
    await cloud.service.prepareLocal('/original', 'file', values, { ...cloud.options, rowScope });
    expect(cloud.api.upload).toHaveBeenCalledWith('workspace', 'document', '/original');
  });
  it('rejects removed, empty, mismatched or locked row scopes before importing media', async () => {
    for (const mode of ['removed', 'empty', 'wrong-document', 'wrong-row', 'locked', 'changed-lock']) {
      const current = setup(); current.view.id = 'database'; current.view.layout = ViewLayoutPB.Grid;
      const row = create(RowMetaPBSchema, { id: mode === 'wrong-row' ? 'different' : 'row', oneOfDocumentId: { case: 'documentId', value: mode === 'wrong-document' ? 'changed-document' : 'document' }, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: mode === 'empty' } });
      vi.mocked(current.api.row).mockImplementation(async () => {
        if (mode === 'removed') throw new Error('Row unavailable');
        if (mode === 'changed-lock') current.view.oneOfIsLocked = { case: 'isLocked', value: true };
        return row;
      });
      if (mode === 'locked') current.view.oneOfIsLocked = { case: 'isLocked', value: true };
      await expect(current.service.prepareLocal('/original', 'image', values, { ...current.options, rowScope: { viewId: 'database', rowId: 'row' } }), mode).rejects.toThrow();
      expect(current.api.importFile).not.toHaveBeenCalled();
    }
  });
  it('keeps imported files after row deletion and rejects row changes while a download destination is chosen', async () => {
    const current = setup(); current.view.id = 'database'; current.view.layout = ViewLayoutPB.Calendar;
    const rowScope = { viewId: 'database', rowId: 'row' };
    const network = await current.service.prepareNetwork('https://example.org/file.pdf', 'file', values, { ...current.options, rowScope });
    vi.mocked(current.api.saveFile).mockImplementation(async () => { vi.mocked(current.api.row).mockRejectedValue(new Error('Row removed')); return '/downloads/file.pdf'; });
    await expect(current.service.download(network.media, 'document', undefined, undefined, rowScope)).rejects.toThrow('Row removed'); expect(current.api.download).not.toHaveBeenCalled();
    vi.mocked(current.api.row).mockResolvedValue(create(RowMetaPBSchema, { id: 'row', oneOfDocumentId: { case: 'documentId', value: 'document' } }));
    vi.mocked(current.api.importFile).mockImplementation(async () => {
      vi.mocked(current.api.row).mockRejectedValue(new Error('Row removed'));
      return { path: '/managed/kept.png', name: 'kept.png', size: 1, previewUrl: 'appflowy-file://local/files/kept.png' };
    });
    await expect(current.service.prepareLocal('/original', 'file', values, { ...current.options, rowScope })).rejects.toBeInstanceOf(HyperDocumentMediaPreparedError);
  });
});
