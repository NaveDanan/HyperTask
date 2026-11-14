// Adapted from OpenBot lib/copilot/gallery-tools.tsx and sandboxed-tools.tsx.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { useHyperGalleryCall, hyperAnswerGalleryCall } from './HyperGalleryRuntime';
import { HyperToolMessage, type HyperToolMessageProps } from '../transcript/HyperTranscript';
import { hyperGalleryComponent } from './HyperGalleryRegistry';
import { HyperInteractiveResult } from './HyperInteractiveResult';

/** Identity must come from call provenance, never the selected channel or model arguments. */
export function HyperConversationResult({tool, callingBotId}: {tool: HyperToolMessageProps; callingBotId?: string}) {
  const pending = useHyperGalleryCall(tool.id);
  const known = hyperGalleryComponent(tool.label) || tool.label.startsWith('custom_');
  if (!known) return <HyperToolMessage {...tool} />;
  let result = tool.result;
  try { const value: unknown = JSON.parse(result ?? ''); if (typeof value === 'string') result = value; } catch { /* Plain protocol sentence. */ }
  if (result?.startsWith('Not drawn:') || result?.startsWith('Not asked:')) return null;
  if (result?.startsWith('Not shown:') || tool.status === 'refused' || tool.status === 'failed') return <HyperToolMessage {...tool} status={tool.status === 'failed' ? 'failed' : 'refused'} />;
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(tool.arguments ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    args = parsed as Record<string, unknown>;
  } catch {
    return <p role={tool.status === 'running' ? 'status' : 'alert'}>{tool.status === 'running' ? `Drawing ${tool.label}…` : 'This component received unreadable arguments.'}</p>;
  }
  return <HyperInteractiveResult name={tool.label} agentId={callingBotId ?? ''} args={args} complete={tool.status === 'complete' || !!pending} result={result} respond={pending ? async value => {hyperAnswerGalleryCall(tool.id, value);} : undefined} />;
}
