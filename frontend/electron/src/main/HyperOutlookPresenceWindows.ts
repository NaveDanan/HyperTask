import { execFile } from 'node:child_process';
import path from 'node:path';
import { powerShellExecutable } from './powershell';
import { SettingsError } from './settings-error';

// Read both registry views: 32-bit Office is common on 64-bit Windows.
export const HyperOutlookInstallScript = String.raw`
$ErrorActionPreference = 'Stop'
$found = $false
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = $null; $key = $null
    try {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      $key = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE')
      if ($null -ne $key) { $found = $true }
    } finally { if ($null -ne $key) { $key.Dispose() }; if ($null -ne $base) { $base.Dispose() } }
  }
}
@{ installed = $found; session = [Diagnostics.Process]::GetCurrentProcess().SessionId } | ConvertTo-Json -Compress
`;
export const HyperOutlookLaunchScript = "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'outlook.exe' -WindowStyle Normal";
function hyperOutlookExec(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 8000, maxBuffer: 256 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}
function hyperOutlookPowerShell(script: string) {
  return hyperOutlookExec(powerShellExecutable(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
}
export function hyperOutlookProcessIds(csv: string): string {
  return [...csv.matchAll(/^"OUTLOOK\.EXE","(\d+)"/gim)].map(match => Number(match[1])).sort((a, b) => a - b).join(',');
}
export interface HyperOutlookProcessState { installed: boolean; running: boolean; identity: string }
export class HyperOutlookWindows {
  private installation: { installed: boolean; session: number } | null = null;
  private detecting: Promise<HyperOutlookProcessState> | null = null;
  detect(): Promise<HyperOutlookProcessState> {
    this.detecting ??= this.check().finally(() => { this.detecting = null; });
    return this.detecting;
  }
  private async check(): Promise<HyperOutlookProcessState> {
    if (process.platform !== 'win32') return { installed: false, running: false, identity: '' };
    if (!this.installation) {
      const value = JSON.parse((await hyperOutlookPowerShell(HyperOutlookInstallScript)).replace(/^\uFEFF/, '').trim());
      if (typeof value.installed !== 'boolean' || !Number.isInteger(value.session) || value.session < 0) throw new Error('Invalid Outlook installation check.');
      this.installation = value;
    }
    const installed = this.installation!;
    const csv = await hyperOutlookExec(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe'), ['/FI', 'IMAGENAME eq OUTLOOK.EXE', '/FI', 'SESSION eq ' + installed.session, '/NH', '/FO', 'CSV']);
    const identity = hyperOutlookProcessIds(csv);
    if (identity) installed.installed = true;
    return { installed: installed.installed, running: !!identity, identity };
  }
  async launch(): Promise<void> {
    if (process.platform !== 'win32') throw new SettingsError('unsupported', 'Classic Outlook is available on Windows only.');
    const state = await this.detect();
    if (state.running) return;
    if (!state.installed) throw new SettingsError('state', 'Classic Outlook is not installed.');
    try { await hyperOutlookPowerShell(HyperOutlookLaunchScript); }
    catch { throw new SettingsError('state', 'Could not open Outlook. Open it from the Start menu, then try again.'); }
  }
}
