// Ported from bot-hq (web/src/components/Transcript.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useEffect, useRef } from 'react';
import { LoaderCircle, Volume2, VolumeX } from 'lucide-react';
import type { HyperBotConfig, HyperBotsDelivery, HyperBotsMessage, HyperBotsReplyPreview, HyperBotsRunSummary, HyperBotsSnapshot } from '@shared/HyperBots';
import { cn } from '@/lib/utils';
import { useHyperBotReadAloud } from './HyperBotReadAloud';
import { HyperBotAttachmentLink } from './HyperBotAttachmentLink';
import { HyperMarkdown } from './HyperMarkdown';
import { HyperBotAvatarFor, HyperBotMembersAvatar } from './HyperBotAvatar';
import { HyperBotsApprovalCard, HyperBotsDecided } from './HyperBotApproval';
import { hyperBotDescription } from './HyperBotSettings';
const clock = (iso: string) => { const date = new Date(iso); return isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
const author = (message: HyperBotsMessage) => message.author.kind === 'user' ? 'user' : message.author.botId;
type HyperBotMessageGroup = { key: string; date: string; divider: boolean; messages: HyperBotsMessage[] };
export function hyperBotMessageGroups(messages: HyperBotsMessage[]): HyperBotMessageGroup[] {
  const groups: HyperBotMessageGroup[] = [];
  for (const message of messages) {
    const last = groups.at(-1), previous = last?.messages.at(-1);
    const gap = previous ? Date.parse(message.createdAt) - Date.parse(previous.createdAt) : Infinity;
    const day = new Date(message.createdAt).toLocaleDateString();
    const divider = !previous || gap > 3600000 || day !== new Date(previous.createdAt).toLocaleDateString();
    if (last && previous && !divider && author(previous) === author(message) && gap < 300000) last.messages.push(message);
    else groups.push({ key: message.id, date: day, divider, messages: [message] });
  }
  return groups;
}
/** Each failure stays after the message group begun before it failed, so an old one never reads as the latest news. '' = after everything. */
export function hyperBotFailuresByGroup(groups: HyperBotMessageGroup[], runs: HyperBotsRunSummary[]) {
  const placed = new Map<string, HyperBotsRunSummary[]>();
  for (const run of runs) {
    if (run.status !== 'failed') continue;
    let key = '';
    for (const group of groups) if (Date.parse(group.messages[0]!.createdAt) <= Date.parse(run.updatedAt)) key = group.key;
    if (key === groups.at(-1)?.key) key = '';
    placed.set(key, [...placed.get(key) ?? [], run]);
  }
  return placed;
}
export function HyperBotTranscript({ snapshot, previews, bot, name, members, deciding, onDecide }: { snapshot: HyperBotsSnapshot; previews?: HyperBotsReplyPreview[]; bot?: HyperBotConfig; name: string; members: HyperBotConfig[]; deciding: string[]; onDecide: (id: string, approved: boolean, delivery?: HyperBotsDelivery) => void }) {
  const speech = useHyperBotReadAloud();
  const end = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), nearBottom = useRef(true);
  const pending = snapshot.approvals.filter(row => row.status === 'pending'), decided = snapshot.approvals.filter(row => row.status !== 'pending');
  const last = snapshot.messages.at(-1)?.id, waiting = pending.map(row => row.id).join();
  useEffect(() => { nearBottom.current = true; end.current?.scrollIntoView?.({ block: 'end' }); }, [snapshot.roomId]);
  const roomPreviews = previews?.filter(row => row.roomId === snapshot.roomId) ?? [];
  const previewLength = roomPreviews.reduce((total, row) => total + row.text.length, 0);
  useEffect(() => { if (nearBottom.current) end.current?.scrollIntoView?.({ block: 'end' }); }, [last, waiting, previewLength]);
  const botName = (id: string) => snapshot.settings.bots.find(row => row.id === id)?.name ?? id;
  const groups = hyperBotMessageGroups(snapshot.messages), failures = hyperBotFailuresByGroup(groups, snapshot.runs);
  // Only the latest failures announce themselves; earlier ones are history.
  const failure = (run: HyperBotsRunSummary, latest: boolean) => <p key={run.id} role={latest ? 'alert' : undefined} className="notice is-error">{botName(run.botId)} could not finish{run.error ? ': ' + run.error : '.'}</p>;
  return <div className="transcript-wrap"><div className="transcript" ref={scroll} role="log" aria-label={name + ' conversation'} onScroll={() => { const element = scroll.current; if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}><div className="transcript__col">
    {!snapshot.messages.length && <div className="empty-chat">{bot ? <HyperBotAvatarFor bot={bot} size={64} /> : <HyperBotMembersAvatar bots={members} size={64} />}<h2 className="empty-chat__title">{name}</h2><p className="empty-chat__sub">{bot ? hyperBotDescription(bot) : 'A shared conversation with ' + members.map(member => member.name).join(', ') + '.'}</p></div>}
    {groups.map(group => { const first = group.messages[0]!, user = first.author.kind === 'user', sender = first.author.kind === 'bot' ? snapshot.settings.bots.find(row => row.id === author(first)) : undefined;
      return <div className="transcript-group" key={group.key}>{group.divider && <div className="divider">{group.date}</div>}<div className={cn('group', user ? 'is-right' : 'is-left')}>
        {!bot && !user && sender && <div className="sender-label"><HyperBotAvatarFor bot={sender} size={16} /><span>{sender.name}</span></div>}
        {group.messages.map((message, index) => <article key={message.id} className={cn('bubble-wrap', user ? 'is-right' : 'is-left')} aria-label={user ? message.scheduled ? 'Scheduled routine' : 'You' : botName(message.author.kind === 'bot' ? message.author.botId : '')} tabIndex={0}>
          <div className={cn('bubble', user ? 'is-user' : 'is-agent', group.messages.length > 1 && (index === 0 ? 'is-first' : index === group.messages.length - 1 ? 'is-last' : 'is-mid'))}>
            {message.scheduled && <span className="bubble__model">Scheduled routine</span>}
            {message.model && <span className="bubble__model">{message.model}</span>}
            {user ? (message.text && <p className="bubble__plain [unicode-bidi:plaintext] text-start">{message.text}</p>) : <HyperMarkdown content={message.text} className="md [&_li]:[unicode-bidi:plaintext] [&_p]:[unicode-bidi:plaintext] [&_li]:text-start [&_p]:text-start" />}
            {message.attachments?.length ? <ul aria-label="Attachments">{message.attachments.map((file, i) => <HyperBotAttachmentLink key={file.id + i} messageId={message.id} file={file} />)}</ul> : null}
          </div>{!user && speech.available && <button type="button" aria-label={speech.reading === message.id ? 'Stop reading' : 'Read reply aloud'} title={speech.reading === message.id ? 'Stop reading' : 'Read reply aloud'} className="icon-btn size-6" onClick={() => speech.read(message.id, message.text)}>{speech.reading === message.id ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>}<time dateTime={message.createdAt} className="bubble__time">{clock(message.createdAt)}</time>
        </article>)}
      </div>{failures.get(group.key)?.map(run => failure(run, false))}</div>;
    })}
    {roomPreviews.map(row => <article key={row.runId} aria-label={botName(row.botId) + ' is replying'} aria-live="off" className="group is-left">
      {!bot && <div className="sender-label">{botName(row.botId)}</div>}
      <div className="bubble is-agent"><HyperMarkdown content={row.text} className="md" /></div>
    </article>)}
    {failures.get('')?.map(run => failure(run, true))}
    {snapshot.runs.filter(run => ['queued', 'running', 'waiting_approval'].includes(run.status)).map(run => <p key={run.id} role="status" className="run-status">{run.status !== 'waiting_approval' && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />}{botName(run.botId)}{run.status === 'waiting_approval' ? ' is waiting for your approval' : ' is working…'}</p>)}
    {pending.length > 0 && <section aria-label="Waiting for you" className="approval-section"><h2 className="section-label">Waiting for you</h2>{pending.map(approval => <HyperBotsApprovalCard key={approval.id} approval={approval} botName={botName(approval.botId)} busy={deciding.includes(approval.id)} onDecide={onDecide} />)}</section>}
    {decided.length > 0 && <HyperBotsDecided approvals={decided} settings={snapshot.settings} />}<div ref={end} />
  </div></div></div>;
}
