import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installCustomTheme, listCustomThemes, readPluginDirectory, removeCustomTheme } from './custom-themes';
import { stripClixml, timeoutMessage } from './powershell';

describe('powershell helpers', () => {
  it('strips the CLIXML progress envelope from stderr', () => {
    const stderr =
      '#< CLIXML\r\nThis is a server certificate. Choose a CA certificate.\r\n' +
      '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"></Obj></Objs>';
    expect(stripClixml(stderr).trim()).toBe('This is a server certificate. Choose a CA certificate.');
    expect(stripClixml('plain error')).toBe('plain error');
  });

  it("formats timeouts like Dart's TimeoutException", () => {
    expect(timeoutMessage(30_000)).toBe('TimeoutException after 0:00:30.000000: Future not completed');
  });
});

describe('custom themes', () => {
  const dirs: string[] = [];
  const temp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-themes-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

  it('reads a .flowy_plugin folder', async () => {
    const root = temp();
    const plugin = path.join(root, 'Ocean.v2.flowy_plugin');
    fs.mkdirSync(plugin);
    fs.writeFileSync(path.join(plugin, 'ocean.light.json'), '{"primary":"0xff00bcf0"}');
    fs.writeFileSync(path.join(plugin, 'ocean.dark.json'), '{}');
    expect(await readPluginDirectory(plugin)).toEqual({ name: 'Ocean', light: '{"primary":"0xff00bcf0"}', dark: '{}' });
  });

  it('reports the Dart compilation errors', async () => {
    const root = temp();
    await expect(readPluginDirectory(root)).rejects.toMatchObject({
      kind: 'format',
      message: 'The plugin directory must have the extension `.flowy_plugin`.',
    });
    const plugin = path.join(root, 'x.flowy_plugin');
    fs.mkdirSync(plugin);
    fs.writeFileSync(path.join(plugin, 'x.light.json'), '{}');
    await expect(readPluginDirectory(plugin)).rejects.toMatchObject({
      kind: 'format',
      message: `Could not determine the plugin type from source \`Directory: '${plugin}'\`.`,
    });
  });

  it('installs, lists (skipping broken folders) and removes themes', async () => {
    const documents = temp();
    fs.mkdirSync(path.join(documents, 'broken.flowy_plugin'));
    fs.mkdirSync(path.join(documents, 'not-a-plugin'));
    await installCustomTheme(documents, { name: 'Ocean', light: '{"a":1}', dark: '{"b":2}' });
    expect(fs.readFileSync(path.join(documents, 'Ocean.flowy_plugin', 'Ocean.light.json'), 'utf8')).toBe('{"a":1}');
    expect(await listCustomThemes(documents)).toEqual([{ name: 'Ocean', light: '{"a":1}', dark: '{"b":2}' }]);
    await removeCustomTheme(documents, 'Ocean');
    expect(fs.existsSync(path.join(documents, 'Ocean.flowy_plugin'))).toBe(false);
    expect(await listCustomThemes(path.join(documents, 'missing'))).toEqual([]);
  });
});
