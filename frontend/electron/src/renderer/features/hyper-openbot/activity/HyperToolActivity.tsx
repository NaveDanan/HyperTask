// Copyright (c) 2026 CopilotKit. MIT. See LICENSE and REUSE.md.
import { type ReactNode } from 'react';
import { Badge } from '@/components/reui/badge';
export type HyperToolStatus = 'running' | 'completed' | 'failed' | 'waiting' | 'denied';
export interface HyperToolStep { id: string; label: string; subject?: string; status: HyperToolStatus; detail?: ReactNode; at?: number; approval?: ReactNode }
export interface HyperToolActivityProps { steps: readonly HyperToolStep[]; title?: string; defaultOpen?: boolean }
/** Approval cards deliberately stay outside disclosures, as in upstream PendingApprovals. */
export function HyperToolActivity({ steps, title, defaultOpen = false }: HyperToolActivityProps) {
  if (!steps.length) return null;
  return <section aria-label="Tool activity" className="space-y-2 text-foreground">
    <details open={defaultOpen || undefined} className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer p-3 text-sm font-medium">{title ?? `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}</summary>
      <ol className="space-y-2 border-t border-border p-3">{steps.map(step => <li key={step.id}>
        <details className="rounded-md bg-muted/50 p-2">
          <summary className="cursor-pointer text-sm"><span>{step.label}</span>{step.subject && <span className="ml-2 break-all text-muted-foreground">{step.subject}</span>} <Badge size="sm" variant={step.status === 'failed' || step.status === 'denied' ? 'destructive-light' : step.status === 'completed' ? 'success-light' : 'secondary'}>{step.status}</Badge>{step.at !== undefined && <time className="ml-2 text-xs text-muted-foreground" dateTime={new Date(step.at).toISOString()}>{new Date(step.at).toLocaleTimeString()}</time>}</summary>
          <div className="mt-2 text-sm">{step.detail ?? <p className="text-muted-foreground">No additional details.</p>}</div>
        </details>
      </li>)}</ol>
    </details>
    {steps.map(step => step.approval ? <div key={step.id}>{step.approval}</div> : null)}
  </section>;
}
