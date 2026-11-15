// Adapted from OpenBot lib/copilot/carry-on.ts and chat-transcript.tsx. Copyright (c) 2026 CopilotKit. MIT; see ../LICENSE.
// App cards resume the existing channel context. They never manufacture a replacement user turn.
export interface HyperAppContinuationState {
  current: boolean;
  ready: boolean;
  busy: boolean;
  latest: boolean;
  hasDraft: boolean;
  hasQuestion: boolean;
  assertOwner(): void;
}
/** Kept at the real core caller seam so all cached cards re-read current gates before starting. */
export async function hyperContinueAppTask(state: () => HyperAppContinuationState, run: () => Promise<void>): Promise<boolean> {
  const now = state();
  if (!now.current || !now.ready || now.busy || !now.latest || now.hasDraft || now.hasQuestion) return false;
  now.assertOwner();
  await run();
  return true;
}
export function hyperAppCallIsLatest(messages: readonly { role: string; toolCalls?: readonly { id: string }[] }[], id: string): boolean {
  const lastUser = messages.findLastIndex(message => message.role === 'user');
  return messages.some((message, index) => index > lastUser && message.role === 'assistant' && message.toolCalls?.some(call => call.id === id));
}
