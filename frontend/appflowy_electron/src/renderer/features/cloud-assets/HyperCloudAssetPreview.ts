import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner } from '../document/HyperDocumentOwner';

function imageUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 8192 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Use a complete HTTP or HTTPS image address.');
  let url: URL; try { url = new URL(value); } catch { throw new Error('Use a complete HTTP or HTTPS image address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Use an HTTP or HTTPS image address without embedded credentials.');
  return url;
}

/** Includes foreign-workspace routes so they reach the trusted bridge's rejection path. */
export function hyperCloudAssetIsProtected(value: string): boolean {
  try {
    const source = imageUrl(value), configured = useAppStore.getState().env?.appflowyCloudConfig.base_url;
    if (!configured) return false;
    const server = imageUrl(configured), prefix = `${server.pathname.replace(/\/$/u, '')}/api/file_storage/`;
    return source.origin === server.origin && source.pathname.startsWith(prefix);
  } catch { return false; }
}

let ownerRevision = 0, watched = false, lastOwner = '';
function version() {
  const update = () => {
    const next = JSON.stringify([hyperDocumentOwnerKey(hyperGetDocumentOwner()), useAppStore.getState().launchId]);
    if (next !== lastOwner) { lastOwner = next; ownerRevision++; }
  };
  if (!watched) { watched = true; update(); useWorkspaceStore.subscribe(update); useAppStore.subscribe(update); }
  update(); return ownerRevision;
}

/** Private previews use native authenticated I/O. No renderer token, fetch or private fallback. */
export async function hyperPreviewCloudAsset(value: string): Promise<string> {
  const url = imageUrl(value);
  if (!hyperCloudAssetIsProtected(url.href)) return url.href;
  const owner = hyperGetDocumentOwner(), captured = version();
  const current = () => {
    if (!owner?.isCurrent() || captured !== version() || hyperDocumentOwnerKey(hyperGetDocumentOwner()) !== hyperDocumentOwnerKey(owner)) throw new Error('The image workspace, account or app session changed.');
  };
  current();
  if (typeof window.appflowy.assets.previewCloud !== 'function') throw new Error('Protected image previews are unavailable in this app session.');
  const result = await window.appflowy.assets.previewCloud(url.href, { actorId: owner!.actorId, workspaceId: owner!.workspaceId });
  current();
  // Bytes and raster structure are validated by main; this enforces the renderer contract.
  if (typeof result !== 'string' || result.length > 45 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(result)) throw new Error('The protected image preview has an unsupported format.');
  return result;
}
