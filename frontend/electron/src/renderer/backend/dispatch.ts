import { create, fromBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { ErrorCode } from '@shared/protobuf/hyper-error/code_pb';
import { HyperErrorSchema, type HyperError } from '@shared/protobuf/hyper-error/errors_pb';

export type HyperResult<T> = { ok: true; value: T } | { ok: false; error: HyperError };

export const EMPTY = new Uint8Array();

const STATUS_OK = 0;
const STATUS_ERR = 1;

type ErrorListener = (error: HyperError) => void;
const errorListeners = new Set<ErrorListener>();

/** Counterpart of Dart's GlobalErrorCodeNotifier: observes every HyperError returned by an event. */
export function onHyperError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

export function request(event: string, payload: Uint8Array): Promise<HyperResult<void>>;
export function request<D extends DescMessage>(
  event: string,
  payload: Uint8Array,
  output: D,
): Promise<HyperResult<MessageShape<D>>>;
export async function request(
  event: string,
  payload: Uint8Array,
  output?: DescMessage,
): Promise<HyperResult<unknown>> {
  const reply = await window.hypertask.core.request(event, payload);
  switch (reply.status) {
    case STATUS_OK:
      return { ok: true, value: output ? fromBinary(output, reply.payload) : undefined };
    case STATUS_ERR: {
      const error = fromBinary(HyperErrorSchema, reply.payload);
      errorListeners.forEach((listener) => listener(error));
      return { ok: false, error };
    }
    default: {
      const msg = new TextDecoder().decode(reply.payload);
      console.error(`Dispatch internal error: ${event}: ${msg}`);
      return { ok: false, error: create(HyperErrorSchema, { code: ErrorCode.Internal, msg }) };
    }
  }
}

/** Unwraps a result, throwing the HyperError on failure. */
export function unwrap<T>(result: HyperResult<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}
