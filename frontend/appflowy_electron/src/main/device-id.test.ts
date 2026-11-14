import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { readDeviceId } from './device-id';

vi.mock('node:fs/promises', () => ({ default: { readFile: vi.fn() } }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.resetAllMocks(); });

describe('Linux device identity used by core initialization and sign-in', () => {
  it('returns the same nonempty machine ID on repeated launches', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.mocked(fs.readFile).mockResolvedValue('0123456789abcdef0123456789abcdef\n');
    expect(await readDeviceId()).toBe('0123456789abcdef0123456789abcdef');
    expect(await readDeviceId()).toBe('0123456789abcdef0123456789abcdef');
  });

  it('reads the DBus location when the primary machine ID is unavailable', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce('abcdef0123456789abcdef0123456789\n');
    expect(await readDeviceId()).toBe('abcdef0123456789abcdef0123456789');
    expect(vi.mocked(fs.readFile).mock.calls.map(call => call[0])).toEqual(['/etc/machine-id', '/var/lib/dbus/machine-id']);
  });

  it('refuses empty or malformed identity instead of starting an unusable core', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.mocked(fs.readFile).mockResolvedValueOnce('\n').mockResolvedValueOnce('invalid');
    await expect(readDeviceId()).rejects.toThrow('Linux machine ID');
  });
});
