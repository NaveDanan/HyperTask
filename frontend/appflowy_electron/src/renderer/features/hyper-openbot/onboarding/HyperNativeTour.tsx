// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HyperNativeDestination } from './HyperSetupSection';
const hyperTourStops = [
  { title: 'Give work to Bots', detail: 'Choose a Bot, describe a task, and follow its progress in a conversation.', path: '/bots' },
  { title: 'Teach a Bot', detail: 'Skills give Bots reusable instructions for your work.', path: '/skills' },
  { title: 'Connect your apps', detail: 'Connect an account so your Bots can work with the apps you use.', path: '/connections' },
  { title: 'Use a computer', detail: 'Bots can browse and work on their own computer. Sensitive actions ask for your approval.', path: '/computer-browser' },
  { title: 'Work with your team', detail: 'Share Bots with your organization and run recurring work with routines.', path: '/routines' },
  { title: 'Choose when Bots ask', detail: 'Change approval preferences in Settings. Sensitive actions always ask.', path: '/settings' },
];
export function HyperNativeTour({ context }: { context: HyperOpenBotSectionContext }) {
  const [at, setAt] = useState<number>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (at !== undefined) heading.current?.focus(); }, [at]);
  if (at === undefined) return <Button variant="outline" onClick={() => setAt(0)}>Take a tour of HyperTask</Button>;
  const stop = hyperTourStops[at];
  return <section aria-label="HyperTask tour" className="flex flex-col gap-3 rounded-lg border p-4">
    <p className="text-xs text-muted-foreground">{at + 1} of {hyperTourStops.length}</p>
    <h2 ref={heading} tabIndex={-1} className="text-base font-semibold">{stop.title}</h2><p className="text-sm">{stop.detail}</p>
    <HyperNativeDestination key={stop.path} context={context} path={stop.path} />
    <div className="flex gap-2"><Button variant="outline" disabled={at === 0} onClick={() => setAt(at - 1)}>Back</Button><Button onClick={() => setAt(at + 1 < hyperTourStops.length ? at + 1 : undefined)}>{at + 1 === hyperTourStops.length ? 'Finish tour' : 'Next'}</Button><Button variant="ghost" onClick={() => setAt(undefined)}>Close tour</Button></div>
  </section>;
}
