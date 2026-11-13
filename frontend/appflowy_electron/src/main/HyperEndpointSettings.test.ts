import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeEndpointSettings } from './openai-endpoint';

vi.mock('electron', () => ({ net: { request: vi.fn() } }));
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const support = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-endpoint-settings-')); directories.push(support);
  const directory = path.join(support, 'local_ai'), file = path.join(directory, 'openai-endpoint.json');
  await fs.mkdir(directory); const previous = '{"model":"previous-default","protected_key":"protected-fixture"}\n'; await fs.writeFile(file, previous);
  return { support, directory, file, previous };
}
describe('atomic AI endpoint settings save', () => {
  it('replaces the previous default/model settings exactly at the existing compatible path', async () => {
    const f = await fixture();
    const json = '{"base_url":"http://localhost:8000/v1","model":"new-default","protected_key":"protected-fixture","enabled":true}\n';
    expect(await writeEndpointSettings(f.support, json)).toBe(f.file);
    expect(await fs.readFile(f.file, 'utf8')).toBe(json);
    expect(await fs.readdir(f.directory)).toEqual(['openai-endpoint.json']);
    if (process.platform !== 'win32') expect((await fs.stat(f.file)).mode & 0o777).toBe(0o600);
  });
  it('retains the previous complete file when writing the temporary file fails and cleans up', async () => {
    const f = await fixture(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args); vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('fixture disk full')); return handle;
    });
    await expect(writeEndpointSettings(f.support, '{"model":"new-default"}')).rejects.toThrow('fixture disk full');
    expect(await fs.readFile(f.file, 'utf8')).toBe(f.previous); expect(await fs.readdir(f.directory)).toEqual(['openai-endpoint.json']);
  });
  it('retains the previous file when flushing fails and removes the partial temporary file', async () => {
    const f = await fixture(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args); vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('fixture flush failed')); return handle;
    });
    await expect(writeEndpointSettings(f.support, '{"model":"new-default"}')).rejects.toThrow('fixture flush failed');
    expect(await fs.readFile(f.file, 'utf8')).toBe(f.previous); expect(await fs.readdir(f.directory)).toEqual(['openai-endpoint.json']);
  });
  it('retains the previous file when atomic replacement fails and removes the flushed temporary file', async () => {
    const f = await fixture(); vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('fixture rename failed'));
    await expect(writeEndpointSettings(f.support, '{"model":"new-default"}')).rejects.toThrow('fixture rename failed');
    expect(await fs.readFile(f.file, 'utf8')).toBe(f.previous); expect(await fs.readdir(f.directory)).toEqual(['openai-endpoint.json']);
  });
});
