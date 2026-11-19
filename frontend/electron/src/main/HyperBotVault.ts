import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { HyperBotVaultEntry } from '@shared/HyperBots';
import { SettingsError } from './settings-error';

export const HyperBotVaultInput = z.strictObject({
  label: z.string().trim().min(1).max(100),
  username: z.string().trim().max(200),
  password: z.string().min(1).max(4096),
});
const Store = z.array(HyperBotVaultInput.extend({ id: z.uuid() })).max(100);

type Cipher = { seal(text: string): Buffer; open(data: Buffer): string };

export function hyperBotVaultCipher(key: Buffer): Cipher {
  if (key.length !== 32) throw new Error('The Hyper-Bot vault key must decode to 32 bytes.');
  return {
    seal(text) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    open(data) {
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

/** A single encrypted, per-owner vault. Only metadata crosses the renderer API. */
export class HyperBotVault {
  constructor(private readonly file: string, private readonly cipher: () => Cipher) {}

  private read() {
    let encrypted: Buffer;
    try { encrypted = fs.readFileSync(this.file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new SettingsError('state', 'Could not open the password vault.');
    }
    try {
      return Store.parse(JSON.parse(this.cipher().open(encrypted)));
    } catch {
      throw new SettingsError('state', 'The password vault could not be unlocked.');
    }
  }

  private write(rows: z.infer<typeof Store>) {
    const encrypted = this.cipher().seal(JSON.stringify(rows));
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = this.file + '.tmp';
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, encrypted);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, this.file);
  }

  list(): HyperBotVaultEntry[] {
    this.cipher();
    return this.read().map(({ id, label, username }) => ({ id, label, username }));
  }

  add(input: z.infer<typeof HyperBotVaultInput>) {
    const rows = this.read();
    if (rows.length >= 100) throw new SettingsError('state', 'The vault holds up to 100 entries.');
    this.write([...rows, { ...input, id: randomUUID() }]);
  }

  remove(id: string) {
    const rows = this.read();
    const remaining = rows.filter(row => row.id !== id);
    if (remaining.length !== rows.length) this.write(remaining);
  }

  password(id: string): string {
    const row = this.read().find(entry => entry.id === id);
    if (!row) throw new SettingsError('state', 'This password entry is unavailable.');
    return row.password;
  }
}
