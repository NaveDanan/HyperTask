import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { JiraCredentials } from '@shared/api';
import { protect, unprotect } from './dpapi';

// RFC 4122 URL namespace, as Uuid().v5(Namespace.url.value, accountId) in the Dart build.
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/** RFC 4122 version 5 (SHA-1, name-based) UUID. */
export function uuidV5(name: string, namespace = URL_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * WindowsJiraCredentialStore (lib/features/local_tools/jira_windows_credentials.dart):
 * `<support>/jira_credentials/<uuid v5>.json` = { username, protected_secret }, the secret
 * protected with the current user's DPAPI key. Off Windows: in memory for the session
 * (SessionJiraCredentialStore).
 */
export class JiraCredentialFiles {
  readonly isPersistent = process.platform === 'win32';
  private readonly session = new Map<string, JiraCredentials>();

  constructor(private readonly supportDirectory: () => string) {}

  private file(accountId: string): string {
    return path.join(this.supportDirectory(), 'jira_credentials', `${uuidV5(accountId)}.json`);
  }

  async read(accountId: string): Promise<JiraCredentials | null> {
    if (!this.isPersistent) return this.session.get(accountId) ?? null;
    let data: { username?: string; protected_secret: string };
    try {
      data = JSON.parse(await fs.readFile(this.file(accountId), 'utf8'));
    } catch {
      return null;
    }
    try {
      return { secret: await unprotect(data.protected_secret), username: data.username ?? '' };
    } catch {
      // Damaged or foreign-account credentials require re-entry.
      return null;
    }
  }

  async write(accountId: string, credentials: JiraCredentials): Promise<void> {
    if (!this.isPersistent) {
      this.session.set(accountId, credentials);
      return;
    }
    const file = this.file(accountId);
    const temporary = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const body = JSON.stringify({ username: credentials.username, protected_secret: await protect(credentials.secret) });
    const handle = await fs.open(temporary, 'w');
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  }

  async delete(accountId: string): Promise<void> {
    if (!this.isPersistent) {
      this.session.delete(accountId);
      return;
    }
    await fs.rm(this.file(accountId), { force: true });
  }
}
