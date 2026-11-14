// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { hyperOpenBotRequest } from '../transport';
import { HyperListBots, type HyperBotProfile } from '../bots/HyperBotsApi';
import { HyperReadCapabilities, HyperReadUser, HyperSaveOnboarding, HyperSaveOnboardingName, type HyperOnboardingUser } from './HyperOnboardingApi';
import { HyperNativeDestination } from './HyperSetupSection';
export default function HyperHomeSection({ context }: { context: HyperOpenBotSectionContext }) {
  const [user, setUser] = useState<HyperOnboardingUser | null>();
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof HyperReadCapabilities>>>();
  const [bots, setBots] = useState<HyperBotProfile[]>([]);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [enabled, setEnabled] = useState<boolean>();
  const load = async () => {
    setError('');
    try { const [me, capabilities, agents] = await Promise.all([HyperReadUser(), HyperReadCapabilities(), HyperListBots(false)]); setUser(me); setName(me?.needsName ? '' : me?.name ?? ''); setStep(me?.onboarding?.step || 1); setCaps(capabilities); setBots(agents); } catch { setError("Couldn't load your setup. Try again to continue."); }
  };
  useEffect(() => { void load(); void hyperOpenBotRequest<{ enabled: boolean }>('/api/approvals').then(value => setEnabled(value.enabled)).catch(() => {}); }, []);
  const action = async (run: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await run(); } catch { setError("Couldn't save your changes. Try again."); } finally { lock.current = false; setBusy(false); } };
  const onboarding = user?.onboarding && !user.onboarding.completedAt;
  const needsName = user?.needsName || !user?.name || user.name === user.email;
  const steps = [1, ...(caps?.localEvaluation ? [2] : []), ...(needsName ? [3] : [])];
  const current = steps.includes(step) ? step : steps[steps.length - 1];
  const move = async (next: number) => { const me = await HyperSaveOnboarding({ step: next }); setUser(me); setStep(next); };
  return <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
    {error ? <><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></> : null}
    {user === undefined ? <p role="status">Loading…</p> : !user ? <p role="alert">OpenBot session unavailable. Reconnect through HyperTask's native account settings.</p> : onboarding ? <>
      <h1 className="text-lg font-semibold">{current === 1 ? 'Welcome to HyperTask' : current === 2 ? 'OpenBot for Business' : 'What should we call you?'}</h1>
      {current === 1 ? <><p>Give work to Bots in plain words. They tell you when it's done.</p><h2 className="text-sm font-medium">Choose when Bots ask</h2><p className="text-sm text-muted-foreground">Sensitive actions always ask. Extra vigilant also asks before routine changes.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled ?? false} disabled={enabled === undefined || busy} onChange={event => { const value = event.target.checked; void action(async () => { await hyperOpenBotRequest('/api/approvals/preferences', 'PATCH', { enabled: value }); setEnabled((await hyperOpenBotRequest<{ enabled: boolean }>('/api/approvals')).enabled); }); }} />Extra vigilant</label>{enabled === undefined ? <p role="status">Couldn't load this setting. You can change it later in Settings.</p> : null}</> : current === 2 ? <><p>Bring OpenBot to your whole team, on your own servers.</p><a href="https://openbot.ai/business" target="_blank" rel="noreferrer">Book a demo in your browser</a></> : <label className="flex flex-col gap-2">Name<Input maxLength={100} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>}
      <div className="flex gap-2"><Button variant="outline" disabled={busy || current === 1} onClick={() => void action(() => move(steps[steps.indexOf(current) - 1]))}>Back</Button><Button disabled={busy || !caps || current === 3 && !name.trim()} onClick={() => void action(async () => {
        const next = steps[steps.indexOf(current) + 1]; if (next) { await move(next); return; }
        if (current === 3) await HyperSaveOnboardingName(name);
        setUser(await HyperSaveOnboarding({ completed: true })); setBots(await HyperListBots(false));
      })}>{busy ? 'Saving…' : current === steps[steps.length - 1] ? 'Get started' : current === 2 ? 'Not now' : 'Continue'}</Button></div>
    </> : <><h1 className="text-lg font-semibold">{user.name && !user.needsName ? `Hi ${user.name}, what would you like to work on?` : 'Start a conversation'}</h1>{bots.length ? bots.slice(0, 4).map(bot => <Button key={bot.id} variant="outline" onClick={() => context.startConversation([bot.id])}>{bot.name}</Button>) : <p>No Bots available.</p>}<h2 className="text-sm font-medium">Explore HyperTask</h2>{['/bots', '/skills', '/connections', '/routines', '/computer-browser', '/settings'].map(path => <HyperNativeDestination key={path} path={path} context={context} />)}</>}
  </section>;
}
