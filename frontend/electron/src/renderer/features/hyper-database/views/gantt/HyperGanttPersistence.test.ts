import { create } from '@bufbuild/protobuf';
import { expect, it, vi } from 'vitest';
import { ViewPBSchema, ViewLayoutPB, RepeatedViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { HyperDatabaseController } from '../../HyperDatabaseController';
import { hyperDatabaseBackend } from '../../HyperDatabaseBackend';

it('keeps Gantt routing and unrelated extra when the core acknowledges settings without a view payload', async () => {
  const view = create(ViewPBSchema, { id: 'timeline', name: 'Launch plan', layout: ViewLayoutPB.Grid, oneOfExtra: { case: 'extra', value: '{"hyper_layout":"gantt","font":"Geist"}' } });
  const updateView = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const backend = { ...hyperDatabaseBackend, updateView, allViews: vi.fn(async () => ({ ok: true as const, value: create(RepeatedViewPBSchema) })) };
  const controller = new HyperDatabaseController(view.id, backend);
  controller.store.setState({ view, status: 'ready' });
  try {
    await controller.updateViewExtra({ hyper_gantt: { start_field_id: 'dates', end_field_id: null, scale: 'quarter', zoom: 2 } });
    expect(controller.state.view?.id).toBe('timeline');
    expect(controller.state.view?.name).toBe('Launch plan');
    expect(JSON.parse(controller.state.view!.oneOfExtra.value!)).toEqual({ hyper_layout: 'gantt', font: 'Geist', hyper_gantt: { start_field_id: 'dates', end_field_id: null, scale: 'quarter', zoom: 2 } });
  } finally { controller.dispose(); }
});
