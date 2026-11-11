import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identitySource = await fs.readFile(path.join(root, 'src/shared/HyperDesktopIdentity.ts'), 'utf8');
const appId = identitySource.match(/HYPER_DESKTOP_APP_ID = '([^']+)'/u)?.[1];
if (!appId || !/^io\.github\.[a-z0-9]+\.[a-z0-9]+$/u.test(appId)) throw Error('The HyperTask identity source is invalid.');
const [platform, destination] = process.argv.slice(2);
if (!destination || !path.isAbsolute(destination) || !['linux', 'darwin'].includes(platform)) throw Error('Usage: node scripts/hyper-stage-identity.mjs linux /absolute/staging-root | darwin /absolute/HyperTask.app');
// Stage only. This command never installs an application or writes a user registration.
if (platform === 'linux') {
  const target = path.join(destination, 'share/applications', `${appId}.desktop`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(root, 'resources/identity', `${appId}.desktop`), target, (await import('node:fs')).constants.COPYFILE_EXCL);
  console.log(target);
} else {
  if (process.platform !== 'darwin' || !destination.endsWith('.app')) throw Error('macOS bundle identity staging requires macOS and an existing .app bundle.');
  const main = path.join(destination, 'Contents/Info.plist');
  const execute = promisify(execFile), read = file => execute('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', file]).then(result => result.stdout.trim());
  const previous = await read(main), files = [main], frameworks = path.join(destination, 'Contents/Frameworks');
  for (const name of await fs.readdir(frameworks)) if (name.endsWith('.app')) files.push(path.join(frameworks, name, 'Contents/Info.plist'));
  const changes = await Promise.all(files.map(async file => { const existing = await read(file); if (file !== main && !existing.startsWith(`${previous}.`)) throw Error('A helper bundle has an unrelated identity; inspect it before staging.'); return { file, value: file === main ? appId : `${appId}${existing.slice(previous.length)}` }; }));
  for (const { file, value } of changes) await execute('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', value, file]);
  console.log(`Staged ${changes.length} HyperTask bundle identities. Code signing must follow this packaging step.`);
}
