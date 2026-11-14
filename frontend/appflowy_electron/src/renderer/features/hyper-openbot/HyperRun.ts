// OpenBot channel-chat.tsx run-initialization/failure behavior. Copyright (c) 2026 CopilotKit. MIT.
import type { AbstractAgent } from '@copilotkit/react-core/v2';
/** SDK runAgent catches failures and resolves; only its events establish a successful send. */
export async function hyperRunWithRecovery(agent: Pick<AbstractAgent, 'subscribe'>, execute: () => Promise<unknown>, stopped: () => boolean) {
  let failure: string | undefined; let initialized = false;
  const watch = agent.subscribe({ onRunInitialized: () => { initialized = true; }, onRunErrorEvent: ({ event }) => { failure = event.message || 'OpenBot run failed'; }, onRunFailed: ({ error }) => { if (!stopped()) failure = String(error); } });
  try { await execute(); if (!stopped() && (failure || !initialized)) throw new Error(failure ?? 'OpenBot did not start the run. Your draft is kept for retry.'); }
  finally { watch.unsubscribe(); }
}
