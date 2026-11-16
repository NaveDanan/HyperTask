// Adapted from OpenBot server/src/computer/routes.ts, schema.ts. Copyright (c) 2026 CopilotKit. MIT.
import { hyperOpenBotFetch, hyperOpenBotRequest, HYPER_OPENBOT_ORIGIN } from '../transport';
import { hyperComputerPath } from './HyperComputerApi';
export type HyperListing = { path: string; entries: { path: string; kind: 'file' | 'folder'; bytes?: number }[]; truncated: boolean };
export type HyperFile = { path: string; text: string; truncated: boolean; bytes: number };
export const hyperListFiles = (id: string, path: string) => hyperOpenBotRequest<HyperListing>(`${hyperComputerPath(id)}/files/list`, 'POST', path.trim() ? { path: path.trim() } : {});
export const hyperReadFile = (id: string, path: string) => hyperOpenBotRequest<HyperFile>(`${hyperComputerPath(id)}/files/read`, 'POST', { path: path.trim() });
export async function hyperWriteFile(id: string, path: string, contents: string) {
  await hyperOpenBotRequest(`${hyperComputerPath(id)}/files/write`, 'POST', { path: path.trim(), contents, append: false });
  return hyperReadFile(id, path);
}
export async function hyperDownloadFile(id: string, path: string): Promise<Blob> {
  const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}${hyperComputerPath(id)}/files/download?path=${encodeURIComponent(path.trim())}`);
  if (!response.ok) throw new Error('The server refused the download.');
  return new Blob([await response.arrayBuffer()], { type: 'application/octet-stream' });
}
