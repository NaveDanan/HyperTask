import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportLogs } from './logs';

describe('exportLogs', () => {
  it('returns null without log files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-logs-'));
    expect(await exportLogs(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });

  it('zips nested log.* files into a readable archive', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-logs-'));
    fs.mkdirSync(path.join(dir, 'data_dev'));
    fs.writeFileSync(path.join(dir, 'data_dev', 'log.2026-11-09'), 'hello log\n'.repeat(100));
    fs.writeFileSync(path.join(dir, 'other.txt'), 'skip');
    const zip = await exportLogs(dir);
    expect(zip).toBe(path.join(dir, 'appflowy_logs.zip'));

    const out = path.join(dir, 'unzipped');
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}'`]);
    } else {
      execFileSync('unzip', ['-q', zip!, '-d', out]);
    }
    expect(fs.readFileSync(path.join(out, 'data_dev', 'log.2026-11-09'), 'utf8')).toBe('hello log\n'.repeat(100));
    expect(fs.existsSync(path.join(out, 'other.txt'))).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
});
