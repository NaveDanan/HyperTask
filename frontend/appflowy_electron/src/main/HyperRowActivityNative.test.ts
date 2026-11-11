import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { HyperRowActivityAckPBSchema, HyperUpdateRowActivityPBSchema } from '../shared/protobuf/flowy-database2/database_entities_pb';
import { createHyperRowActivityNative } from './HyperRowActivityNative';
import { HyperRowActivityIpc } from './HyperRowActivityIpc';

const payload = (changes: Record<string, unknown> = {}) => toBinary(HyperUpdateRowActivityPBSchema, create(HyperUpdateRowActivityPBSchema, { viewId: 'view', contextId: 'context', activityId: 'pane', revision: 1n, rowIds: ['row'], closeActivity: false, ...changes }));
describe('Hyper row activity typed native adapter', () => {
  it('preserves submitted protobuf bytes and encodes terminal bool6 without starting a core', async () => {
    const calls: { event: string; payload: Uint8Array }[] = []; let starts = 0;
    const native = createHyperRowActivityNative({ request: async (event, bytes) => {
      calls.push({ event, payload: new Uint8Array(bytes) }); const request = fromBinary(HyperUpdateRowActivityPBSchema, bytes);
      return { status: 0, payload: toBinary(HyperRowActivityAckPBSchema, create(HyperRowActivityAckPBSchema, { contextId: request.contextId, activityId: request.activityId, revision: request.revision })) };
    } });
    const tracker = new HyperRowActivityIpc({ existingCore: () => native.cleanup }), sender = tracker.attach(1); sender.ready();
    const original = new Uint8Array([...payload(), 0x98, 0x06, 0x01]);
    await native.forward(tracker, sender.capture(), original, async () => { starts++; });
    expect(calls[0].event).toBe('HyperUpdateRowActivity'); expect(calls[0].payload).toEqual(original);
    await native.forward(tracker, sender.capture(), payload({ rowIds: [], closeActivity: true, revision: 2n }), async () => { starts++; });
    expect(starts).toBe(1); expect(fromBinary(HyperUpdateRowActivityPBSchema, calls[1].payload)).toMatchObject({ closeActivity: true, rowIds: [], revision: 2n }); expect(tracker.trackedCount).toBe(0);
  });
  it('keeps accepted-error activations tracked and releases their captured IDs through the existing core', async () => {
    const sent: ReturnType<typeof fromBinary<typeof HyperUpdateRowActivityPBSchema>>[] = [];
    const native = createHyperRowActivityNative({ request: async (_event, bytes) => {
      const request = fromBinary(HyperUpdateRowActivityPBSchema, bytes); sent.push(request);
      return request.closeActivity ? { status: 0, payload: toBinary(HyperRowActivityAckPBSchema, create(HyperRowActivityAckPBSchema, { contextId: request.contextId, activityId: request.activityId, revision: request.revision })) } : { status: 1, payload: new Uint8Array([1, 2, 3]) };
    } });
    const tracker = new HyperRowActivityIpc({ existingCore: () => native.cleanup }), sender = tracker.attach(1); sender.ready();
    expect((await native.forward(tracker, sender.capture(), payload(), async () => {})).status).toBe(1); expect(tracker.trackedCount).toBe(1);
    sender.gone(); for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(sent[1]).toMatchObject({ contextId: 'context', activityId: 'pane', revision: 2n, rowIds: [], closeActivity: true }); expect(tracker.trackedCount).toBe(0);
  });
  it('does not make any native request for terminal disposal after proven exit without an existing core', async () => {
    let calls = 0, starts = 0;
    const native = createHyperRowActivityNative({ request: async () => { calls++; return { status: 2, payload: new Uint8Array() }; } });
    const tracker = new HyperRowActivityIpc({ existingCore: () => null }), sender = tracker.attach(1); sender.ready(); tracker.coreExited();
    const reply = await native.forward(tracker, sender.capture(), payload({ rowIds: [], closeActivity: true, revision: 8n }), async () => { starts++; });
    expect(reply.status).toBe(0); expect(fromBinary(HyperRowActivityAckPBSchema, reply.payload)).toMatchObject({ contextId: 'context', activityId: 'pane', revision: 8n }); expect(calls).toBe(0); expect(starts).toBe(0);
  });
});
