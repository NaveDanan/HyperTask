// Copyright (c) 2026 CopilotKit. MIT. See LICENSE and REUSE.md.
import { Button } from '@/components/ui/button';
import { HyperToolActivity, type HyperToolStep } from './HyperToolActivity';
export interface HyperCommandOutputProps { output: string; exitCode?: number; truncated?: boolean; timedOut?: boolean }
export function HyperCommandOutput({ output, exitCode, truncated, timedOut }: HyperCommandOutputProps) {
  return <div className="space-y-2">
    {truncated && <p className="text-xs text-muted-foreground">The output was too long. This is the end of it.</p>}
    {output ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{output}</pre> : <p className="text-xs italic text-muted-foreground">It printed nothing.</p>}
    {timedOut && <p className="text-xs text-destructive">It ran too long and was stopped.</p>}
    {typeof exitCode === 'number' && exitCode !== 0 && <p className="text-xs text-warning">Exit code {exitCode}.</p>}
  </div>;
}
export interface HyperComputerDetailProps { title: string; steps: readonly HyperToolStep[]; screenshotUrl?: string; screenshotAlt?: string; controlling?: boolean; pending?: boolean; error?: string | null; onTakeControl?: () => void; onResume?: () => void }
export function HyperComputerDetail({ title, steps, screenshotUrl, screenshotAlt = 'Current computer screen', controlling, pending, error, onTakeControl, onResume }: HyperComputerDetailProps) {
  return <section aria-label={title} className="space-y-3 rounded-xl border border-border bg-card p-4 text-foreground">
    <header className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{title}</h3>{controlling ? onResume && <Button disabled={pending} onClick={onResume}>Resume Bot</Button> : onTakeControl && <Button variant="outline" disabled={pending} onClick={onTakeControl}>Take control</Button>}</header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {screenshotUrl && <img src={screenshotUrl} alt={screenshotAlt} className="max-h-96 w-full rounded-lg border border-border object-contain" />}
    <HyperToolActivity steps={steps} title="Computer activity" defaultOpen />
    {!steps.length && <p className="text-sm text-muted-foreground">No computer activity yet.</p>}
  </section>;
}
