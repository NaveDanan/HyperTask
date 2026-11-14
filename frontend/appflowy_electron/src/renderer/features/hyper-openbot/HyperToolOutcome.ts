import type { HyperToolMessageProps } from './transcript/HyperTranscript';
/** A tool response means it answered. Its outcome determines whether the requested action happened. */
export function hyperToolOutcome(result: string | undefined, running: boolean): HyperToolMessageProps['status'] {
  if (result === undefined) return running ? 'running' : 'not-yet';
  try {
    const value: unknown = JSON.parse(result);
    if (value && typeof value === 'object') {
      const outcome = value as Record<string, unknown>;
      if (outcome.refused === true) return 'refused';
      if (outcome.waiting === true || outcome.starting === true || outcome.stopped === true || outcome.notPerformed === true) return 'not-yet';
      if (outcome.ok === false) return 'failed';
      if (outcome.doneByPerson === true) return 'by-you';
    }
  } catch { /* Plain textual tool results are complete. */ }
  return 'complete';
}
