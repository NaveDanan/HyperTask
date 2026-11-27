import type { HyperOutlookEvent, HyperOutlookCreate, HyperOutlookDelete, HyperOutlookRange, HyperOutlookRespond, HyperOutlookUpdate, IpcResult } from '@shared/api';
async function hyperOutlookUnwrap<T>(result: Promise<IpcResult<T>>): Promise<T> {
  const value = await result;
  if (!value.ok) throw new Error(value.message);
  return value.value;
}
export const hyperOutlookClient = {
  subscribe(range: HyperOutlookRange, receive: (items: HyperOutlookEvent[]) => void, fail: (error: Error) => void, refresh = false) {
    const api = window.hypertask.outlook, id = crypto.randomUUID();
    let live = true, updated = false;
    const stop = api.onRange(update => {
      if (update.id !== id || !live) return;
      updated = true;
      if (update.error) fail(new Error(update.error)); else receive(update.items);
    });
    void hyperOutlookUnwrap(api.subscribeRange(id, range, refresh)).then(items => { if (live && !updated) receive(items); },
      error => { if (live && !updated) fail(error); });
    return () => { live = false; stop(); void api.unsubscribeRange(id).catch(() => {}); };
  },
  resolve(item: HyperOutlookEvent): Promise<HyperOutlookEvent> {
    return item.occurrenceHandle ? hyperOutlookUnwrap(window.hypertask.outlook.resolveOccurrence(item.occurrenceHandle)) : Promise.resolve(item);
  },
  status: () => hyperOutlookUnwrap(window.hypertask.outlook.status()),
  list: (args: HyperOutlookRange) => hyperOutlookUnwrap(window.hypertask.outlook.list(args)),
  create: (args: HyperOutlookCreate) => hyperOutlookUnwrap(window.hypertask.outlook.create(args)),
  update: (args: HyperOutlookUpdate) => hyperOutlookUnwrap(window.hypertask.outlook.update(args)),
  delete: (args: HyperOutlookDelete) => hyperOutlookUnwrap(window.hypertask.outlook.delete(args)),
  respond: (args: HyperOutlookRespond) => hyperOutlookUnwrap(window.hypertask.outlook.respond(args)),
  open: (id: string) => hyperOutlookUnwrap(window.hypertask.outlook.open({ id })),
};
