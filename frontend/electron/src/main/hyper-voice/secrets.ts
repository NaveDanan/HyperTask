// Cloud speech keys at rest, protected like the Settings → AI key (src/main/dpapi.ts): a CurrentUser DPAPI blob on
// Windows, Electron safeStorage elsewhere. Plaintext is cached in memory per blob so a recording does not start a
// PowerShell process each time; it is never sent to the renderer.
import { protect, unprotect } from '../dpapi';

const SAFE_STORAGE = 'safe:';
const plaintext = new Map<string, string>();

async function safeStorage() {
  const { safeStorage } = await import('electron');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This system cannot protect saved API keys.');
  return safeStorage;
}

export async function protectVoiceSecret(value: string): Promise<string> {
  if (value === '') return '';
  const stored = process.platform === 'win32'
    ? await protect(value)
    : SAFE_STORAGE + (await safeStorage()).encryptString(value).toString('base64');
  plaintext.set(stored, value);
  return stored;
}

export async function unprotectVoiceSecret(stored: string): Promise<string> {
  if (stored === '') return '';
  const known = plaintext.get(stored);
  if (known !== undefined) return known;
  const value = stored.startsWith(SAFE_STORAGE)
    ? (await safeStorage()).decryptString(Buffer.from(stored.slice(SAFE_STORAGE.length), 'base64'))
    : await unprotect(stored);
  plaintext.set(stored, value);
  return value;
}
