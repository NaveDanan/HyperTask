import path from 'node:path';

const BINARY_NAME = process.platform === 'win32' ? 'appflowy_core.exe' : 'appflowy_core';

/**
 * Location of the core binary: next to the app resources when packaged, otherwise the
 * rust-lib build output (`npm run build:core`).
 */
export function coreBinaryPath(appRoot: string, packaged: boolean): string {
  if (packaged) return path.join(process.resourcesPath, BINARY_NAME);
  const override = process.env.APPFLOWY_CORE_BINARY;
  if (override) return override;
  const target = process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : '';
  return path.resolve(appRoot, '../rust-lib/target', target, 'debug', BINARY_NAME);
}
