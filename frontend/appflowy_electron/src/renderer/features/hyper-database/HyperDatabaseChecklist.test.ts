import { expect, it, vi } from 'vitest';
import { HyperDatabaseController } from './HyperDatabaseController';
import { hyperDatabaseBackend } from './HyperDatabaseBackend';
it('sets a checklist completion state without toggling already-completed items', async () => {
  const controller = new HyperDatabaseController('v', hyperDatabaseBackend);
  controller.store.setState({ cells: { r: { f: { kind: 'checklist', display: '1/2', progress: 0.5, items: [{ $typeName: 'SelectOptionPB', id: 'a', name: 'Review', color: 0, completed: true }, { $typeName: 'SelectOptionPB', id: 'b', name: 'Approve', color: 0, completed: false }] } } } });
  vi.spyOn(controller, 'loadCell').mockImplementation(async () => controller.state.cells.r.f);
  const write = vi.spyOn(controller, 'updateCell').mockResolvedValue();
  await controller.setChecklistItemCompleted('r', 'f', 'a', true); expect(write).not.toHaveBeenCalled();
  await controller.setChecklistItemCompleted('r', 'f', 'b', true); expect(write).toHaveBeenCalledWith('r', 'f', { kind: 'checklist', completedIds: ['b'] });
  await expect(controller.setChecklistItemCompleted('r', 'f', 'missing', true)).rejects.toThrow('deleted');
  controller.dispose();
});
it('serializes duplicate completion requests so an item is toggled only once', async () => {
  const controller = new HyperDatabaseController('v', hyperDatabaseBackend);
  const item = { $typeName: 'SelectOptionPB' as const, id: 'a', name: 'Review', color: 0, completed: false };
  vi.spyOn(controller, 'loadCell').mockImplementation(async () => ({ kind: 'checklist', display: '', progress: 0, items: [item] }));
  const write = vi.spyOn(controller, 'updateCell').mockImplementation(async () => { await Promise.resolve(); item.completed = !item.completed; });
  try {
    await Promise.all([controller.setChecklistItemCompleted('r','f','a',true), controller.setChecklistItemCompleted('r','f','a',true)]);
    expect(item.completed).toBe(true); expect(write).toHaveBeenCalledOnce();
  } finally { controller.dispose(); }
});
