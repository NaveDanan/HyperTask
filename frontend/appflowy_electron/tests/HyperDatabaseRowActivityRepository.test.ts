import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { HyperRowActivityAckPBSchema, HyperUpdateRowActivityPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';

afterEach(() => vi.unstubAllGlobals());
describe('Hyper database row activity production repository dispatch', () => {
  it('dispatches one typed visible set and a captured terminal close, preserving bigint revisions', async () => {
    const sent: ReturnType<typeof fromBinary<typeof HyperUpdateRowActivityPBSchema>>[] = [];
    vi.stubGlobal('window', { appflowy: { core: { request: async (event: string, payload: Uint8Array) => {
      expect(event).toBe('HyperUpdateRowActivity'); const request = fromBinary(HyperUpdateRowActivityPBSchema, payload); sent.push(request);
      return { status: 0, payload: toBinary(HyperRowActivityAckPBSchema, create(HyperRowActivityAckPBSchema, { contextId: request.contextId, activityId: request.activityId, revision: request.revision })) };
    } } } });
    const repository = new HyperDatabaseRepository(), source = { viewId: 'view', contextId: 'context', activityId: 'pane', revision: 9007199254740993n, rowIds: ['row-a', 'row-b'], closeActivity: false };
    expect((await repository.updateRowActivity(source)).revision).toBe(source.revision);
    await repository.updateRowActivity({ ...source, revision: source.revision + 1n, rowIds: [], closeActivity: true });
    expect(sent).toHaveLength(2); expect(sent[0]).toMatchObject(source); expect(sent[1]).toMatchObject({ rowIds: [], closeActivity: true, revision: 9007199254740994n });
  });
  it('propagates accepted initialization errors for explicit retry instead of returning a success acknowledgement', async () => {
    vi.stubGlobal('window', { appflowy: { core: { request: async () => ({ status: 1, payload: toBinary(FlowyErrorSchema, create(FlowyErrorSchema, { code: ErrorCode.InvalidParams, msg: 'Accepted pins need retry' })) }) } } });
    await expect(new HyperDatabaseRepository().updateRowActivity({ viewId: 'view', contextId: 'context', activityId: 'pane', revision: 1n, rowIds: ['row'], closeActivity: false })).rejects.toMatchObject({ msg: 'Accepted pins need retry' });
  });
});
