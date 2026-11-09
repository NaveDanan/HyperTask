import { spawn } from 'node:child_process';
import path from 'node:path';
import { SettingsError } from './settings-error';

export interface PowerShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PowerShellOptions {
  script: string;
  /** Added to the parent environment. Never put secrets here (use stdin). */
  env?: Record<string, string>;
  /** Written to the process's standard input, then closed. */
  stdin?: string;
  timeoutMs: number;
}

/** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, as the Dart code resolves it. */
export function powerShellExecutable(): string {
  return path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Dart's TimeoutException.toString() for a 30 s Future.timeout. */
export const timeoutMessage = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  const micros = String((ms % 1000) * 1000).padStart(6, '0');
  return `TimeoutException after ${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${micros}: Future not completed`;
};

const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * `-EncodedCommand` makes PowerShell report progress records ("Preparing modules for first
 * use.") on stderr as CLIXML. Drop that envelope so stderr is the script's own text, as with
 * the Dart `-Command` invocation.
 */
export function stripClixml(text: string): string {
  if (!text.includes('#< CLIXML')) return text;
  return text
    .replace(/#< CLIXML\r?\n?/g, '')
    .replace(/<Objs\b[\s\S]*?<\/Objs>/g, '')
    .replace(/<Objs\b[^>]*\/>/g, '');
}

/**
 * Runs a Windows PowerShell script (`-NoProfile -NonInteractive -EncodedCommand`) without a
 * console window. Output is UTF-8: the runner switches the console encoding before the
 * script so non-ASCII certificate subjects survive. stdin/stdout are never logged.
 */
export function runPowerShell({ script, env, stdin, timeoutMs }: PowerShellOptions): Promise<PowerShellResult> {
  const prelude = "$ProgressPreference = 'SilentlyContinue'\ntry { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch {}\n";
  const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(powerShellExecutable(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(
      () =>
        finish(() => {
          child.kill();
          reject(new SettingsError('other', timeoutMessage(timeoutMs)));
        }),
      timeoutMs,
    );
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => finish(() => reject(new SettingsError('other', error.message))));
    child.on('close', (code) =>
      finish(() => {
        const stdout = Buffer.concat(out);
        resolve({ exitCode: code ?? -1, stdout: stripBom(stdout.toString('utf8')), stderr: stripClixml(stripBom(Buffer.concat(err).toString('utf8'))) });
        stdout.fill(0);
        out.forEach((chunk) => chunk.fill(0));
      }),
    );
    child.stdin.on('error', () => {
      // The process may exit before reading its input; the exit code reports the failure.
    });
    child.stdin.end(stdin ?? '');
  });
}
