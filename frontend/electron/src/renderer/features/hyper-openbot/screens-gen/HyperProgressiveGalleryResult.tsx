// Adapted from pinned OpenBot gallery-tools.tsx and SDK use-render-tool-call.tsx.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { partialJSONParse } from '@copilotkit/shared';
import { HyperInteractiveResult, type HyperInteractiveResultProps } from './HyperInteractiveResult';

/** The same partial parser used by SDK ToolCallRenderer. Final arguments still require valid JSON. */
export function hyperReadGalleryArguments(raw: string | undefined, complete: boolean): Record<string, unknown> | null {
  if (!complete) return partialJSONParse(raw ?? '') as Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
export type HyperProgressiveGalleryResultProps = Omit<HyperInteractiveResultProps, 'args' | 'complete' | 'decided'> & {
  arguments?: string;
  /** False only while this row can still receive argument deltas, never merely because a result is absent. */
  argumentsComplete: boolean;
  /** True after the call's handler answers, or after its turn ends. Pending decisions are executing. */
  decided: boolean;
};
/** Parent transcript adapter: preserve app-access/refusal/failed/mixed-step guards before mounting.
 * Pass the verified calling Bot, decoded result, callId and the raw tool arguments. The transcript
 * supplies row/turn facts: argumentsComplete = !argumentsArriving || status !== 'running' || !!pending;
 * decided = result !== undefined || !turnInFlight || !!pending. Pending decisions are executing.
 * Resolve only the captured wait with hyperAnswerGalleryCall(callId, value, pending). A missing
 * result alone does not establish argument arrival. Never derive provenance from Bot selection.
 */
export function HyperProgressiveGalleryResult({arguments: raw, argumentsComplete, decided, ...props}: HyperProgressiveGalleryResultProps) {
  const args = hyperReadGalleryArguments(raw, argumentsComplete);
  if (!args) return <p role="alert">This component received unreadable arguments.</p>;
  return <HyperInteractiveResult {...props} args={args} complete={argumentsComplete} decided={decided} />;
}
