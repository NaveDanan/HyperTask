// Builds the Rust core process used by the Electron desktop app.
//   npm run build:core            debug build
//   npm run build:core -- --release
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rustLib = path.resolve(root, '../rust-lib');
const release = process.argv.includes('--release');

const env = { ...process.env, RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? '1.85.0' };
const args = ['build', '-p', 'electron-core', '--features', 'file_reader'];
if (process.platform === 'win32') {
  const localClang = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\Llvm\\x64\\bin';
  const localVcpkg = 'D:\\Tools\\vcpkg';
  const localPkgconf = 'D:\\Tools\\pkgconf\\mingw64\\bin';
  if (!env.LIBCLANG_PATH && fs.existsSync(localClang)) env.LIBCLANG_PATH = localClang;
  if (!env.VCPKG_ROOT && fs.existsSync(localVcpkg)) env.VCPKG_ROOT = localVcpkg;
  const searchPaths = [fs.existsSync(localPkgconf) ? localPkgconf : '', path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin'), env.Path ?? env.PATH ?? ''];
  env.Path = searchPaths.filter(Boolean).join(path.delimiter);
  args.push('--target', 'x86_64-pc-windows-msvc');
}
if (release) args.push('--release');

console.log(`cargo ${args.join(' ')}`);
const result = spawnSync('cargo', args, { cwd: rustLib, env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
