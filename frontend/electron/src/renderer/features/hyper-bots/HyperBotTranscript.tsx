// Ported from bot-hq (web/src/components/Transcript.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { Fragment, memo, useEffect, useLayoutEffect, useRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { HyperBotConfig, HyperBotsApi, HyperBotsDelivery, HyperBotsMessage, HyperBotsRunSummary, HyperBotsSnapshot } from '@shared/HyperBots';
import { cn } from '@/lib/utils';
import { HyperMarkdown } from '@/features/hyper-openbot/transcript/HyperMarkdown';
import { HyperBotAvatarFor, HyperBotMembersAvatar } from './HyperBotAvatar';
import { HyperBotTurnTools } from './HyperBotApproval';
import { HyperBotRichText } from './HyperBotMentionPopover';
import { hyperBotDescription } from './HyperBotSettings';
import { HyperBotA2ui } from './HyperBotA2ui';
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat();
const clock = (iso: string) => { const date = new Date(iso); return isNaN(date.getTime()) ? '' : timeFormat.format(date); };
const MessageMarkdown = memo(HyperMarkdown);
const author = (message: HyperBotsMessage) => message.author.kind === 'user' ? 'user' : message.author.botId;
type HyperBotMessageGroup = { key: string; date: string; divider: boolean; messages: HyperBotsMessage[] };
export function hyperBotMessageGroups(messages: HyperBotsMessage[]): HyperBotMessageGroup[] {
  const groups: HyperBotMessageGroup[] = [];
  for (const message of messages) {
    const last = groups.at(-1), previous = last?.messages.at(-1);
    const gap = previous ? Date.parse(message.createdAt) - Date.parse(previous.createdAt) : Infinity;
    const day = dateFormat.format(new Date(message.createdAt));
    const divider = !previous || gap > 3600000 || day !== last?.date;
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
export function HyperBotTranscript({ snapshot, bot, name, members, deciding, onDecide, onAction, loadEarlier, loadingEarlier }: { snapshot: HyperBotsSnapshot; bot?: HyperBotConfig; name: string; members: HyperBotConfig[]; deciding: string[]; onDecide: (id: string, approved: boolean, delivery?: HyperBotsDelivery) => void; onAction?: HyperBotsApi['act']; loadEarlier?: () => void; loadingEarlier?: boolean }) {
  const end = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), nearBottom = useRef(true);
  const column = useRef<HTMLDivElement>(null);
  const pending = snapshot.approvals.filter(row => row.status === 'pending');
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const earlier = () => {
    const element = scroll.current?.querySelector<HTMLElement>('article');
    if (element?.dataset.messageId) anchor.current = { id: element.dataset.messageId, top: element.getBoundingClientRect().top };
    loadEarlier?.();
  };
  useLayoutEffect(() => {
    if (!loadingEarlier && anchor.current) {
      const { id, top } = anchor.current;
      const element = scroll.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
      if (scroll.current && element) scroll.current.scrollTop += element.getBoundingClientRect().top - top;
      anchor.current = null;
    }
  }, [loadingEarlier, snapshot.messages]);
  const last = snapshot.messages.at(-1)?.id, waiting = pending.map(row => row.id).join();
  useEffect(() => { nearBottom.current = true; end.current?.scrollIntoView?.({ block: 'end' }); }, [snapshot.roomId]);
  useEffect(() => { if (nearBottom.current) end.current?.scrollIntoView?.({ block: 'end' }); }, [last, waiting]);
  useEffect(() => {
    if (!column.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) end.current?.scrollIntoView({ block: 'end' });
    });
    observer.observe(column.current);
    return () => observer.disconnect();
  }, []);
  const botName = (id: string) => snapshot.settings.bots.find(row => row.id === id)?.name ?? id;
  const groups = hyperBotMessageGroups(snapshot.messages), failures = hyperBotFailuresByGroup(groups, snapshot.runs);
  const visible = new Set(snapshot.messages.map(message => message.id));
  const replies = new Map(snapshot.messages.filter(message => message.runId).map(message => [message.runId, message.id]));
  const anchors = new Map(snapshot.runs.map(run => [run.id, visible.has(run.triggerMessageId) ? run.triggerMessageId : replies.get(run.id)]));
  const byMessage = new Map<string | undefined, typeof snapshot.approvals>();
  for (const approval of snapshot.approvals) {
    const key = approval.turnId ? (visible.has(approval.turnId) ? approval.turnId : undefined) : anchors.get(approval.runId);
    const list = byMessage.get(key);
    if (list) list.push(approval); else byMessage.set(key, [approval]);
  }
  const toolsAt = (id?: string) => {
    const approvals = byMessage.get(id);
    return approvals && <HyperBotTurnTools approvals={approvals} settings={snapshot.settings} deciding={deciding} onDecide={onDecide} />;
  };
  // Only the latest failures announce themselves; earlier ones are history.
  const failure = (run: HyperBotsRunSummary, latest: boolean) => <p key={run.id} role={latest ? 'alert' : undefined} className="notice is-error">{botName(run.botId)} could not finish{run.error ? ': ' + run.error : '.'}</p>;
  return <div className="transcript-wrap"><div className="transcript" ref={scroll} role="log" aria-label={name + ' conversation'} onScroll={() => { const element = scroll.current; if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}><div className="transcript__col" ref={column}>
    {snapshot.hasEarlier && <button className="hb-history-link" type="button" onClick={earlier} disabled={loadingEarlier}>{loadingEarlier ? 'Loading…' : 'Load earlier messages'}</button>}
    {!snapshot.messages.length && <div className="empty-chat">{bot ? <HyperBotAvatarFor bot={bot} size={64} /> : <HyperBotMembersAvatar bots={members} size={64} />}<h2 className="empty-chat__title">{name}</h2><p className="empty-chat__sub">{bot ? hyperBotDescription(bot) : 'A shared conversation with ' + members.map(member => member.name).join(', ') + '.'}</p></div>}
    {groups.map(group => { const first = group.messages[0]!, user = first.author.kind === 'user', sender = first.author.kind === 'bot' ? snapshot.settings.bots.find(row => row.id === author(first)) : undefined;
      return <div className="transcript-group" key={group.key}>{group.divider && <div className="divider">{group.date}</div>}<div className={cn('group', user ? 'is-right' : 'is-left')}>
        {!bot && !user && sender && <div className="sender-label"><HyperBotAvatarFor bot={sender} size={16} /><span>{sender.name}</span></div>}
        {group.messages.map((message, index) => <Fragment key={message.id}><article data-message-id={message.id} className={cn('bubble-wrap', user ? 'is-right' : 'is-left', !user && message.a2ui && 'has-a2ui')} aria-label={user ? 'You' : botName(message.author.kind === 'bot' ? message.author.botId : '')} tabIndex={0}>
          <div className={cn('bubble', user ? 'is-user' : 'is-agent', group.messages.length > 1 && (index === 0 ? 'is-first' : index === group.messages.length - 1 ? 'is-last' : 'is-mid'))}>
            {message.model && !message.interaction && <span className="bubble__model">{message.model}</span>}
            {user ? <p className="bubble__plain [unicode-bidi:plaintext] text-start">{message.interaction ? message.text : <HyperBotRichText text={message.text} bots={snapshot.settings.bots} />}</p> : <MessageMarkdown content={message.text} className="md [&_li]:[unicode-bidi:plaintext] [&_p]:[unicode-bidi:plaintext] [&_li]:text-start [&_p]:text-start" />}
          </div><time dateTime={message.createdAt} className="bubble__time">{clock(message.createdAt)}</time>
          {!user && message.a2ui && <HyperBotA2ui roomId={message.roomId} messageId={message.id} messages={message.a2ui} onAction={onAction} />}
        </article>{toolsAt(message.id)}</Fragment>)}
      </div>{failures.get(group.key)?.map(run => failure(run, false))}</div>;
    })}
    {failures.get('')?.map(run => failure(run, true))}
    {snapshot.runs.filter(run => ['queued', 'running', 'waiting_approval'].includes(run.status)).map(run => {
      const request = pending.find(row => row.runId === run.id);
      return <div key={run.id} className="run-status"><span role="status">{run.status !== 'waiting_approval' && <LoaderCircle size={14} className="inline animate-spin motion-reduce:animate-none" />}{botName(run.botId)}{run.status === 'waiting_approval' ? ' is waiting for your approval' : ' is working…'}</span>
        {request && <button type="button" className="link-btn underline" onClick={() => {
          const card = scroll.current?.querySelector<HTMLElement>(`#hyper-bot-request-${CSS.escape(request.id)}`);
          card?.focus({ preventScroll: true }); card?.scrollIntoView({ block: 'center' });
        }}>Review request</button>}
      </div>;
    })}
    {toolsAt()}<div ref={end} />
  </div></div></div>;
}
