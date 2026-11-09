import fs from 'node:fs/promises';
import path from 'node:path';
import type { CustomThemeFiles } from '@shared/api';
import { SettingsError } from './settings-error';

// FlowyPluginService / FlowyDynamicPlugin (packages/flowy_infra/lib/plugins/service) for
// theme plugins: `<name>.flowy_plugin` folders in the user's Documents folder. JSON parsing
// (FlowyColorScheme.fromJsonSoft) happens in the renderer.

const EXT = 'flowy_plugin';
const LIGHT = 'light.json';
const DARK = 'dark.json';

/** FlowyDynamicPlugin.isPlugin: a directory whose extension contains `flowy_plugin`. */
const isPluginName = (name: string) => path.extname(name).includes(EXT);

/** p.basenameWithoutExtension(path).split('.').first */
const pluginName = (directory: string) => path.basename(directory, path.extname(directory)).split('.')[0];

async function files(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

/** FlowyDynamicPlugin.decode up to the JSON parsing; throws the Dart exceptions' messages. */
export async function readPluginDirectory(directory: string): Promise<CustomThemeFiles> {
  if (!isPluginName(directory)) {
    throw new SettingsError('format', 'The plugin directory must have the extension `.flowy_plugin`.');
  }
  const names = await files(directory);
  // PluginType.from: a theme has files ending in light.json and dark.json.
  if (!names.some((name) => name.endsWith(LIGHT)) || !names.some((name) => name.endsWith(DARK))) {
    throw new SettingsError('format', `Could not determine the plugin type from source \`Directory: '${directory}'\`.`);
  }
  // _theme: the first file whose name contains light.json / dark.json.
  const light = names.find((name) => name.includes(LIGHT));
  const dark = names.find((name) => name.includes(DARK));
  if (light === undefined || dark === undefined) throw new SettingsError('state', 'No element');
  return {
    name: pluginName(directory),
    light: await fs.readFile(path.join(directory, light), 'utf8'),
    dark: await fs.readFile(path.join(directory, dark), 'utf8'),
  };
}

async function pluginDirectories(documents: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(documents, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && isPluginName(entry.name)).map((entry) => path.join(documents, entry.name));
  } catch {
    return [];
  }
}

/** FlowyPluginService.plugins: folders that fail to decode are skipped. */
export async function listCustomThemes(documents: string): Promise<CustomThemeFiles[]> {
  const themes: CustomThemeFiles[] = [];
  for (const directory of await pluginDirectories(documents)) {
    try {
      themes.push(await readPluginDirectory(directory));
    } catch {
      // A broken plugin folder does not hide the others.
    }
  }
  return themes;
}

/** FlowyPluginService.addPlugin: `<Documents>/<name>.flowy_plugin/<name>.light.json` + `.dark.json`. */
export async function installCustomTheme(documents: string, theme: CustomThemeFiles): Promise<void> {
  // The name comes from a folder basename; refuse anything that could leave Documents.
  if (theme.name === '' || /[\\/:]/.test(theme.name) || theme.name.includes('..')) throw new Error('Invalid theme name.');
  const destination = path.join(documents, `${theme.name}.${EXT}`);
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, `${theme.name}.${LIGHT}`), theme.light, 'utf8');
  await fs.writeFile(path.join(destination, `${theme.name}.${DARK}`), theme.dark, 'utf8');
}

/** FlowyPluginService.removePlugin(lookup(name)): deletes that plugin's folder. */
export async function removeCustomTheme(documents: string, name: string): Promise<void> {
  for (const directory of await pluginDirectories(documents)) {
    if (pluginName(directory) !== name) continue;
    try {
      await readPluginDirectory(directory);
    } catch {
      continue;
    }
    await fs.rm(directory, { recursive: true, force: true });
    return;
  }
}
