// Command palette entries for Task Hub (spec D9.1): "Task Hub: Do this first", "Task Hub: Triage" and
// "Prep: <next meeting>". They only navigate; none of them changes a task.
import { useEffect, useMemo } from 'react';
import { useHyperHubBriefRequest } from './brief/useHyperHubBriefRequest';
import { hyperOpenTaskHub } from './HyperTaskHubNavigation';
import { hyperSelectMeetings, hyperSelectToday } from './state/HyperTaskHubSelectors';
import { useHyperTaskHub } from './state/useHyperTaskHub';

export interface HyperTaskHubCommand {
  id: 'do-first' | 'triage' | 'prep';
  label: string;
  detail?: string;
  run: () => void;
}

const hyperCommandWords = ['task hub', 'do this first', 'triage', 'prep', 'meeting', 'focus'];

/** The Task Hub commands to show for a palette query; all of them when the query is empty. */
export function useHyperTaskHubCommands(query: string | null | undefined): HyperTaskHubCommand[] {
  const snapshot = useHyperTaskHub(s => s.snapshot);
  useEffect(() => { if (!useHyperTaskHub.getState().snapshot) void useHyperTaskHub.getState().load(); }, []);
  const commands = useMemo<HyperTaskHubCommand[]>(() => {
    const ready = !!snapshot?.settings.setupComplete;
    const today = snapshot && ready ? hyperSelectToday(snapshot) : null;
    const triage = snapshot?.tasks.filter(task => task.state === 'review').length ?? 0;
    const now = Date.now();
    const meeting = snapshot && ready ? hyperSelectMeetings(snapshot, { now: { kind: 'instant', iso: new Date(now).toISOString() } })
      .find(item => Date.parse(item.agendaItem.interval.start.iso) > now) ?? null : null;
    const list: HyperTaskHubCommand[] = [
      { id: 'do-first', label: 'Task Hub: Do this first', detail: today?.recommendation?.task.title ?? (ready ? undefined : 'Set up Task Hub'), run: () => hyperOpenTaskHub('focus') },
      { id: 'triage', label: 'Task Hub: Triage', detail: triage ? `${triage} to triage` : undefined, run: () => hyperOpenTaskHub('board') },
    ];
    if (meeting && !meeting.agendaItem.private) {
      list.push({ id: 'prep', label: `Prep: ${meeting.agendaItem.title ?? 'next meeting'}`, run: () => { useHyperHubBriefRequest.getState().open(meeting.agendaItem.id); hyperOpenTaskHub(); } });
    }
    return list;
  }, [snapshot]);
  const needle = query?.trim().toLocaleLowerCase() ?? '';
  if (!needle) return commands;
  // Show the commands for Task Hub words, and Prep when the meeting's name matches.
  return commands.filter(command => command.label.toLocaleLowerCase().includes(needle) || (needle.length >= 3 && hyperCommandWords.some(word => word.startsWith(needle))));
}
