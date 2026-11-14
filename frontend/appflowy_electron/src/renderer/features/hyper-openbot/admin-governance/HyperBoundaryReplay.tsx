// Adapted from OpenBot components/boundaries/{rule-preview,dry-run-changes} and boundaries_.$index.
// Copyright (c) 2026 CopilotKit. MIT licensed.
import { HyperEvidence } from './HyperEvidence';
export type HyperReplayReport = { report: { scanned: number; wouldRefuse: number; wouldAllow: number; unchanged: number; changes: { id: string; would: string; [key: string]: unknown }[] } };
export function HyperBoundaryReplay({ value, saved = false }: { value: unknown; saved?: boolean }) {
  const report = (value as HyperReplayReport)?.report;
  if (!report) return <HyperEvidence value={value} />;
  const count = saved ? report.wouldAllow : report.wouldRefuse;
  const changes = report.changes.filter(change => change.would === (saved ? 'allowed' : 'refused'));
  return <div className="grid gap-2"><p>{report.scanned === 0 ? 'No recorded actions to test against yet.' : saved ? `This rule stopped ${count} of the last ${report.scanned} recorded actions.` : `This rule would have stopped ${count} of the last ${report.scanned} recorded actions. It may also stop future actions.`}</p>{changes.length > 0 && <HyperEvidence value={changes} />}{count > changes.length && <p>Showing {changes.length} of {count} matches. The counts cover every scanned action.</p>}</div>;
}
