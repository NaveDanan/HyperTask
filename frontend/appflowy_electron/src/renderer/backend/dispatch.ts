import { create, fromBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { FlowyErrorSchema, type FlowyError } from '@shared/protobuf/flowy-error/errors_pb';

export type FlowyResult<T> = { ok: true; value: T } | { ok: false; error: FlowyError };

export const EMPTY = new Uint8Array();

const STATUS_OK = 0;
const STATUS_ERR = 1;

type ErrorListener = (error: FlowyError) => void;
const errorListeners = new Set<ErrorListener>();

/** Counterpart of Dart's GlobalErrorCodeNotifier: observes every FlowyError returned by an event. */
export function onFlowyError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

export function request(event: string, payload: Uint8Array): Promise<FlowyResult<void>>;
export function request<D extends DescMessage>(
  event: string,
  payload: Uint8Array,
  output: D,
): Promise<FlowyResult<MessageShape<D>>>;
export async function request(
  event: string,
  payload: Uint8Array,
  output?: DescMessage,
): Promise<FlowyResult<unknown>> {
  const reply = await window.appflowy.core.request(event, payload);
  switch (reply.status) {
    case STATUS_OK:
      return { ok: true, value: output ? fromBinary(output, reply.payload) : undefined };
    case STATUS_ERR: {
      const error = fromBinary(FlowyErrorSchema, reply.payload);
      errorListeners.forEach((listener) => listener(error));
      return { ok: false, error };
    }
    default: {
      const msg = new TextDecoder().decode(reply.payload);
      console.error(`Dispatch internal error: ${event}: ${msg}`);
      return { ok: false, error: create(FlowyErrorSchema, { code: ErrorCode.Internal, msg }) };
    }
  }
}

/** Unwraps a result, throwing the FlowyError on failure. */
export function unwrap<T>(result: FlowyResult<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}
