// Frame codec for the connection to the Rust core process. Mirrors
// rust-lib/electron-core/src/protocol.rs: `[u32 LE body length][u8 kind][body]`.

export const Kind = {
  Init: 1,
  Request: 2,
  Log: 3,
  Shutdown: 4,
  Hello: 0x80,
  InitDone: 0x81,
  Response: 0x82,
  Notification: 0x83,
  PortMessage: 0x84,
} as const;

export const Status = { Ok: 0, Err: 1, Internal: 2 } as const;

export interface Frame {
  kind: number;
  body: Buffer;
}

export function encodeFrame(kind: number, ...parts: Uint8Array[]): Buffer {
  const bodyLength = 1 + parts.reduce((sum, part) => sum + part.length, 0);
  const header = Buffer.alloc(5);
  header.writeUInt32LE(bodyLength, 0);
  header.writeUInt8(kind, 4);
  return Buffer.concat([header, ...parts]);
}

export function encodeRequest(id: bigint, event: string, payload: Uint8Array): Buffer {
  const name = Buffer.from(event, 'utf8');
  const head = Buffer.alloc(12);
  head.writeBigUInt64LE(id, 0);
  head.writeUInt32LE(name.length, 8);
  return encodeFrame(Kind.Request, head, name, payload);
}

export interface CoreResponse {
  id: bigint;
  status: number;
  payload: Uint8Array;
}

export function decodeResponse(body: Buffer): CoreResponse {
  return {
    id: body.readBigUInt64LE(0),
    status: body.readUInt8(8),
    payload: new Uint8Array(body.subarray(9)),
  };
}

/** Stream element types retained for compatibility with the core wire format. */
const TYPED_ARRAYS: Record<number, { new (buffer: ArrayBuffer): ArrayBufferView }> = {
  0: Uint8Array, // ByteData
  1: Int8Array,
  2: Uint8Array,
  3: Uint8ClampedArray,
  4: Int16Array,
  5: Uint16Array,
  6: Int32Array,
  7: Uint32Array,
  8: BigInt64Array,
  9: BigUint64Array,
  10: Float32Array,
  11: Float64Array,
};

/**
 * Decodes a value posted to a stream port (rust-lib/electron-core/src/ports.rs) into what
 * the corresponding JavaScript value: null, boolean, number/bigint, string, typed array or array.
 */
export function decodePortValue(buffer: Buffer, offset = 0): { value: unknown; next: number } {
  const tag = buffer.readUInt8(offset);
  let pos = offset + 1;
  switch (tag) {
    case 1:
      return { value: buffer.readUInt8(pos) !== 0, next: pos + 1 };
    case 2: {
      const n = buffer.readBigInt64LE(pos);
      const value = n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n;
      return { value, next: pos + 8 };
    }
    case 3:
      return { value: buffer.readDoubleLE(pos), next: pos + 8 };
    case 4: {
      const length = buffer.readUInt32LE(pos);
      pos += 4;
      return { value: buffer.toString('utf8', pos, pos + length), next: pos + length };
    }
    case 5: {
      const type = buffer.readUInt8(pos);
      const length = buffer.readUInt32LE(pos + 1);
      pos += 5;
      const copy = new Uint8Array(length);
      copy.set(buffer.subarray(pos, pos + length));
      const View = TYPED_ARRAYS[type] ?? Uint8Array;
      return { value: View === Uint8Array ? copy : new View(copy.buffer), next: pos + length };
    }
    case 6: {
      const count = buffer.readUInt32LE(pos);
      pos += 4;
      const items: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const item = decodePortValue(buffer, pos);
        items.push(item.value);
        pos = item.next;
      }
      return { value: items, next: pos };
    }
    default:
      return { value: null, next: pos };
  }
}

export function decodePortMessage(body: Buffer): { port: bigint; value: unknown } {
  return { port: body.readBigInt64LE(0), value: decodePortValue(body, 8).value };
}

/** Accumulates socket chunks and yields complete frames. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0) throw new Error('Invalid empty frame from AppFlowy core');
      if (this.buffer.length < 4 + length) break;
      frames.push({ kind: this.buffer.readUInt8(4), body: this.buffer.subarray(5, 4 + length) });
      this.buffer = this.buffer.subarray(4 + length);
    }
    return frames;
  }
}
