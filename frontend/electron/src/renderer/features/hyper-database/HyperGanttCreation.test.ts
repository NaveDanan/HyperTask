import { afterEach, expect, it, vi } from 'vitest';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { ErrorCode } from '@shared/protobuf/hyper-error/code_pb';
import { HyperErrorSchema } from '@shared/protobuf/hyper-error/errors_pb';
import { CreateViewPayloadPBSchema, UpdateViewPayloadPBSchema, ViewIdPBSchema, ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/hyper-folder/view_pb';
import { FolderEventUpdateView } from '@/backend/events/hyper-folder';
import { ViewBackendService } from '@/features/view/view-service';

// Mock the wire boundary so the generated wrappers decode the core's real response shapes.
function backend() {
  let view = create(ViewPBSchema, { id: 'v', layout: ViewLayoutPB.Grid, oneOfExtra: { case: 'extra', value: '{"font":"Geist"}' } });
  const request = vi.fn(async (event: string, payload: Uint8Array) => {
    if (event === 'CreateView') {
      const input = fromBinary(CreateViewPayloadPBSchema, payload);
      view = { ...view, name: input.name, parentViewId: input.parentViewId, layout: input.layout };
      return { status: 0, payload: toBinary(ViewPBSchema, view) };
    }
    if (event === 'UpdateView') {
      const input = fromBinary(UpdateViewPayloadPBSchema, payload);
      expect(input.viewId).toBe(view.id);
      if (input.oneOfExtra.case === 'extra') view = { ...view, oneOfExtra: input.oneOfExtra };
      if (input.oneOfName.case === 'name') view = { ...view, name: input.oneOfName.value };
      return { status: 0, payload: new Uint8Array() };
    }
    if (event === 'GetView' || event === 'SetLatestView') {
      expect(fromBinary(ViewIdPBSchema, payload).value).toBe(view.id);
      return { status: 0, payload: event === 'GetView' ? toBinary(ViewPBSchema, view) : new Uint8Array() };
    }
    throw new Error(`Unexpected event: ${event}`);
  });
  vi.stubGlobal('window', { hypertask: { core: { request } } });
  return request;
}
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('returns the persisted Gantt view after an empty update acknowledgement (open=%s)', async openAfterCreate => {
  const request = backend();
  const result = await ViewBackendService.createView({ layoutType: ViewLayoutPB.Grid, hyperLayout: 'gantt', parentViewId: 'workspace', name: '', openAfterCreate });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.id).toBe('v');
    expect(result.value.name).toBe('Gantt');
    expect(result.value.layout).toBe(ViewLayoutPB.Grid);
    expect(JSON.parse(result.value.oneOfExtra.value!)).toEqual({ font: 'Geist', hyper_layout: 'gantt' });
  }
  expect(fromBinary(CreateViewPayloadPBSchema, request.mock.calls[0][1]).setAsCurrent).toBe(false);
  expect(request.mock.calls.map(([event]) => event)).toEqual(['CreateView', 'UpdateView', 'GetView', ...(openAfterCreate ? ['SetLatestView'] : [])]);
});

it('decodes UpdateView as an acknowledgement and re-reads updates at the service boundary', async () => {
  const request = backend();
  expect(await FolderEventUpdateView({ viewId: 'v' })).toEqual({ ok: true, value: undefined });
  const result = await ViewBackendService.updateView({ viewId: 'v', name: 'Renamed' });
  expect(result).toMatchObject({ ok: true, value: { id: 'v', name: 'Renamed' } });
  expect(request.mock.calls.map(([event]) => event)).toEqual(['UpdateView', 'UpdateView', 'GetView']);
});

it.each(['UpdateView', 'GetView', 'SetLatestView'])('propagates a %s failure without announcing an incomplete Gantt', async failedEvent => {
  const request = backend();
  const send = request.getMockImplementation()!;
  const error = create(HyperErrorSchema, { code: ErrorCode.Internal, msg: `${failedEvent} failed` });
  request.mockImplementation(async (event, payload) => event === failedEvent ? { status: 1, payload: toBinary(HyperErrorSchema, error) } : send(event, payload));
  const result = await ViewBackendService.createView({ layoutType: ViewLayoutPB.Grid, hyperLayout: 'gantt', parentViewId: 'workspace', name: 'Timeline', openAfterCreate: true });
  expect(result).toEqual({ ok: false, error });
  if (failedEvent !== 'SetLatestView') expect(request.mock.calls.map(([event]) => event)).not.toContain('SetLatestView');
});
