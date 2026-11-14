// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest } from '../transport';
export interface HyperSandboxDraft { slug: string; title: string; description: string; html: string; css: string; jsFunctions: string; argumentSchema: Record<string, unknown>; sampleArguments: Record<string, unknown> }
export interface HyperSandboxRecord { name: string; title: string; draftDescription: string; draftHtml: string; draftCss: string; draftJsFunctions: string; draftArgumentSchema: Record<string, unknown>; sampleArguments: Record<string, unknown>; revision: number; published: boolean; hasUnpublishedChanges: boolean }
export function hyperParseObject(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter a JSON object.');
  return value as Record<string, unknown>;
}
export const hyperLoadSandboxed = () => hyperOpenBotRequest<{ components: HyperSandboxRecord[] }>('/api/sandboxed');
export async function hyperSaveSandboxed(input: HyperSandboxDraft, publish = false) {
  await hyperOpenBotRequest('/api/sandboxed', 'POST', input);
  if (publish) await hyperOpenBotRequest(`/api/sandboxed/${encodeURIComponent(`custom_${input.slug}`)}/publish`, 'POST');
}
export const hyperDeleteSandboxed = (name: string) => hyperOpenBotRequest(`/api/sandboxed/${encodeURIComponent(name)}`, 'DELETE');
