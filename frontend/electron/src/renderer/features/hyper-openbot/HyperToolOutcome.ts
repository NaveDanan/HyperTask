import { declinedByPerson, doneByPerson, outcomeForPerson, OUTCOME_UNKNOWN, NOT_DONE, ALREADY_WAITING } from './HyperApprovalOutcomes';
import type { HyperToolMessageProps } from './transcript/HyperTranscript';
function hyperToolAnswer(result: string): string {
  try { const parsed: unknown = JSON.parse(result); if (typeof parsed === 'string') return parsed; } catch { /* Already plain text. */ }
  return result;
}
/** Original protocol sentences are for the model; show the person's version in the transcript. */
export function hyperToolResultForPerson(result: string): string { return outcomeForPerson(hyperToolAnswer(result)); }
/** A tool response means it answered. Its outcome determines whether the requested action happened. */
export function hyperToolOutcome(result: string | undefined, running: boolean): HyperToolMessageProps['status'] {
  if (result === undefined) return running ? 'running' : 'not-yet';
  const answer = hyperToolAnswer(result).trim();
  if (declinedByPerson(answer) || answer.startsWith('Refused.')) return 'refused';
  if (doneByPerson(answer)) return 'by-you';
  if (answer === ALREADY_WAITING || answer === OUTCOME_UNKNOWN || answer === NOT_DONE || answer.startsWith('Not done:') || answer.startsWith('Not run:')) return 'not-yet';
  if (answer.startsWith('Error:')) return 'failed';
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
