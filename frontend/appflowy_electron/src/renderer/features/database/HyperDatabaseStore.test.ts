import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DatabasePBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { DatabaseViewSettingPBSchema } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { createHyperDatabaseStore } from './HyperDatabaseStore';
import { HyperDatabaseRepository } from './HyperDatabaseRepository';

vi.mock('@/backend/notifications', () => ({ listenAll: vi.fn(() => vi.fn()) }));
const snapshot = () => ({ database: create(DatabasePBSchema, { id: 'db' }), fields: [], fieldSettings: [], calculations: [], settings: create(DatabaseViewSettingPBSchema) });
describe('Hyper database state', () => {
  it('loads metadata without fetching every cell in the database', async () => {
    const repository = new HyperDatabaseRepository();
    repository.load = vi.fn(async () => snapshot()); repository.cell = vi.fn();
    const store = createHyperDatabaseStore('view', repository), stop = store.start();
    await vi.waitFor(() => expect(store.getState().loading).toBe(false));
    expect(repository.cell).not.toHaveBeenCalled(); expect(store.getState().snapshot?.database.id).toBe('db'); stop();
  });
  it('reports backend write failures and leaves the current snapshot intact', async () => {
    const repository = new HyperDatabaseRepository(); repository.load = vi.fn(async () => snapshot());
    const store = createHyperDatabaseStore('view', repository), stop = store.start();
    await vi.waitFor(() => expect(store.getState().loading).toBe(false));
    const result = await store.write(async () => { throw new Error('disk full'); });
    expect(result).toBeNull(); expect(store.getState().error).toBe('disk full'); expect(store.getState().snapshot?.database.id).toBe('db'); expect(store.getState().writing).toBe(false); stop();
  });
  it('does not publish late asynchronous reads after disposal', async () => {
    const repository = new HyperDatabaseRepository(); let resolve: ((value: ReturnType<typeof snapshot>) => void) | undefined;
    repository.load = vi.fn(() => new Promise<ReturnType<typeof snapshot>>(done => { resolve = done; }));
    const store = createHyperDatabaseStore('view', repository), stop = store.start(); stop(); resolve!(snapshot());
    await new Promise(done => setTimeout(done, 0));
    expect(store.getState().snapshot).toBeNull();
  });
});
