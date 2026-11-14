// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// components/edition/{for-a-team,team-features-dialog,business-link,business-orb,brand-name}.tsx
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export const HYPER_TEAM_FEATURES = [
  ['For your whole team', ['Sign-in with Google, Microsoft or custom SSO', 'People, roles and admins', 'Bots shared with your whole team', 'Learning shared across the team']],
  ['Where your Bots work', ['Bots in Slack and Microsoft Teams', 'A computer for each Bot']],
  ['In control', ['Controls over models, apps and networks', 'Rules every Bot follows', 'Policies in plain English, tested on past activity', 'Governance for everyone', 'A full audit trail, with export']],
] as const;
export function HyperSettingsEdition({ edition, children }: { edition?: 'personal' | 'team'; children?: ReactNode }) {
  const [open, setOpen] = useState(false); const [dismissed, setDismissed] = useState(false);
  if (edition !== 'personal' || dismissed) return null;
  return <div className="flex flex-col gap-2"><div className="flex gap-2"><Button variant="outline" onClick={() => setOpen(true)}>Meet OpenBot for Business</Button><Button variant="ghost" aria-label="Dismiss business offer" onClick={() => setDismissed(true)}>Dismiss</Button></div>{children}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>OpenBot for Business</DialogTitle><DialogDescription>Deploy in your own VPC on AWS, Azure or GCP, on-prem, or on OpenBot Cloud.</DialogDescription></DialogHeader>{HYPER_TEAM_FEATURES.map(([title, features]) => <section key={title}><h3 className="text-sm font-medium">{title}</h3><ul className="list-inside list-disc text-sm">{features.map(feature => <li key={feature}>{feature}</li>)}</ul></section>)}<p className="text-sm text-muted-foreground">Book a demo to pick a time or scope a proof of concept.</p><a href="https://open.bot/business" target="_blank" rel="noopener noreferrer" className="text-sm underline">Book a demo in your browser</a></DialogContent></Dialog>
  </div>;
}
export function HyperForATeam({ edition, children }: { edition?: 'personal' | 'team'; children?: ReactNode }) {
  if (edition === undefined) return <p role="status">Loading edition…</p>;
  if (edition === 'team') return children;
  return <div className="flex flex-col gap-3"><h2 className="text-sm font-medium">For a team</h2><p className="text-sm text-muted-foreground">This applies when OpenBot runs for a team.</p><HyperSettingsEdition edition={edition} /></div>;
}
