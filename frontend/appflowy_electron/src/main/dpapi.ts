import { runPowerShell } from './powershell';
import { SettingsError } from './settings-error';

// encryptKey/decryptKey (lib/ai/service/openai_endpoint_settings.dart): base64 of a raw
// CurrentUser DPAPI blob. ProtectedData.Protect/Unprotect call CryptProtectData /
// CryptUnprotectData with CRYPTPROTECT_UI_FORBIDDEN and an empty entropy blob, which is
// interchangeable with the Dart win32 call (null entropy) and the Rust core's
// CryptUnprotectData. Electron safeStorage is NOT used: its output is not a DPAPI blob.

const SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $source = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($env:APPFLOWY_DPAPI_ACTION -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($source, $null, $scope)
  } else {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($source, $null, $scope)
  }
  [Array]::Clear($source, 0, $source.Length)
  [Console]::Out.Write([Convert]::ToBase64String($result))
  [Array]::Clear($result, 0, $result.Length)
} catch { [Console]::Error.WriteLine('DPAPI operation failed.'); exit 1 }
`;

async function run(action: 'protect' | 'unprotect', base64Input: string, failure: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new SettingsError('unsupported', 'Saved API credentials in this build require Windows.');
  }
  let result;
  try {
    result = await runPowerShell({ script: SCRIPT, env: { APPFLOWY_DPAPI_ACTION: action }, stdin: base64Input, timeoutMs: 30_000 });
  } catch {
    throw new SettingsError('state', failure);
  }
  const output = result.stdout.trim();
  if (result.exitCode !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(output)) throw new SettingsError('state', failure);
  return output;
}

/** encryptKey(value): '' for ''. */
export async function protect(value: string): Promise<string> {
  if (value === '') return '';
  const plain = Buffer.from(value, 'utf8');
  try {
    return await run('protect', plain.toString('base64'), 'Windows could not protect the AI credential. Re-enter the key.');
  } finally {
    plain.fill(0);
  }
}

/** decryptKey(value): '' for ''. Main-process only; the plaintext never goes to the renderer. */
export async function unprotect(value: string): Promise<string> {
  if (value === '') return '';
  const failure = 'Windows could not read the AI credential. Re-enter the key.';
  const output = await run('unprotect', value, failure);
  const bytes = Buffer.from(output, 'base64');
  try {
    // utf8.decode is strict in Dart: malformed bytes throw.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SettingsError('format', 'Invalid UTF-8 in the AI credential.');
  } finally {
    bytes.fill(0);
  }
}
