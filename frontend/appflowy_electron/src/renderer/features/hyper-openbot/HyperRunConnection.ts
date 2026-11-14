import { Observable } from 'rxjs';
import type { BaseEvent, RunAgentInput } from '@ag-ui/core';

type HyperRunConnection = Pick<RunAgentInput, 'threadId' | 'runId'>;
const listeners = new Set<(connection: HyperRunConnection) => void>();

/** A closed run socket cannot establish completion. Fail that run, preserving its draft. */
export function hyperRunConnectionLost(connection: HyperRunConnection) {
  for (const listener of [...listeners]) listener(connection);
}

/** Observe the canonical run identity, so an old or another thread's socket cannot fail this run. */
export function hyperWithRunConnection<T extends BaseEvent>(input: HyperRunConnection, source: Observable<T>): Observable<T> {
  return new Observable(subscriber => {
    let connection = input;
    const lost = (closed: HyperRunConnection) => {
      if (closed.threadId === connection.threadId && closed.runId === connection.runId)
        subscriber.error(new Error('OpenBot connection interrupted. Reconnect to recover the response. Your draft is kept.'));
    };
    listeners.add(lost);
    const subscription = source.subscribe({
      next(event) {
        if (event.type === 'RUN_STARTED') {
          const started = event as T & HyperRunConnection;
          connection = { threadId: started.threadId, runId: started.runId };
        }
        subscriber.next(event);
      },
      error: error => subscriber.error(error),
      complete: () => subscriber.complete(),
    });
    return () => { listeners.delete(lost); subscription.unsubscribe(); };
  });
}
