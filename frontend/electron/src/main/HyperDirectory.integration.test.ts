import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { HyperOutlookBridge } from './HyperOutlookBridge';
import { powerShellExecutable } from './powershell';
it.skipIf(process.env.HYPER_DIRECTORY_IT !== '1' || process.platform !== 'win32')('searches AD only for the current Windows user and looks up their own person card', async () => {
  const script = "$s=[adsisearcher]('(&(objectCategory=person)(objectClass=user)(sAMAccountName=' + $env:USERNAME + '))'); [void]$s.PropertiesToLoad.Add('displayName'); try { [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write([string]$s.FindOne().Properties['displayname'][0]) } finally { $s.Dispose() }";
  const ownName = execFileSync(powerShellExecutable(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8' }).replace(/^\uFEFF/, '').trim();
  expect(ownName.length).toBeGreaterThanOrEqual(2);
  const bridge = new HyperOutlookBridge();
  try { const people = await bridge.request('people.search', { query: ownName, limit: 5 }); const own = people.find(person => person.name.toLocaleLowerCase() === ownName.toLocaleLowerCase()); expect(own).toBeDefined(); expect(own?.source).toBe('ad'); if (!own) return; expect(await bridge.request('people.lookup', { email: own.email })).toEqual(own); }
  finally { bridge.stop(); }
}, 45000);
