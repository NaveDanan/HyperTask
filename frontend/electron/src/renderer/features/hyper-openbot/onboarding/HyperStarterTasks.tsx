// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest } from '../transport';
import { HyperReadCapabilities, HyperReadUser } from './HyperOnboardingApi';
import { HYPER_STARTER_SUGGESTIONS, HYPER_INTERACTIVE_STARTER, HyperIsStarterTourAgent, HyperShowStarterTour } from './HyperStarterSuggestions';

/** Pass the native composer's send handler. Rejections keep the choices retryable. */
export function HyperStarterTasks({ agentId, channelId, disabled = false, onSelect }: {
  agentId?: string; channelId?: string; disabled?: boolean; onSelect(message: string): unknown | Promise<unknown>;
}) {
  const [eligible, setEligible] = useState(false);
  const [interactive, setInteractive] = useState<boolean>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setEligible(false);
      if (!agentId || !HyperIsStarterTourAgent(agentId)) return;
      try {
        const user = await HyperReadUser();
        if (!user) return;
        const { preferences } = await hyperOpenBotRequest<{ preferences: { starterTourChannelId?: string } }>('/api/settings/preferences');
        if (active) setEligible(HyperShowStarterTour(preferences, channelId));
      } catch { /* Unread preferences must never offer an already claimed tour. */ }
    };
    void load();
    void HyperReadCapabilities().then(caps => { if (active) setInteractive(caps.generativeUi); }).catch(() => { if (active) setInteractive(false); });
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [agentId, channelId]);
  if (!eligible) return null;
  return <section aria-label="Starter tasks" className="flex flex-col gap-2">
    <div className="flex flex-wrap gap-2">{HYPER_STARTER_SUGGESTIONS.map(suggestion => <Button key={suggestion.title} variant="outline" disabled={disabled || sending} onClick={() => {
      if (disabled || lock.current) return;
      setError('');
      if (suggestion === HYPER_INTERACTIVE_STARTER && interactive !== true) {
        setError(interactive === undefined ? 'Still checking whether interactive answers are available. Try again in a moment.' : 'Interactive answers are disabled for this installation. Try another starter task.');
        return;
      }
      lock.current = true; setSending(true);
      void Promise.resolve().then(() => onSelect(suggestion.message)).catch(() => setError("Couldn't start that task. Try again.")).finally(() => { lock.current = false; setSending(false); });
    }}>{suggestion.title}</Button>)}</div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}
