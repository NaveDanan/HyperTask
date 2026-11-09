import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SharedPreferences } from './prefs';

describe('SharedPreferences', () => {
  const dirs: string[] = [];
  const tempFile = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-prefs-'));
    dirs.push(dir);
    return path.join(dir, 'shared_preferences.json');
  };
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

  it('exposes only flutter-prefixed keys, without the prefix', async () => {
    const file = tempFile();
    fs.writeFileSync(file, JSON.stringify({ 'flutter.kCloudType': '3', other: 1 }));
    expect(await new SharedPreferences(file).getAll()).toEqual({ kCloudType: '3' });
  });

  it('writes keys with the prefix and keeps unrelated entries', async () => {
    const file = tempFile();
    fs.writeFileSync(file, JSON.stringify({ other: 1, 'flutter.old': 'x' }));
    const prefs = new SharedPreferences(file);
    await prefs.set('windowMaximized', 'true');
    await prefs.remove('old');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ other: 1, 'flutter.windowMaximized': 'true' });
  });

  it('starts empty when the file is missing or invalid', async () => {
    const file = tempFile();
    expect(await new SharedPreferences(file).getAll()).toEqual({});
    fs.writeFileSync(file, '{not json');
    expect(await new SharedPreferences(file).getAll()).toEqual({});
  });

  it('keeps Dart doubles as doubles when rewriting the file', async () => {
    const file = tempFile();
    fs.writeFileSync(file, '{"flutter.kDocumentAppearanceWidth":1920.0,"flutter.count":3,"flutter.ratio":0.5}');
    const prefs = new SharedPreferences(file);
    expect(await prefs.getAll()).toEqual({ kDocumentAppearanceWidth: 1920, count: 3, ratio: 0.5 });
    await prefs.setDouble('kDocumentAppearanceFontSize', 16);
    await prefs.set('other', 'x');
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '{"flutter.kDocumentAppearanceWidth":1920.0,"flutter.count":3,"flutter.ratio":0.5,"flutter.kDocumentAppearanceFontSize":16.0,"flutter.other":"x"}',
    );
  });
});
