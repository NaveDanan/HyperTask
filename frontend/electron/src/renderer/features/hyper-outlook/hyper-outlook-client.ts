import type { HyperOutlookCreate, HyperOutlookDelete, HyperOutlookRange, HyperOutlookRespond, HyperOutlookUpdate, IpcResult } from '@shared/api';
async function hyperOutlookUnwrap<T>(result: Promise<IpcResult<T>>): Promise<T> {
  const value = await result;
  if (!value.ok) throw new Error(value.message);
  return value.value;
}
export const hyperOutlookClient = {
  status: () => hyperOutlookUnwrap(window.hypertask.outlook.status()),
  list: (args: HyperOutlookRange) => hyperOutlookUnwrap(window.hypertask.outlook.list(args)),
  create: (args: HyperOutlookCreate) => hyperOutlookUnwrap(window.hypertask.outlook.create(args)),
  update: (args: HyperOutlookUpdate) => hyperOutlookUnwrap(window.hypertask.outlook.update(args)),
  delete: (args: HyperOutlookDelete) => hyperOutlookUnwrap(window.hypertask.outlook.delete(args)),
  respond: (args: HyperOutlookRespond) => hyperOutlookUnwrap(window.hypertask.outlook.respond(args)),
  open: (id: string) => hyperOutlookUnwrap(window.hypertask.outlook.open({ id })),
};
