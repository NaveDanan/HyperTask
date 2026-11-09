import { useAppStore } from '@/startup/app-store';
import type { HyperTemplateMediaAsset } from './models';

export type HyperTemplateMediaWriter = (asset: HyperTemplateMediaAsset, bytes: Uint8Array) => Promise<string>;
/** Same ApplicationDataStorage root, images/files folders and UUID + extension as the Dart editor helpers. */
export const saveHyperTemplateMedia: HyperTemplateMediaWriter = async (asset, bytes) => {
  const { dataDirectory, info } = useAppStore.getState();
  if (!dataDirectory) throw new Error('Application data directory is not initialized');
  const extension = /\.[^./\\]+$/.exec(asset.path)?.[0] ?? '';
  const separator = info?.platform === 'win32' ? '\\' : '/';
  const path = [dataDirectory.replace(/[\\/]+$/, ''), asset.isImage ? 'images' : 'files', `${crypto.randomUUID()}${extension}`].join(separator);
  // writeBytes creates parent directories recursively in the main process.
  await window.appflowy.fs.writeBytes(path, bytes);
  return path;
};