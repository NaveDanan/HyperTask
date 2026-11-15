import { expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
const calls = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), open: vi.fn() }));
vi.mock('@/backend/events', () => ({ FolderEventCreateView: calls.create, FolderEventUpdateView: calls.update, FolderEventSetLatestView: calls.open }));
const { ViewBackendService } = await import('@/features/view/view-service');
it('sets the Gantt extra before announcing the newly created current view', async () => {
  const order: string[] = [];
  const view = create(ViewPBSchema, { id: 'v', layout: ViewLayoutPB.Grid, oneOfExtra: { case: 'extra', value: '{"font":"Geist"}' } });
  calls.create.mockImplementation(async () => { order.push('create'); return { ok: true, value: view }; });
  calls.update.mockImplementation(async (payload: { oneOfExtra: { value: string } }) => { order.push('update'); return { ok: true, value: { ...view, oneOfExtra: { case: 'extra', value: payload.oneOfExtra.value } } }; });
  calls.open.mockImplementation(async () => { order.push('open'); return { ok: true, value: undefined }; });
  const result = await ViewBackendService.createView({ layoutType: ViewLayoutPB.Grid, hyperLayout: 'gantt', parentViewId: 'workspace', name: '', openAfterCreate: true });
  expect(calls.create).toHaveBeenCalledWith(expect.objectContaining({ setAsCurrent: false, name: 'Gantt', layout: ViewLayoutPB.Grid }));
  expect(order).toEqual(['create', 'update', 'open']); expect(result.ok).toBe(true);
  if (result.ok) expect(JSON.parse(result.value.oneOfExtra.value!)).toEqual({ font: 'Geist', hyper_layout: 'gantt' });
});
