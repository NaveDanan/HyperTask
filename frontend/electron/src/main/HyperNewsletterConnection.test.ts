import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'test',
    encryptString: (text: string) => Buffer.from([...Buffer.from(text)].map(byte => byte ^ 0xff)),
    decryptString: (data: Buffer) => Buffer.from([...data].map(byte => byte ^ 0xff)).toString('utf8'),
  },
}));
import { HyperNewsletterConnection } from './HyperNewsletterConnection';

const token = 'nlpat_' + 'x'.repeat(48);
const input = { baseUrl: 'https://newsletter.example/', token };
let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-newsletter-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it('validates the token at the configured site and saves it only for the owning account', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ gantt: true }));
  const store = new HyperNewsletterConnection(directory, fetch);
  const state = await store.save('alice', input);
  expect(state).toEqual({ baseUrl: 'https://newsletter.example', gantt: true });
  expect(fetch).toHaveBeenCalledWith('https://newsletter.example/api/v1/authoring/status', expect.objectContaining({
    method: 'GET', redirect: 'manual', credentials: 'omit', headers: { accept: 'application/json', authorization: 'Bearer ' + token },
  }));
  const file = (await fs.readdir(directory))[0]!;
  expect((await fs.readFile(path.join(directory, file))).includes(Buffer.from(token))).toBe(false);
  const reopened = new HyperNewsletterConnection(directory, fetch);
  expect(await reopened.status('alice')).toEqual(state);
  expect(await reopened.status('bob')).toBeNull();
  expect(await reopened.access('alice')).toMatchObject({ authorization: 'Bearer ' + token });
  await reopened.save('alice', null);
  await expect(store.access('alice')).rejects.toThrow('Set up Newsletter');
});

it('preserves a working connection when validation of a replacement fails', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ gantt: false }))
    .mockResolvedValueOnce(Response.json({ message: 'Rejected ' + token }, { status: 401 }));
  const store = new HyperNewsletterConnection(directory, fetch);
  const original = await store.save('alice', input);
  await expect(store.save('alice', { ...input, baseUrl: 'https://next.example' })).rejects.toThrow('Rejected [redacted]');
  expect(await store.status('alice')).toEqual(original);
  await expect(store.save('alice', { ...input, baseUrl: 'https://name:password@next.example/' })).rejects.toThrow('without credentials');
  expect(fetch).toHaveBeenCalledTimes(2);
});
