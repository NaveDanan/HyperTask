// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { hyperScreensApi } from '../screens-gen/HyperScreensApi';
export interface HyperSandboxDraft { slug: string; title: string; description: string; html: string; css: string; jsFunctions: string; argumentSchema: Record<string, unknown>; sampleArguments: Record<string, unknown> }
export interface HyperSandboxRecord { name: string; title: string; draftDescription: string; draftHtml: string; draftCss: string; draftJsFunctions: string; draftArgumentSchema: Record<string, unknown>; sampleArguments: Record<string, unknown>; revision: number; published: boolean; hasUnpublishedChanges: boolean }
export function hyperParseObject(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter a JSON object.');
  return value as Record<string, unknown>;
}
export const hyperLoadSandboxed = async () => ({ components: await hyperScreensApi.sandboxed() });
export async function hyperSaveSandboxed(input: HyperSandboxDraft, publish = false) {
  if (publish) await hyperScreensApi.publish(input);
  else await hyperScreensApi.save(input);
}
export const hyperDeleteSandboxed = (name: string) => hyperScreensApi.delete(name);
