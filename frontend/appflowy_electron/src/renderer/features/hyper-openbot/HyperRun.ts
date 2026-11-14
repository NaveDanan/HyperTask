// OpenBot channel-chat.tsx run-initialization/failure behavior. Copyright (c) 2026 CopilotKit. MIT.
import type { AbstractAgent, CopilotKitCore } from '@copilotkit/react-core/v2';
/** Releasing a view settles its join wait without detaching a newer/background run. */
export function hyperGatewayJoin(join: () => Promise<unknown>, onDeadline: () => void, timeout = 5000, confirmed: () => boolean = () => false) {
  let active = true;
  let release!: () => void;
  let timer: ReturnType<typeof setTimeout>;
  const released = new Promise<'cancelled'>(resolve => { release = () => resolve('cancelled'); });
  const deadline = new Promise<'connected' | 'deadline'>((resolve, reject) => {
    timer = setTimeout(() => {
      if (!active) return;
      try { if (confirmed()) resolve('connected'); else { onDeadline(); resolve('deadline'); } } catch (error) { reject(error); }
    }, timeout);
  });
  const promise = Promise.race([Promise.resolve().then(async () => { if (!active) return 'cancelled' as const; await join(); return 'connected' as const; }), deadline, released])
    .finally(() => { active = false; clearTimeout(timer); });
  return { promise, cancel() { active = false; clearTimeout(timer); release(); } };
}

/** A cursor-based reconnect may start with a text/tool delta and omit RUN_STARTED. */
export function hyperWatchGatewayActivity(agent: Pick<AbstractAgent, 'subscribe'>) {
  let answering = false, connected = false;
  const progress = () => { answering = true; connected = true; };
  const idle = () => { answering = false; };
  const terminal = () => { idle(); connected = true; };
  const subscription = agent.subscribe({ onRunStartedEvent: progress,
    onTextMessageContentEvent: progress, onToolCallStartEvent: progress,
    onToolCallArgsEvent: progress, onToolCallResultEvent: progress,
    onRunFinishedEvent: terminal, onRunFailed: idle, onRunErrorEvent: terminal });
  return { isAnswering: () => answering, isConnected: () => connected, unsubscribe: () => subscription.unsubscribe() };
}

/** Connect failures are emitted by the core even when connectAgent resolves successfully. */
export function hyperWatchGatewayErrors(core: Pick<CopilotKitCore, 'subscribe'>, agent: Pick<AbstractAgent, 'agentId' | 'threadId'>, onFailure: (error: Error) => void) {
  return core.subscribe({ onError: ({ code, context }) => {
    if (code === 'agent_connect_failed' && context.agentId === agent.agentId &&
      (context.threadId === undefined || context.threadId === agent.threadId))
      onFailure(new Error('OpenBot could not connect. Reconnect to try again. Your draft is kept.'));
  } });
}

/** SDK runAgent catches failures and resolves; only its events establish a successful send. */
export async function hyperRunWithRecovery(agent: Pick<AbstractAgent, 'subscribe'>, execute: () => Promise<unknown>, stopped: () => boolean) {
  let failure: Error | undefined; let initialized = false;
  const watch = agent.subscribe({ onRunInitialized: () => { initialized = true; }, onRunErrorEvent: ({ event }) => { failure = new Error(event.message || 'OpenBot run failed'); }, onRunFailed: ({ error }) => { if (!stopped()) failure = error instanceof Error ? error : new Error(String(error)); } });
  try { await execute(); if (!stopped() && (failure || !initialized)) throw failure ?? new Error('OpenBot did not start the run. Your draft is kept for retry.'); }
  finally { watch.unsubscribe(); }
}
