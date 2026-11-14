import { useHyperConversationDraft } from '../useHyperConversationDraft';
import { HyperDeliveryControls } from './HyperDeliveryControls';
// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from channels/group-chat.tsx and group-people.tsx. See REUSE.md.
import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { HyperGroupQuestionNotice, hyperReadQuestions, hyperGroupQuestion, hyperQuestionRecipient, hyperAnswerQuestion, hyperDismissQuestion, type HyperWaitingQuestion } from './HyperGroupQuestions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperComposer } from '../composer';
import { HyperMarkdown } from '../transcript/HyperMarkdown';
import { hyperOpenBotRequest as request } from '../transport';
import { hyperReadGroup, hyperSendGroup, hyperGroupPolling, hyperAddGroupMember, hyperRemoveGroupMember, hyperTeamConsent, type HyperConsentDecision, type GroupConversation } from './HyperConversationsApi';

export function HyperTeamConsent({ botId, serverId, message }: { botId: string; serverId: string; message: string }) {
  const [chosen, setChosen] = useState<HyperConsentDecision>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return <div className="space-y-2 rounded-lg border p-3"><p>{message}</p>{chosen ? <p role="status">{chosen === 'skip' ? 'Skipped. Nothing of yours was used.' : 'Allowed. Ask the Bot to try again.'}</p> : <div className="flex flex-wrap gap-2">{(['allow_once', 'allow_always', 'allow_all_team_bots', 'skip'] as const).map((decision, index) => <Button key={decision} disabled={pending} variant="outline" onClick={() => { setPending(true); setError(undefined); void hyperTeamConsent(botId, serverId, decision).then(() => setChosen(decision)).catch(error => setError(String(error))).finally(() => setPending(false)); }}>{['Allow once', 'Always allow for this Bot', 'Always allow for all Team Bots', 'Skip'][index]}</Button>)}</div>}{error && <p role="alert">{error}</p>}</div>;
}
export function HyperGroupChat({ channelId, serviceReady, eventRevision = 0 }: { channelId: string; serviceReady: boolean; eventRevision?: number }) {
  const { draft: heldDraft, updateDraft } = useHyperConversationDraft(channelId);
  const [questions, setQuestions] = useState<HyperWaitingQuestion[]>([]);
  const [questionError, setQuestionError] = useState(false);
  const [data, setData] = useState<GroupConversation>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [me, setMe] = useState<string>();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [address, setAddress] = useState('');
  const retry = useRef<{ text: string; agentId: string | null; id: string } | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const landed = useRef(false);
  useEffect(() => { if (!serviceReady) return; let current = true; void request<{ user: { id: string } }>('/api/me').then(value => { if (current) setMe(value.user.id); }).catch(error => { if (current) setError(String(error)); }); return () => { current = false; }; }, [serviceReady]);
  useEffect(() => {
    if (!serviceReady) return;
    let current = true; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const next = await hyperReadGroup(channelId); if (!current) return; setData(next); setError(undefined); if (hyperGroupPolling(next)) timer = setTimeout(() => void load(), 1500); }
      catch (error) { if (current) setError(String(error)); }
    };
    void load(); return () => { current = false; clearTimeout(timer); };
  }, [channelId, revision, serviceReady, eventRevision]);
  const last = data?.messages.at(-1);
  useLayoutEffect(() => { if (viewport.current && data?.messages.length && (!landed.current || atBottom.current || last?.ownerUserId === me)) { viewport.current.scrollTop = viewport.current.scrollHeight; landed.current = true; } }, [data, me, last]);
  const working = data?.messages.some(message => ['running', 'queued'].includes(message.status));
  useEffect(() => {
    if (!serviceReady) return;
    let current = true;
    const load = async () => { try { const inbox = await hyperReadQuestions(); if (current) { setQuestions(inbox.questions); setQuestionError(false); } } catch { if (current) setQuestionError(true); } };
    void load(); const timer = setInterval(() => void load(), 10_000);
    return () => { current = false; clearInterval(timer); };
  }, [channelId, serviceReady, working, revision]);
  const question = hyperGroupQuestion(questions, channelId);
  async function answer(text: string) {
    if (!question) return;
    await hyperAnswerQuestion(question.id, text);
    setQuestions(value => value.filter(item => item.id !== question.id));
    setRevision(value => value + 1);
  }
  async function mutate(action: () => Promise<unknown>) { setPending(true); setError(undefined); try { await action(); setRevision(value => value + 1); } catch (error) { setError(String(error)); } finally { setPending(false); } }
  if (!data) return <div className="p-6">{error ? <><p role="alert">{error}</p><Button onClick={() => setRevision(value => value + 1)}>Retry</Button></> : <p role="status">Loading conversation…</p>}</div>;
  const creator = data.people.some(person => person.userId === me && person.creator);
  const names = new Map(data.bots.map(bot => [bot.id, bot.name]));
  return <div className="flex h-full min-h-0 flex-col pb-12">
    <div className="flex items-center gap-2 border-b p-2"><span>{data.bots.map(bot => bot.name).join(', ')}</span><Button variant="ghost" onClick={() => setPeopleOpen(value => !value)}>{data.people.length} people</Button><Button variant="ghost" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>
    <HyperDeliveryControls channelId={channelId} bots={data.bots} enabled={serviceReady} />
    {error && <p role="alert" className="p-3 text-destructive">{error}</p>}
    {peopleOpen && <div className="space-y-2 border-b p-3"><p>Everyone here sees the whole conversation.</p>{data.people.map(person => <div key={person.userId} className="flex items-center gap-3"><span>{person.userId === me ? 'You' : person.name ?? person.email}{person.creator ? ' · Started this group' : ''}</span>{(person.userId === me ? !person.creator : creator) && <Button disabled={pending || !serviceReady} variant="outline" onClick={() => void mutate(() => hyperRemoveGroupMember(channelId, person.userId))}>{person.userId === me ? 'Leave' : 'Remove'}</Button>}</div>)}<form className="flex gap-2" onSubmit={event => { event.preventDefault(); void mutate(async () => { await hyperAddGroupMember(channelId, email); setEmail(''); }); }}><Input type="email" required aria-label="Their email" value={email} onChange={event => setEmail(event.target.value)} /><Button disabled={pending || !email.trim() || !serviceReady}>Add</Button></form></div>}
    <div ref={viewport} onScroll={event => { const el = event.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80; }} className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-3xl space-y-5">{!data.messages.length && <p>Say something. Every Bot answers in turn, or choose one recipient below.</p>}{data.messages.map(message => <article key={message.id} data-speaker={message.agentId} className="space-y-1"><p className="text-xs text-muted-foreground">{message.agentId ? names.get(message.agentId) ?? 'A Bot no longer here' : message.ownerUserId === me ? 'You' : data.people.find(person => person.userId === message.ownerUserId)?.name ?? 'A teammate'}{message.answeredBy ? ` · answer from ${names.get(message.answeredBy) ?? 'another Bot'}` : ''}</p>{message.status === 'waiting' ? <p>{message.reason ?? 'Waiting for your response.'}</p> : message.consent ? message.ownerUserId === me ? <HyperTeamConsent {...message.consent} message={message.text} /> : <p>Asked a teammate for permission to use their own {message.consent.serverId} account.</p> : message.status === 'failed' ? <p role="alert" className="text-destructive">{message.text || "This Bot couldn't answer."}</p> : !message.text && ['queued', 'running'].includes(message.status) ? <p role="status">Thinking</p> : <HyperMarkdown content={message.text} onOpenLink={url => void window.appflowy.shell.openExternal(url)} />}</article>)}</div></div>
    {questionError && <p role="alert" className="px-4">Questions could not be checked. <Button variant="ghost" onClick={() => setRevision(value => value + 1)}>Retry</Button></p>}
    {question && <HyperGroupQuestionNotice key={question.id} question={question} name={names.get(question.conversationBotId ?? question.botId) ?? 'A Bot'} disabled={!serviceReady || pending || !!working} onAnswer={answer} onDismiss={async () => { await hyperDismissQuestion(question.id); setQuestions(value => value.filter(item => item.id !== question.id)); setRevision(value => value + 1); }} />}
    <label className="px-4 text-sm">To: <select aria-label="Address a Bot" value={address} onChange={event => setAddress(event.target.value)}><option value="">Every Bot</option>{data.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
    <HyperComposer agents={data.bots} value={heldDraft.text} onTextChange={change => updateDraft(current => ({ ...current, text: typeof change === 'function' ? change(current.text) : change }))} className="m-4" disabled={!serviceReady || !data.bots.length} pending={pending || working} stoppable={false} autoFocus onSubmit={async draft => { const agentId = draft.agentId || address || null; if (question && hyperQuestionRecipient(question, agentId)) { await answer(draft.text); return; } if (!retry.current || retry.current.text !== draft.text || retry.current.agentId !== agentId) retry.current = { id: crypto.randomUUID(), text: draft.text, agentId }; try { await hyperSendGroup(channelId, retry.current); retry.current = undefined; } finally { setRevision(value => value + 1); } }} />
  </div>;
}
