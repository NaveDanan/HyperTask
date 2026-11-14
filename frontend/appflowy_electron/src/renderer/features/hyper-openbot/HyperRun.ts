// OpenBot channel-chat.tsx run-initialization/failure behavior. Copyright (c) 2026 CopilotKit. MIT.
import type { AbstractAgent } from '@copilotkit/react-core/v2';
/** Releasing a view settles its join wait without detaching a newer/background run. */
export function hyperGatewayJoin(join: () => Promise<unknown>, onDeadline: () => void, timeout = 5000) {
  let active = true;
  let release!: () => void;
  let timer: ReturnType<typeof setTimeout>;
  const released = new Promise<void>(resolve => { release = resolve; });
  const deadline = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      if (!active) return;
      try { onDeadline(); resolve(); } catch (error) { reject(error); }
    }, timeout);
  });
  const promise = Promise.race([Promise.resolve().then(() => active ? join() : undefined), deadline, released])
    .finally(() => { active = false; clearTimeout(timer); });
  return { promise, cancel() { active = false; clearTimeout(timer); release(); } };
}

/** SDK runAgent catches failures and resolves; only its events establish a successful send. */
export async function hyperRunWithRecovery(agent: Pick<AbstractAgent, 'subscribe'>, execute: () => Promise<unknown>, stopped: () => boolean) {
  let failure: string | undefined; let initialized = false;
  const watch = agent.subscribe({ onRunInitialized: () => { initialized = true; }, onRunErrorEvent: ({ event }) => { failure = event.message || 'OpenBot run failed'; }, onRunFailed: ({ error }) => { if (!stopped()) failure = String(error); } });
  try { await execute(); if (!stopped() && (failure || !initialized)) throw new Error(failure ?? 'OpenBot did not start the run. Your draft is kept for retry.'); }
  finally { watch.unsubscribe(); }
}
