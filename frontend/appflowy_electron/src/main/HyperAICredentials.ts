import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { protect, unprotect } from './dpapi';
import { SettingsError } from './settings-error';

export const HYPER_AI_KEY_ENV = 'HYPERTASK_AI_CREDENTIAL_KEY';
export const HYPER_AI_CREDENTIAL_PREFIX = 'hypertask-safe-v1:';
const aad = Buffer.from(HYPER_AI_CREDENTIAL_PREFIX, 'utf8');
interface HyperSafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export interface HyperAICredentialOptions {
  supportDirectory(): string;
  platform: NodeJS.Platform;
  safeStorage: HyperSafeStorage;
}
const unavailable = () => new SettingsError('state', 'Secure credential storage is unavailable or locked. Unlock your operating system keyring and restart HyperTask before saving an API key.');
const damaged = () => new SettingsError('state', 'The saved AI credential could not be unlocked. Its stored key has not been replaced.');
function decodeBase64(value: string): Buffer {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw damaged();
  return Buffer.from(value, 'base64');
}

/** The only persisted master-key bytes are wrapped by the operating system keyring.
 * One instance is shared by IPC and the core spawn callback. It never mutates process.env.
 */
export class HyperAICredentials {
  private master: Buffer | undefined;
  private prepared = false;
  private persisted = false;
  private failure: SettingsError | undefined;
  private readonly file: string;
  constructor(private readonly options: HyperAICredentialOptions) {
    this.file = path.join(options.supportDirectory(), 'local_ai', 'credential-key.bin');
  }
  private requireSecureStorage() {
    const storage = this.options.safeStorage;
    if (!storage.isEncryptionAvailable()) throw unavailable();
    if (this.options.platform === 'linux' && !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(storage.getSelectedStorageBackend())) throw unavailable();
  }
  private prepare() {
    if (this.prepared) { if (this.failure) throw this.failure; return; }
    this.prepared = true;
    try {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(this.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.master = randomBytes(32); return; }
        throw error;
      }
      if (!stat.isFile() || stat.size > 64 * 1024) throw damaged();
      this.requireSecureStorage();
      const wrapped = fs.readFileSync(this.file);
      try {
        this.master = decodeBase64(this.options.safeStorage.decryptString(wrapped));
        if (this.master.length !== 32) { this.master.fill(0); this.master = undefined; throw damaged(); }
        fs.chmodSync(this.file, 0o600);
        this.persisted = true;
      } finally { wrapped.fill(0); }
    } catch (error) {
      this.master?.fill(0); this.master = undefined;
      this.failure = error instanceof SettingsError ? error : damaged();
      throw this.failure;
    }
  }
  /** Loading a locked stored key must not stop local-only startup. */
  coreEnvironment(): NodeJS.ProcessEnv {
    if (this.options.platform === 'win32') return { [HYPER_AI_KEY_ENV]: undefined };
    try { this.prepare(); return { [HYPER_AI_KEY_ENV]: this.master!.toString('base64') }; }
    catch { return { [HYPER_AI_KEY_ENV]: undefined }; }
  }
  private persistMaster() {
    if (this.persisted) return;
    this.requireSecureStorage();
    const directory = path.dirname(this.file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.credential-key-${randomBytes(12).toString('hex')}.tmp`);
    let wrapped: Buffer;
    try { wrapped = this.options.safeStorage.encryptString(this.master!.toString('base64')); }
    catch { throw unavailable(); }
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, wrapped); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      // Publishing a complete file with a hard link is atomic and refuses to replace a
      // master another process created after startup. Never rotate implicitly.
      fs.linkSync(temporary, this.file);
      this.persisted = true;
    } catch { throw new SettingsError('state', 'Could not save the protected AI credential key. Existing key files have not been replaced. Restart HyperTask and retry.'); }
    finally { wrapped.fill(0); try { fs.unlinkSync(temporary); } catch { /* No temporary file was created. */ } }
  }
  async protect(value: string): Promise<string> {
    if (!value) return '';
    if (this.options.platform === 'win32') return protect(value);
    this.prepare(); this.requireSecureStorage(); this.persistMaster();
    const plain = Buffer.from(value, 'utf8'), nonce = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm', this.master!, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      return HYPER_AI_CREDENTIAL_PREFIX + Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString('base64');
    } finally { plain.fill(0); }
  }
  async unprotect(value: string): Promise<string> {
    if (!value) return '';
    if (!value.startsWith(HYPER_AI_CREDENTIAL_PREFIX)) return unprotect(value);
    this.prepare(); this.requireSecureStorage();
    let encrypted: Buffer | undefined, plain: Buffer | undefined;
    try {
      encrypted = decodeBase64(value.slice(HYPER_AI_CREDENTIAL_PREFIX.length));
      if (encrypted.length < 28) throw damaged();
      const cipher = createDecipheriv('aes-256-gcm', this.master!, encrypted.subarray(0, 12));
      cipher.setAAD(aad); cipher.setAuthTag(encrypted.subarray(-16));
      plain = Buffer.concat([cipher.update(encrypted.subarray(12, -16)), cipher.final()]);
      return new TextDecoder('utf-8', { fatal: true }).decode(plain);
    } catch { throw damaged(); }
    finally { encrypted?.fill(0); plain?.fill(0); }
  }
}
