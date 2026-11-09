import { describe, expect, it } from 'vitest';
import { FrameReader, Kind, decodePortMessage, decodeResponse, encodeFrame, encodeRequest } from './protocol';

describe('core protocol', () => {
  it('encodes a request as length, kind, id, name length, name, payload', () => {
    const frame = encodeRequest(7n, 'CreateView', new Uint8Array([1, 2, 3]));
    expect(frame.readUInt32LE(0)).toBe(1 + 8 + 4 + 10 + 3);
    expect(frame.readUInt8(4)).toBe(Kind.Request);
    expect(frame.readBigUInt64LE(5)).toBe(7n);
    expect(frame.readUInt32LE(13)).toBe(10);
    expect(frame.subarray(17, 27).toString('utf8')).toBe('CreateView');
    expect([...frame.subarray(27)]).toEqual([1, 2, 3]);
  });

  it('reassembles frames split and merged across chunks', () => {
    const response = encodeFrame(
      Kind.Response,
      Buffer.from([5, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from([1]),
      Buffer.from('err'),
    );
    const notification = encodeFrame(Kind.Notification, Buffer.from([9, 9]));
    const stream = Buffer.concat([response, notification]);

    const reader = new FrameReader();
    expect(reader.push(stream.subarray(0, 3))).toEqual([]);
    const frames = [...reader.push(stream.subarray(3, 20)), ...reader.push(stream.subarray(20))];

    expect(frames.map((f) => f.kind)).toEqual([Kind.Response, Kind.Notification]);
    const decoded = decodeResponse(frames[0].body);
    expect(decoded.id).toBe(5n);
    expect(decoded.status).toBe(1);
    expect(Buffer.from(decoded.payload).toString()).toBe('err');
    expect([...frames[1].body]).toEqual([9, 9]);
  });

  it('rejects an empty frame', () => {
    expect(() => new FrameReader().push(Buffer.from([0, 0, 0, 0]))).toThrow();
  });

  it('decodes stream port messages like Dart would receive them', () => {
    const port = Buffer.alloc(8);
    port.writeBigInt64LE(42n);
    const text = Buffer.from('héllo');
    const string = Buffer.concat([Buffer.from([4]), Buffer.from(Uint32Array.of(text.length).buffer), text]);
    const bytes = Buffer.from([5, 2, 3, 0, 0, 0, 7, 8, 9]);
    const int = Buffer.alloc(9);
    int.writeUInt8(2);
    int.writeBigInt64LE(-5n, 1);
    const array = Buffer.concat([Buffer.from([6, 3, 0, 0, 0]), string, bytes, int]);

    const decoded = decodePortMessage(Buffer.concat([port, array]));
    expect(decoded.port).toBe(42n);
    expect(decoded.value).toEqual(['héllo', new Uint8Array([7, 8, 9]), -5]);
  });
});
