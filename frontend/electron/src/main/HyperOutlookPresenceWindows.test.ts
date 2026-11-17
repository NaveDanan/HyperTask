import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mock.execFile }));
import { HyperOutlookWindows, HyperOutlookInstallScript, HyperOutlookLaunchScript, hyperOutlookProcessIds } from './HyperOutlookPresenceWindows';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const row = '"OUTLOOK.EXE","123","Console","7","100 K"';
let output: string[];
beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' }); output = [];
  mock.execFile.mockReset().mockImplementation((_file, _args, _options, callback) => callback(null, output.shift() ?? ''));
});
afterEach(() => Object.defineProperty(process, 'platform', platform));
it('parses only classic Outlook rows, independent of session labels or localized no-results output', () => {
  expect(hyperOutlookProcessIds('INFO: No tasks are running')).toBe('');
  expect(hyperOutlookProcessIds('"olk.exe","1"\r\n' + row + '\r\n"outlook.exe","12","RDP-Tcp#2"')).toBe('12,123');
});
it('reads App Paths once in both hives/views and limits hidden tasklist checks to the current session', async () => {
  output.push(JSON.stringify({ installed: true, session: 7 }), row, 'INFO: No tasks');
  const detector = new HyperOutlookWindows();
  expect(await detector.detect()).toEqual({ installed: true, running: true, identity: '123' });
  expect(await detector.detect()).toEqual({ installed: true, running: false, identity: '' });
  expect(mock.execFile).toHaveBeenCalledTimes(3);
  const [, args, options] = mock.execFile.mock.calls[1];
  expect(args).toEqual(['/FI', 'IMAGENAME eq OUTLOOK.EXE', '/FI', 'SESSION eq 7', '/NH', '/FO', 'CSV']);
  expect(options).toMatchObject({ windowsHide: true, timeout: 8000 });
  expect(HyperOutlookInstallScript).toMatch(/CurrentUser/); expect(HyperOutlookInstallScript).toMatch(/LocalMachine/);
  expect(HyperOutlookInstallScript).toMatch(/Registry64/); expect(HyperOutlookInstallScript).toMatch(/Registry32/);
  expect(HyperOutlookInstallScript).not.toMatch(/ComObject|GetActiveObject|Start-Process/);
});
it('remembers a running process as proof of installation when App Paths is absent', async () => {
  output.push(JSON.stringify({ installed: false, session: 7 }), row, 'INFO: No tasks'); const detector = new HyperOutlookWindows();
  expect((await detector.detect()).installed).toBe(true); expect((await detector.detect()).installed).toBe(true);
});
it('does not launch if Outlook is already running, and refuses absent classic Outlook', async () => {
  output.push(JSON.stringify({ installed: true, session: 7 }), row); await new HyperOutlookWindows().launch(); expect(mock.execFile).toHaveBeenCalledTimes(2);
  output.push(JSON.stringify({ installed: false, session: 7 }), 'INFO: No tasks'); await expect(new HyperOutlookWindows().launch()).rejects.toThrow('not installed'); expect(mock.execFile).toHaveBeenCalledTimes(4);
});
it('launches visibly with a fixed executable and no Outlook switches or renderer arguments', async () => {
  output.push(JSON.stringify({ installed: true, session: 7 }), 'INFO: No tasks', ''); await new HyperOutlookWindows().launch();
  const [file, args, options] = mock.execFile.mock.calls[2];
  expect(file.toLowerCase()).toContain('powershell.exe'); expect(options.windowsHide).toBe(true);
  expect(Buffer.from(args.at(-1), 'base64').toString('utf16le')).toBe(HyperOutlookLaunchScript);
  expect(HyperOutlookLaunchScript).toBe("$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'outlook.exe' -WindowStyle Normal");
});
it('reports launch failure, rejects invalid session detection, and does nothing on unsupported platforms', async () => {
  output.push(JSON.stringify({ installed: true, session: 7 }), 'INFO: No tasks');
  mock.execFile.mockImplementationOnce((_f, _a, _o, done) => done(null, output.shift())).mockImplementationOnce((_f, _a, _o, done) => done(null, output.shift())).mockImplementationOnce((_f, _a, _o, done) => done(new Error('missing')));
  await expect(new HyperOutlookWindows().launch()).rejects.toThrow('Could not open Outlook');
  output.push(JSON.stringify({ installed: true, session: '7' })); await expect(new HyperOutlookWindows().detect()).rejects.toThrow('Invalid');
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' }); const calls = mock.execFile.mock.calls.length;
  expect(await new HyperOutlookWindows().detect()).toMatchObject({ installed: false, running: false });
  await expect(new HyperOutlookWindows().launch()).rejects.toThrow('Windows only'); expect(mock.execFile).toHaveBeenCalledTimes(calls);
});

it('shares a pending detection with concurrent polling or launch checks', async () => {
  const detector = new HyperOutlookWindows();
  let finish!: (error: null, stdout: string) => void;
  mock.execFile.mockImplementationOnce((_f, _a, _o, done) => { finish = done; });
  const a = detector.detect(), b = detector.detect(); expect(a).toBe(b); expect(mock.execFile).toHaveBeenCalledOnce();
  output.push(row); finish(null, JSON.stringify({ installed: true, session: 7 })); await a;
  expect(mock.execFile).toHaveBeenCalledTimes(2);
});
