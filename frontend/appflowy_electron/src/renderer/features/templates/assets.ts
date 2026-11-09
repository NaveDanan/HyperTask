import manifest from '@assets/local_templates/manifest.json';
import { HyperTemplateRepository, type HyperTemplateSource } from './repository';

const payloads = import.meta.glob<string>('@assets/local_templates/payloads/*', { query: '?url', import: 'default' });
const media = import.meta.glob<string>('@assets/local_templates/media/*', { query: '?url', import: 'default' });
async function bundledResponse(path: string, assets: Record<string, () => Promise<string>>) {
  const loader = Object.entries(assets).find(([key]) => key.endsWith(`/local_templates/${path}`))?.[1];
  if (!loader) throw new Error(`Bundled template asset missing: ${path}`);
  const response = await fetch(await loader());
  if (!response.ok) throw new Error(`Could not read bundled template asset: ${path}`);
  return response;
}
export class HyperAssetTemplateSource implements HyperTemplateSource {
  async readManifest() { return manifest; }
  async readPayload(path: string) { return (await bundledResponse(path, payloads)).json(); }
  async readMedia(path: string) { return new Uint8Array(await (await bundledResponse(path, media)).arrayBuffer()); }
}
export const hyperTemplateRepository = new HyperTemplateRepository(new HyperAssetTemplateSource());