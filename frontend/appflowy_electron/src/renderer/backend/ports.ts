// Stream ports: the counterpart of Dart's RawReceivePort. Events such as
// SearchEventStreamSearch, AI chat streaming and FileStorageEventRegisterStream take a
// `stream_port`; the core posts messages to it (see rust-lib/electron-core/src/ports.rs).

type PortListener = (value: unknown) => void;

const listeners = new Map<bigint, PortListener>();
let subscribed = false;
// Port ids only need to be unique for this renderer; start high to stay clear of 0.
let nextPort = 1n << 32n;

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  window.appflowy.core.onPortMessage((port, value) => listeners.get(port)?.(value));
}

export interface ReceivePort {
  /** The id to pass as `stream_port` / `streamPort` in the event payload. */
  readonly port: bigint;
  close(): void;
}

/** Opens a port whose messages go to `onMessage` until it is closed. */
export function openReceivePort(onMessage: PortListener): ReceivePort {
  subscribe();
  const port = nextPort++;
  listeners.set(port, onMessage);
  return { port, close: () => void listeners.delete(port) };
}

/** Normalizes a posted byte payload (typed data or a list of ints) to a Uint8Array. */
export function portBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) return Uint8Array.from(value as number[]);
  return null;
}
