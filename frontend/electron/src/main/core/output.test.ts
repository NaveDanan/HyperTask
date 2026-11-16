import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createCoreOutputWriter } from './output';

describe('core output', () => {
  it('survives a closed output pipe and stops forwarding', () => {
    const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const write = vi.spyOn(output, 'write');
    const forward = createCoreOutputWriter(output);
    forward(Buffer.from('before'));
    expect(write).toHaveBeenCalledTimes(1);
    const brokenPipe = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    expect(() => output.emit('error', brokenPipe)).not.toThrow();
    forward(Buffer.from('after'));
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('does not hide other output errors', () => {
    const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
    createCoreOutputWriter(output);
    const error = Object.assign(new Error('unexpected'), { code: 'EIO' });
    expect(() => output.emit('error', error)).toThrow(error);
  });
});
