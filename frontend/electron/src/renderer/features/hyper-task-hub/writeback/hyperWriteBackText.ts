// Messages for write-back outcomes (M5 E1.5, E1.10). The wording follows the spec's tables; every message
// names the write's own source.
import type { HyperHubStatusPreview, HyperHubStatusRejectCode, HyperHubWriteSource } from '@shared/HyperTaskHub';

const name: Record<HyperHubWriteSource, string> = { jira: 'Jira', newsletter: 'Newsletter' };

/** Why a preview or a send was refused. */
export function hyperWriteRejectText(code: HyperHubStatusRejectCode | 'rejected' | (string & {}), source: HyperHubWriteSource): string {
  const s = name[source];
  switch (code) {
    case 'disabled': return `Status changes in ${s} are off. Turn them on in Settings → Task Hub.`;
    case 'offline': return `Status changes need a live connection to ${s}.`;
    case 'forbidden': return `You don't have permission to make this change in ${s}.`;
    case 'reconnect': return `You don't have permission. Reconnect ${s} in Settings → Connections.`;
    case 'not-found': return `This ${source === 'jira' ? 'issue' : 'task'} is unavailable.`;
    case 'not-leaf': return 'This is a parent row. Its status comes from its subtasks, so change it in Newsletter.';
    case 'unsupported': return `Task Hub can't change this in ${s}. Open it in ${s}.`;
    case 'held': return `Task Hub is still waiting to confirm an earlier change to this in ${s}.`;
    case 'no-actions': return `Your ${s} account has no status change available here.`;
    case 'scope-changed': return 'Your account or workspace changed. Nothing was sent.';
    case 'revision-conflict': return 'Task Hub changed while you were working. Try again.';
    case 'access-denied': return `That ${s} record is no longer available to you.`;
    case 'unavailable': return 'Task Hub is unavailable right now. Nothing was sent.';
    case 'rejected': return `${s} didn't accept this change. Open it in ${s} to finish.`;
    case 'invalid': return 'That change is not allowed.';
    default: return `${s} could not be updated.`;
  }
}

/** The conflict alert (E1.10): the source changed between the preview and the send. */
export function hyperWriteConflictText(preview: HyperHubStatusPreview): string {
  const label = preview.target.key ?? preview.target.title;
  return `${label} changed in ${name[preview.source]} since you opened this. It's now ${preview.current.name}.`;
}
