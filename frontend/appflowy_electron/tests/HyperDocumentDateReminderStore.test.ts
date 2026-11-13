import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ReminderPBSchema } from '@shared/protobuf/flowy-user/reminder_pb';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';

const f = vi.hoisted(() => ({ scope: 'a', get: vi.fn(), views: vi.fn(), doc: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('../src/renderer/features/document/HyperDocumentOwner', () => ({ hyperGetDocumentOwner: () => { const scope = f.scope; return { workspaceId: scope, actorId: scope, contextKey: 'context', isCurrent: () => f.scope === scope }; }, hyperDocumentOwnerKey: (owner: { workspaceId: string } | null) => owner?.workspaceId ?? '' }));
vi.mock('../src/renderer/backend/events', () => ({ UserEventGetAllReminders: f.get, UserEventUpdateReminder: f.update, UserEventRemoveReminder: f.remove, DocumentEventOpenDocument: f.doc }));
vi.mock('../src/renderer/features/view/view-service', () => ({ ViewBackendService: { getAllViews: f.views } }));
import { reminderActions, useReminderStore } from '../src/renderer/features/sidebar/stores/reminder-store';

const reminder = (id: string) => create(ReminderPBSchema, { id, objectId: 'page', scheduledAt: 1n, meta: { block_id: 'p' } });
const document = (ids: string[]) => create(DocumentDataPBSchema, { pageId: 'page', blocks: { p: { id: 'p', data: JSON.stringify({ delta: ids.map(id => ({ insert: '$', attributes: { mention: { type: 'date', date: '2020-01-01T00:00:00', reminder_id: id } } })) }) } } });
beforeEach(() => {
  vi.stubGlobal('window', { clearInterval, setInterval, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  reminderActions.dispose(); f.scope = 'a'; vi.clearAllMocks();
  f.get.mockResolvedValue({ ok: true, value: { items: [reminder('one')] } }); f.views.mockResolvedValue({ ok: true, value: { items: [create(ViewPBSchema, { id: 'page', layout: ViewLayoutPB.Document })] } }); f.doc.mockResolvedValue({ ok: true, value: document(['one']) }); f.update.mockResolvedValue({ ok: true }); f.remove.mockResolvedValue({ ok: true });
});
afterEach(() => { reminderActions.dispose(); vi.unstubAllGlobals(); });
describe('Hyper document reminder notifications', () => {
  it('shows due reminders only when the exact reminder ID remains in the target block', async () => {
    const future = create(ReminderPBSchema, { ...reminder('future'), scheduledAt: BigInt(Math.floor(Date.now() / 1000) + 3600) });
    f.get.mockResolvedValue({ ok: true, value: { items: [reminder('missing'), reminder('one'), future] } }); f.doc.mockResolvedValue({ ok: true, value: document(['one', 'future']) }); await reminderActions.refresh();
    expect(useReminderStore.getState().reminders.map(item => item.id)).toEqual(['one']); expect(useReminderStore.getState().serverReminders).toHaveLength(3);
  });
  it('drops a late refresh after the active workspace or actor changes', async () => {
    let resolve!: (value: unknown) => void; f.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const refreshing = reminderActions.refresh(); f.scope = 'b'; resolve({ ok: true, value: { items: [reminder('private-a')] } }); await refreshing;
    expect(f.views).not.toHaveBeenCalled(); expect(useReminderStore.getState().reminders).toEqual([]); expect(useReminderStore.getState().serverReminders).toEqual([]);
  });
  it('ignores older refresh responses in the same workspace', async () => {
    let resolve!: (value: unknown) => void; f.get.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const old = reminderActions.refresh();
    await reminderActions.refresh(); resolve({ ok: true, value: { items: [reminder('old')] } }); await old; expect(useReminderStore.getState().reminders.map(item => item.id)).toEqual(['one']);
  });
  it('never commits an old update into a new owner and refuses old-owner removals', async () => {
    await reminderActions.refresh(); let resolve!: (value: unknown) => void; f.update.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const updating = reminderActions.update({ id: 'one', isRead: true });
    f.scope = 'b'; f.get.mockResolvedValue({ ok: true, value: { items: [reminder('two')] } }); f.doc.mockResolvedValue({ ok: true, value: document(['two']) }); await reminderActions.refresh(); resolve({ ok: true }); await updating;
    expect(useReminderStore.getState().reminders.map(item => item.id)).toEqual(['two']); await reminderActions.removeReminder('one'); expect(f.remove).not.toHaveBeenCalled();
  });
  it('marks only successfully saved notifications read and keeps its cached server values current', async () => {
    await reminderActions.refresh(); f.update.mockResolvedValueOnce({ ok: false, error: { msg: 'Unavailable' } }); await reminderActions.markAllRead(); expect(useReminderStore.getState().reminders[0].isRead).toBe(false);
    await reminderActions.markAllRead(); expect(useReminderStore.getState().reminders[0].isRead).toBe(true); expect(useReminderStore.getState().serverReminders[0].isRead).toBe(true);
  });
  it('stops a refresh that was disposed while reading a document', async () => {
    let resolve!: (value: unknown) => void; f.doc.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const refreshing = reminderActions.refresh(); await vi.waitFor(() => expect(resolve).toBeDefined()); reminderActions.dispose(); resolve({ ok: true, value: document(['one']) }); await refreshing; expect(useReminderStore.getState().reminders).toEqual([]);
  });
});
