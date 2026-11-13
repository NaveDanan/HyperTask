import { describe, expect, it } from 'vitest';
import { newerRelease, parseVersion, releaseInstaller } from './updates';

const win32: NodeJS.Platform = 'win32';
const linux: NodeJS.Platform = 'linux';

const release = (tag: string, assets: Array<{ name: string; size: number; digest?: string; state?: string }> = [], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  assets,
  ...extra,
});

describe('parseVersion', () => {
  it('accepts strict semver with optional v and prerelease', () => {
    expect(parseVersion('0.11.4')).toEqual({ parts: [0n, 11n, 4n], prerelease: false });
    expect(parseVersion('v1.2.3')).toEqual({ parts: [1n, 2n, 3n], prerelease: false });
    expect(parseVersion('1.2.3-beta.1')).toEqual({ parts: [1n, 2n, 3n], prerelease: true });
    expect(parseVersion('2024.1')).toBeNull();
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe('newerRelease', () => {
  it('picks a strictly newer stable release', () => {
    const found = newerRelease(release('v0.12.0', [], { body: 'Fixes' }), '0.11.4', win32);
    expect(found).toMatchObject({ version: '0.12.0', notes: 'Fixes' });
    expect(found?.url).toContain('/releases/tag/v0.12.0');
  });
  it('ignores equal and older versions', () => {
    expect(newerRelease(release('0.11.4'), '0.11.4', win32)).toBeNull();
    expect(newerRelease(release('0.11.3'), '0.11.4', win32)).toBeNull();
  });
  it('skips drafts, prereleases and unparseable tags', () => {
    expect(newerRelease(release('0.12.0', [], { draft: true }), '0.11.4', win32)).toBeNull();
    expect(newerRelease(release('0.12.0', [], { prerelease: true }), '0.11.4', win32)).toBeNull();
    expect(newerRelease(release('nightly-42'), '0.11.4', win32)).toBeNull();
  });
  it('accepts a stable upgrade while running a prerelease', () => {
    expect(newerRelease(release('0.12.0'), '0.12.0-rc.1', win32)).toMatchObject({ version: '0.12.0' });
  });
});

describe('releaseInstaller', () => {
  it('matches the platform installer asset with a sha256 digest', () => {
    const found = releaseInstaller(
      release('v0.12.0', [{ name: 'HyperTask-Setup-0.12.0.exe', size: 99, digest: 'sha256:ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789', state: 'uploaded' }]),
      win32,
    );
    expect(found).toEqual({
      name: 'HyperTask-Setup-0.12.0.exe',
      size: 99,
      sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      url: 'https://github.com/NaveDanan/HyperTask/releases/download/v0.12.0/HyperTask-Setup-0.12.0.exe',
    });
    expect(releaseInstaller(
      release('v0.12.0', [{ name: 'HyperTask-0.12.0.AppImage', size: 99, digest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', state: 'uploaded' }]),
      linux,
    )?.name).toBe('HyperTask-0.12.0.AppImage');
  });
  it('demands an uploaded asset with a valid digest', () => {
    const good = { name: 'HyperTask-Setup-0.12.0.exe', size: 99, digest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' };
    expect(releaseInstaller(release('v0.12.0', [{ ...good, state: 'starter' }]), win32)).toBeNull();
    expect(releaseInstaller(release('v0.12.0', [{ ...good, state: 'uploaded', digest: 'sha256:abc' }]), win32)).toBeNull();
    expect(releaseInstaller(release('v0.12.0', [{ ...good, state: 'uploaded', size: 0 }]), win32)).toBeNull();
    expect(releaseInstaller(release('v0.12.0', [{ ...good, state: 'uploaded' }]), 'darwin' as NodeJS.Platform)).toBeNull();
  });
});
