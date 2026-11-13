import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { HyperRowActivityAckPBSchema, HyperUpdateRowActivityPBSchema } from '../shared/protobuf/flowy-database2/database_entities_pb';
import { FlowyErrorSchema } from '../shared/protobuf/flowy-error/errors_pb';
import { ErrorCode } from '../shared/protobuf/flowy-error/code_pb';
import type { CoreProcess, CoreReply } from './core/process';
import { HyperRowActivityIpcError, type HyperRowActivityAck, type HyperRowActivityDocument, type HyperRowActivityIpc, type HyperRowActivityRequest } from './HyperRowActivityIpc';

const event = 'HyperUpdateRowActivity';
const encode = (request: HyperRowActivityRequest) => toBinary(HyperUpdateRowActivityPBSchema, create(HyperUpdateRowActivityPBSchema, {
  viewId: request.viewId, contextId: request.contextId, activityId: request.activityId,
  revision: request.revision, rowIds: request.rowIds, closeActivity: request.closeActivity,
}));
export function hyperRowActivityErrorReply(error: unknown): CoreReply {
  const msg = error instanceof HyperRowActivityIpcError ? error.message : 'Live row updates are unavailable in this renderer. Reopen the view.';
  return { status: 1, payload: toBinary(FlowyErrorSchema, create(FlowyErrorSchema, { code: ErrorCode.InvalidParams, msg })) };
}

/** Typed native adapter. Cleanup only calls request() on the existing core; its
 * terminal forwarding never invokes the supplied startup function. */
export function createHyperRowActivityNative(core: Pick<CoreProcess, 'request'>) {
  const exchange = async (payload: Uint8Array) => {
    const value = await core.request(event, payload);
    const ack: HyperRowActivityAck | undefined = value.status === 0 ? fromBinary(HyperRowActivityAckPBSchema, value.payload) : undefined;
    return { value, ack };
  };
  return {
    cleanup: async (request: HyperRowActivityRequest) => (await exchange(encode(request))).ack,
    async forward(tracker: HyperRowActivityIpc, document: HyperRowActivityDocument, payload: Uint8Array, start: () => Promise<void>): Promise<CoreReply> {
      if (!(payload instanceof Uint8Array) || payload.length > 128 * 1024) throw new HyperRowActivityIpcError('invalid');
      const request = fromBinary(HyperUpdateRowActivityPBSchema, payload);
      const retired = tracker.terminalAckWithoutCore(document, request);
      if (retired) return { status: 0, payload: toBinary(HyperRowActivityAckPBSchema, create(HyperRowActivityAckPBSchema, retired)) };
      // Preserve the submitted protobuf bytes when forwarding. Only a captured
      // cleanup constructs a new terminal payload.
      return tracker.forward(document, request, start, () => exchange(payload));
    },
  };
}
