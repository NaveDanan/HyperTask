import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperAICredentials, HYPER_AI_CREDENTIAL_PREFIX, HYPER_AI_KEY_ENV } from './HyperAICredentials';
import { protect as legacyProtect, unprotect as legacyUnprotect } from './dpapi';
vi.mock('./dpapi', () => ({ protect: vi.fn(async () => 'legacy-dpapi-blob'), unprotect: vi.fn(async () => 'legacy-secret') }));

const folders: string[] = [];
afterEach(() => folders.splice(0).forEach(folder => fs.rmSync(folder, { recursive: true, force: true })));
function fixture() {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-ai-credentials-')); folders.push(support);
  const wrappingKey = randomBytes(32);
  const storage = {
    isEncryptionAvailable: vi.fn(() => true), getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptString: vi.fn((value: string) => {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce);
      return Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    }),
    decryptString: vi.fn((encrypted: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', wrappingKey, encrypted.subarray(0, 12)); cipher.setAuthTag(encrypted.subarray(-16));
      return Buffer.concat([cipher.update(encrypted.subarray(12, -16)), cipher.final()]).toString('utf8');
    }),
  };
  const make = () => new HyperAICredentials({ supportDirectory: () => support, platform: 'linux', safeStorage: storage });
  return { support, storage, make, manager: make(), file: path.join(support, 'local_ai/credential-key.bin') };
}
describe('Hyper AI credential envelopes', () => {
  it('creates a stable child-only startup key without writing or invoking secure storage', () => {
    const { manager, storage, file } = fixture(), previous = process.env[HYPER_AI_KEY_ENV];
    const first = manager.coreEnvironment();
    expect(Buffer.from(first[HYPER_AI_KEY_ENV]!, 'base64')).toHaveLength(32);
    expect(manager.coreEnvironment()).toEqual(first); expect(process.env[HYPER_AI_KEY_ENV] === previous).toBe(true);
    expect(storage.encryptString).not.toHaveBeenCalled(); expect(storage.isEncryptionAvailable).not.toHaveBeenCalled(); expect(fs.existsSync(file)).toBe(false);
  });
  it('saves only an OS-wrapped master and authenticated encrypted API key, with private permissions', async () => {
    const { manager, make, file } = fixture();
    const environment = manager.coreEnvironment(), secret = 'test-key-שלום';
    const encrypted = await manager.protect(secret), another = await manager.protect(secret);
    expect(encrypted.startsWith(HYPER_AI_CREDENTIAL_PREFIX)).toBe(true); expect(another).not.toBe(encrypted);
    expect(await manager.unprotect(encrypted)).toBe(secret);
    const disk = fs.readFileSync(file);
    expect(disk.includes(Buffer.from(secret))).toBe(false); expect(disk.includes(Buffer.from(environment[HYPER_AI_KEY_ENV]!))).toBe(false);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const restarted = make(); expect(restarted.coreEnvironment()).toEqual(environment); expect(await restarted.unprotect(encrypted)).toBe(secret);
  });
  it('rejects insecure basic_text and unknown Linux backends', async () => {
    for (const backend of ['basic_text', 'unknown']) {
      const { manager, storage, file } = fixture(); storage.getSelectedStorageBackend.mockReturnValue(backend);
      await expect(manager.protect('secret')).rejects.toThrow('keyring'); expect(fs.existsSync(file)).toBe(false);
      expect(storage.encryptString).not.toHaveBeenCalled();
    }
  });
  it('allows local startup with a locked existing master without overwriting or rotating it', async () => {
    const { manager, make, storage, file } = fixture(); await manager.protect('original');
    const saved = fs.readFileSync(file); storage.isEncryptionAvailable.mockReturnValue(false);
    const locked = make(); expect(locked.coreEnvironment()[HYPER_AI_KEY_ENV]).toBeUndefined();
    await expect(locked.protect('replacement')).rejects.toThrow('keyring'); expect(fs.readFileSync(file)).toEqual(saved);
    storage.isEncryptionAvailable.mockReturnValue(true);
    await expect(locked.protect('replacement')).rejects.toThrow('keyring');
    expect(make().coreEnvironment()[HYPER_AI_KEY_ENV]).toBeDefined();
  });
  it('refuses damaged master files and does not overwrite them', async () => {
    const { make, file } = fixture(); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, 'damaged');
    const manager = make(); expect(manager.coreEnvironment()[HYPER_AI_KEY_ENV]).toBeUndefined();
    await expect(manager.protect('replacement')).rejects.toThrow('not been replaced'); expect(fs.readFileSync(file, 'utf8')).toBe('damaged');
  });
  it('authenticates ciphertext and rejects malformed envelopes without exposing plaintext', async () => {
    const { manager } = fixture(), encrypted = await manager.protect('private-test-value');
    const bytes = Buffer.from(encrypted.slice(HYPER_AI_CREDENTIAL_PREFIX.length), 'base64'); bytes[13] ^= 1;
    await expect(manager.unprotect(HYPER_AI_CREDENTIAL_PREFIX + bytes.toString('base64'))).rejects.toThrow('could not be unlocked');
    await expect(manager.unprotect(HYPER_AI_CREDENTIAL_PREFIX + 'broken')).rejects.toThrow('could not be unlocked');
  });
  it('does not replace another manager’s saved master after a first-save race', async () => {
    const { manager, make, file } = fixture(), second = make(); manager.coreEnvironment(); second.coreEnvironment();
    const encrypted = await manager.protect('first'); const original = fs.readFileSync(file);
    await expect(second.protect('second')).rejects.toThrow('not been replaced');
    expect(fs.readFileSync(file)).toEqual(original); expect(await make().unprotect(encrypted)).toBe('first');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['credential-key.bin']);
  });
  it('keeps empty keys empty without accessing disk or keyring', async () => {
    const { manager, file, storage } = fixture(); expect(await manager.protect('')).toBe(''); expect(await manager.unprotect('')).toBe('');
    expect(fs.existsSync(file)).toBe(false); expect(storage.encryptString).not.toHaveBeenCalled();
  });
  it('preserves Windows DPAPI protection and legacy decryption', async () => {
    const { support, storage, file } = fixture();
    const manager = new HyperAICredentials({ supportDirectory: () => support, platform: 'win32', safeStorage: storage });
    expect(await manager.protect('windows-key')).toBe('legacy-dpapi-blob'); expect(legacyProtect).toHaveBeenCalledWith('windows-key');
    expect(await manager.unprotect('legacy-dpapi-blob')).toBe('legacy-secret'); expect(legacyUnprotect).toHaveBeenCalledWith('legacy-dpapi-blob');
    expect(manager.coreEnvironment()[HYPER_AI_KEY_ENV]).toBeUndefined(); expect(fs.existsSync(file)).toBe(false); expect(storage.encryptString).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform === 'win32')('refuses symlinked master files without reading or replacing their targets', async () => {
    const { support, make, file, storage } = fixture();
    const target = path.join(support, 'other-file'); fs.writeFileSync(target, 'leave intact'); fs.mkdirSync(path.dirname(file)); fs.symlinkSync(target, file);
    const manager = make(); expect(manager.coreEnvironment()[HYPER_AI_KEY_ENV]).toBeUndefined();
    await expect(manager.protect('secret')).rejects.toThrow('not been replaced');
    expect(fs.readFileSync(target, 'utf8')).toBe('leave intact'); expect(storage.decryptString).not.toHaveBeenCalled();
  });
});
