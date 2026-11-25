import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { z } from 'zod';
import type { HyperNewsletterConnectionInput, HyperNewsletterConnectionState } from '@shared/HyperBots';
import { hyperBotsHttpRequest } from './HyperBotsHttpTools';
import { SettingsError } from './settings-error';

export const HYPER_NEWSLETTER_SETUP = 'Set up Newsletter in Settings → Connections → Newsletter.';
const InputSchema = z.strictObject({
  baseUrl: z.string().trim().min(1).max(2048),
  token: z.string().trim().regex(/^nlpat_[A-Za-z0-9]{48}$/, 'Enter a Newsletter API access token.'),
});
export const HyperNewsletterConnectionInputSchema = InputSchema.nullable();
const StoredSchema = InputSchema.extend({ gantt: z.boolean() });
type Stored = z.output<typeof StoredSchema>;

export function hyperNewsletterBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new SettingsError('format', 'Enter the Newsletter site URL, including http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new SettingsError('format', 'Enter a Newsletter site URL without credentials, a query, or a fragment.');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export class HyperNewsletterConnection {
  private readonly writes = new Map<string, Promise<HyperNewsletterConnectionState | null>>();
  constructor(private readonly directory: string, private readonly fetcher: typeof fetch) {}

  private file(userKey: string) {
    return path.join(this.directory, userKey + '.bin');
  }

  private async read(userKey: string): Promise<Stored | null> {
    try {
      const blob = await fs.readFile(this.file(userKey));
      return StoredSchema.parse(JSON.parse(safeStorage.decryptString(blob)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new SettingsError('state', 'The saved Newsletter connection could not be opened. Enter the URL and token again.');
    }
  }

  async status(userKey: string): Promise<HyperNewsletterConnectionState | null> {
    const saved = await this.read(userKey);
    return saved && { baseUrl: saved.baseUrl, gantt: saved.gantt };
  }

  async access(userKey: string) {
    const saved = await this.read(userKey);
    if (!saved) throw new SettingsError('state', HYPER_NEWSLETTER_SETUP);
    return {
      baseUrl: saved.baseUrl,
      authorization: 'Bearer ' + saved.token,
      fingerprint: createHash('sha256').update(JSON.stringify([userKey, saved.baseUrl, saved.token])).digest('hex'),
    };
  }

  save(userKey: string, input: HyperNewsletterConnectionInput | null): Promise<HyperNewsletterConnectionState | null> {
    const previous = this.writes.get(userKey) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this.write(userKey, input));
    this.writes.set(userKey, pending);
    return pending.finally(() => { if (this.writes.get(userKey) === pending) this.writes.delete(userKey); });
  }

  private async write(userKey: string, input: HyperNewsletterConnectionInput | null): Promise<HyperNewsletterConnectionState | null> {
    const file = this.file(userKey);
    if (input === null) {
      await fs.rm(file, { force: true });
      return null;
    }
    const { token } = InputSchema.parse(input);
    const baseUrl = hyperNewsletterBaseUrl(input.baseUrl);
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new SettingsError('state', 'Secure storage is unavailable for Newsletter API tokens.');
    }
    let response: unknown;
    try {
      response = await hyperBotsHttpRequest('Newsletter', { baseUrl, authorization: 'Bearer ' + token },
        { path: '/api/v1/authoring/status' }, new AbortController().signal, this.fetcher, 10_000);
    } catch (error) {
      throw new SettingsError('state', `${error instanceof Error ? error.message : 'Newsletter did not respond.'} Check the site URL and use a Newsletter & Gantt authoring token.`);
    }
    const status = z.object({ gantt: z.boolean() }).safeParse(response);
    if (!status.success) throw new SettingsError('state', 'The URL did not return a Newsletter authoring connection.');
    const state = { baseUrl, gantt: status.data.gantt };
    const temp = file + '.' + randomUUID() + '.tmp';
    const encrypted = safeStorage.encryptString(JSON.stringify({ ...state, token }));
    await fs.mkdir(this.directory, { recursive: true });
    try {
      await fs.writeFile(temp, encrypted, { mode: 0o600 });
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return state;
  }
}
