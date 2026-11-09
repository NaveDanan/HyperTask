// Builds the Rust core process (rust-lib/electron-core) with the same toolchain, target and
// feature set as the Flutter backend (doc/windows-development.md), so both share the cache.
//   npm run build:core            debug build
//   npm run build:core -- --release
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rustLib = path.resolve(root, '../rust-lib');
const release = process.argv.includes('--release');

const env = { ...process.env, RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? '1.85.0' };
const args = ['build', '-p', 'electron-core', '--features', 'dart,file_reader', '--offline'];
if (process.platform === 'win32') {
  env.LIBCLANG_PATH ??= 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\Llvm\\x64\\bin';
  env.VCPKG_ROOT ??= 'D:\\Tools\\vcpkg';
  env.Path = `D:\\Tools\\pkgconf\\mingw64\\bin;${path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin')};${env.Path ?? env.PATH ?? ''}`;
  args.push('--target', 'x86_64-pc-windows-msvc');
}
if (release) args.push('--release');

console.log(`cargo ${args.join(' ')}`);
const result = spawnSync('cargo', args, { cwd: rustLib, env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
