// Generates TypeScript protobuf bindings from the .proto files that the Rust build
// emits into rust-lib/<crate>/resources/proto.
// Each crate is generated separately because the files declare no package.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rustLib = path.resolve(root, '../rust-lib');
const outRoot = path.join(root, 'src/shared/protobuf');
const buf = path.join(root, 'node_modules/@bufbuild/buf-win32-x64/bin/buf.exe');
const bufBin = fs.existsSync(buf) ? buf : path.join(root, 'node_modules/.bin/buf');
const plugin = path.join(root, 'node_modules/@bufbuild/protoc-gen-es/bin/protoc-gen-es');

const crates = fs
  .readdirSync(rustLib)
  .filter((name) => fs.existsSync(path.join(rustLib, name, 'resources/proto')))
  .sort();

if (crates.length === 0) {
  throw new Error('No generated proto files found; run npm run build:core first.');
}

fs.rmSync(outRoot, { recursive: true, force: true });

for (const crate of crates) {
  const protoDir = path.join(rustLib, crate, 'resources/proto');
  const template = JSON.stringify({
    version: 'v2',
    plugins: [
      {
        local: ['node', plugin],
        out: path.join(outRoot, crate),
        opt: ['target=ts', 'import_extension=none'],
      },
    ],
  });
  const result = spawnSync(bufBin, ['generate', protoDir, '--template', template], {
    cwd: protoDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`buf generate failed for ${crate}`);
    process.exit(result.status ?? 1);
  }
  console.log(`generated ${crate}`);
}
