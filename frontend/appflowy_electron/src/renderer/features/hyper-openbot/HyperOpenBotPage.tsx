// OpenBot channel/provider integration adapted from pinned f8af37a. Copyright (c) 2026 CopilotKit, MIT.
import { useEffect, useRef, useState } from 'react';
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { hyperLoadAllChannels } from './HyperChannelPaging';
import { hyperRunWithRecovery } from './HyperRun';
import { HyperComputerPanel } from './HyperComputerPanel';
import { HyperSkillsPanel } from './skills';
import { readThreadMessages } from './HyperThreadMessages';
import { mergeStoredMessages } from './HyperHistoryMerge';
import { hyperMessageContent } from './HyperMessageContent';
import { hyperToolOutcome } from './HyperToolOutcome';
import { hyperGatewayJoin } from './HyperRun';
import { HyperConversationActions } from './HyperConversationActions';
import { Button } from '@/components/ui/button';
import { HyperOpenBotProvider } from './provider';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN, hyperOpenBotRequest as request } from './transport';
import { HyperComposer, type HyperComposerAttachment, type HyperModelOption, type HyperModelPick } from './composer';
import { HyperTranscript, type HyperTranscriptMessage } from './transcript';
import { HyperConversationsScreen, type HyperConversation } from './screens';
import { HyperBotsPanel } from './bots';
import { HyperConnectionsPanel } from './connections';
import { HyperRuntimeTools, hyperObserveApprovalAgent, hyperWhileObserved } from './runtime';
import { hyperPrepareRuntimeAgent, hyperResolveRuntimeFacts } from './HyperRuntimeIntegration';

type HyperChannel = HyperConversation & { threadId: string; agentIds: string[]; active: boolean };
function HyperChannelChat({ channel }: { channel: HyperChannel }) {
  const { copilotkit } = useCopilotKit();
  const { agent, isReady } = useAgent({ agentId: `channel:${channel.id}`, runtimeAgentId: channel.agentIds[0], threadId: channel.threadId });
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState(true);
  const [sending, setSending] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [showComputer, setShowComputer] = useState(false);
  const stopped = useRef(false);
  const generation = useRef(0);
  const retry = useRef<{ id: string; text: string; files: string } | undefined>(undefined);
  const [uploadGroup] = useState(() => crypto.randomUUID());
  const [attachments, setAttachments] = useState<(HyperComposerAttachment & { mimeType: string })[]>([]);
  const [models, setModels] = useState<HyperModelOption[]>([]);
  const [pick, setPick] = useState<HyperModelPick>({ model: '', effort: null });
  const [modelPending, setModelPending] = useState(false);
  const modelUpdating = useRef(false);
  useEffect(() => {
    void Promise.all([request<{ models: HyperModelOption[]; default: string }>('/api/models'), request<HyperModelPick>(`/api/channels/${channel.id}/model`)]).then(([catalogue, saved]) => { setModels(catalogue.models); setPick({ model: saved.model || catalogue.default, effort: saved.effort }); }).catch(error => setError(String(error)));
  }, [channel.id]);
  useEffect(() => {
    if (!isReady) return;
    let current = true;
    hyperPrepareRuntimeAgent(agent);
    const releaseApproval = hyperObserveApprovalAgent(agent);
    const version = ++generation.current;
    setRestoring(true);
    let answering = false;
    const watching = agent.subscribe({ onRunStartedEvent: () => { answering = true; }, onRunFinishedEvent: () => { answering = false; }, onRunFailed: () => { answering = false; } });
    const join = hyperGatewayJoin(() => hyperWhileObserved(agent, () => copilotkit.connectAgent({ agent })), () => {
      if (current && version === generation.current && !answering) agent.detachActiveRun();
    });
    void (async () => {
      try {
        // A bounded gateway join precedes the durable read. Never replace live text with a partial store copy.
        await join.promise;
        if (!current || version !== generation.current) return;
        const stored = await readThreadMessages(channel.threadId, channel.agentIds[0]);
        if (!current || version !== generation.current) return;
        if (stored.availability === 'unavailable') setError('Conversation history could not be loaded. Retry by reopening the conversation.');
        else { if (!answering) agent.setMessages(mergeStoredMessages(agent.messages, stored.messages)); if (stored.unreadable) setError(`${stored.unreadable} stored messages could not be read.`); }
      } catch (error) { if (current) setError(String(error)); }
      finally { if (current) setRestoring(false); }
    })();
    return () => { current = false; generation.current++; join.cancel(); watching.unsubscribe(); releaseApproval(); };
  }, [agent, copilotkit, isReady, channel.threadId, historyRevision]);
  const running = sending || agent.isRunning;
  const messages: HyperTranscriptMessage[] = agent.messages.flatMap(message => {
    // System instructions remain in the agent context, outside the visible transcript.
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const tools = 'toolCalls' in message ? message.toolCalls?.map(call => {
      const result = agent.messages.find(each => each.role === 'tool' && each.toolCallId === call.id);
      const content = result && typeof result.content === 'string' ? result.content : undefined;
      return { id: call.id, label: call.function.name, arguments: call.function.arguments, result: content, status: hyperToolOutcome(content, agent.isRunning) };
    }) : undefined;
    return [{ id: message.id, role: message.role, content: hyperMessageContent(message.content).text, attachments: hyperMessageContent(message.content).attachments, tools, live: sending, streaming: sending && agent.isRunning }];
  });
  // The existing workspace support bubble occupies the bottom-right corner.
  // Keep the composer controls above it, including in the minimum-size window.
  return <div className="flex h-full min-h-0 flex-col pb-12">
    {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
    <div className="flex justify-end border-b border-border px-4 py-1"><Button variant="ghost" aria-expanded={showComputer} onClick={() => setShowComputer(value => !value)}>Computer</Button></div>
    {showComputer && <HyperComputerPanel botId={channel.agentIds[0]} steps={messages.flatMap(message => message.tools ?? []).filter(tool => tool.label.startsWith('computer_')).map(tool => ({ id: tool.id, label: tool.label, status: tool.status === 'complete' ? 'completed' : tool.status === 'refused' ? 'denied' : tool.status === 'failed' ? 'failed' : tool.status === 'running' ? 'running' : 'waiting', detail: tool.result }))} />}
    <HyperTranscript messages={messages} busy={running} restoring={restoring} onOpenLink={url => void window.appflowy.shell.openExternal(url)} />
    <HyperConversationActions threadId={channel.threadId} onResolved={() => { if (!running) setHistoryRevision(value => value + 1); }} />
    <HyperComposer className="m-4" autoFocus disabled={!isReady || restoring || !channel.active || modelPending} pending={running} attachments={attachments} onRemoveAttachment={id => { setAttachments(previous => previous.filter(file => file.id !== id)); void request(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(error => setError(String(error))); }} onConsumeAttachments={ids => setAttachments(previous => previous.filter(file => !ids.includes(file.id)))} onFiles={async files => {
      const staged: (HyperComposerAttachment & { mimeType: string })[] = [];
      try { for (const file of files) {
        const form = new FormData(); form.append('file', file); form.append('uploadGroup', uploadGroup);
        const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/channels/${channel.id}/attachments`, { method: 'POST', body: form });
        const saved = await response.json();
        if (!response.ok || typeof saved.id !== 'string' || typeof saved.name !== 'string' || typeof saved.mimeType !== 'string') throw new Error(saved.error ?? 'Attachment upload failed');
        staged.push({ id: saved.id, name: saved.name, mimeType: saved.mimeType, status: 'ready' });
      } } finally { setAttachments(previous => [...previous, ...staged]); }
    }} modelPicker={models.length ? { models, value: pick, disabled: running || modelPending, onChange: next => {
      if (modelUpdating.current) return;
      modelUpdating.current = true; setModelPending(true);
      void request<HyperModelPick>(`/api/channels/${channel.id}/model`, 'PUT', next).then(setPick).catch(error => setError(String(error))).finally(() => { modelUpdating.current = false; setModelPending(false); });
    } } : undefined} onStop={() => { stopped.current = true; return copilotkit.stopAgent({ agent }); }} onSubmit={async draft => {
      setError(undefined); setSending(true); stopped.current = false;
      agent.pendingInterrupts = agent.pendingInterrupts.filter(interrupt => !interrupt.metadata?.openbotWaiting);
      const files = draft.attachments.map(file => file.id).join(',');
      const previous = retry.current;
      const sent = previous?.text === draft.text && previous.files === files ? previous : { id: crypto.randomUUID(), text: draft.text, files };
      retry.current = sent;
      if (!agent.messages.some(message => message.id === sent.id)) agent.addMessage({ id: sent.id, role: 'user', content: attachments.length ? [{ type: 'text' as const, text: draft.text.trim() }, ...attachments.map(file => ({ type: file.mimeType.startsWith('image/') ? 'image' as const : 'document' as const, source: { type: 'url' as const, value: `/api/attachments/${file.id}`, mimeType: file.mimeType }, metadata: { attachmentId: file.id, filename: file.name } }))] : draft.text.trim() });
      try { await hyperRunWithRecovery(agent, () => hyperWhileObserved(agent, () => copilotkit.runAgent({ agent })), () => stopped.current); retry.current = undefined; }
      catch (error) { setError(String(error)); throw error; }
      finally { setSending(false); }
    }} />
  </div>;
}
function HyperOpenBotWorkspace({ viewId }: { viewId: string }) {
  const [screen, setScreen] = useState<'conversations' | 'bots' | 'skills' | 'connections'>('conversations');
  const [channels, setChannels] = useState<HyperChannel[]>([]);
  const [channel, setChannel] = useState<HyperChannel>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const selectionVersion = useRef(0);
  async function refresh(restoreInitial = false) {
    const current = ++version.current, selection = selectionVersion.current; setLoading(true); setError(undefined);
    try {
      const list = await hyperLoadAllChannels();
      if (current !== version.current) return;
      setChannels(list.channels);
      if (restoreInitial && selection === selectionVersion.current) {
        const remembered = localStorage.getItem(`hyper-openbot.channel.${viewId}`);
        if (remembered) {
          const found = list.channels.find(each => each.id === remembered);
          if (found) setChannel(found);
          else { const saved = await request<{ channel: HyperChannel }>(`/api/channels/${encodeURIComponent(remembered)}`); if (current === version.current && selection === selectionVersion.current) setChannel(saved.channel); }
        }
      }
    } catch (error) { if (current === version.current) setError(String(error)); }
    finally { if (current === version.current) setLoading(false); }
  }
  useEffect(() => { void refresh(true); return () => { version.current++; }; }, [viewId]);
  function open(id: string) { selectionVersion.current++; const found = channels.find(each => each.id === id); if (found) { setChannel(found); localStorage.setItem(`hyper-openbot.channel.${viewId}`, id); } }
  async function start(botId: string) {
    const selection = ++selectionVersion.current;
    try { const value = await request<{ channel: HyperChannel }>('/api/channels', 'POST', { agentIds: [botId] }); version.current++; setLoading(false); setChannels(previous => [value.channel, ...previous]); if (selection === selectionVersion.current) { setChannel(value.channel); localStorage.setItem(`hyper-openbot.channel.${viewId}`, value.channel.id); } }
    catch (error) { if (selection === selectionVersion.current) setError(String(error)); }
  }
  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <HyperRuntimeTools resolveFacts={hyperResolveRuntimeFacts} />
    <nav aria-label="OpenBot" className="flex shrink-0 gap-1 border-b border-border p-2">
      {(['conversations', 'bots', 'skills', 'connections'] as const).map(tab => <Button key={tab} variant={screen === tab && !channel ? 'secondary' : 'ghost'} onClick={() => { selectionVersion.current++; setScreen(tab); setChannel(undefined); }}>{tab === 'conversations' ? 'Conversations' : tab === 'bots' ? 'Bots' : tab === 'skills' ? 'Skills' : 'Connections'}</Button>)}
      {screen === 'conversations' && <Button variant="ghost" onClick={() => void refresh()}>Refresh</Button>}
    </nav>
    {error && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
    {channel ? <HyperChannelChat key={channel.id} channel={channel} /> : screen === 'bots' ? <HyperBotsPanel onChat={id => void start(id)} /> : screen === 'skills' ? <HyperSkillsPanel /> : screen === 'connections' ? <HyperConnectionsPanel /> : <HyperConversationsScreen loading={loading} conversations={channels} onRetry={() => void refresh()} onOpen={open} onNew={() => setScreen('bots')} onSetPinned={async (id, pinned) => { await request(`/api/channels/${encodeURIComponent(id)}/pin`, 'PUT', { pinned }); await refresh(); }} onDelete={async id => { await request(`/api/channels/${encodeURIComponent(id)}`, 'DELETE'); if (localStorage.getItem(`hyper-openbot.channel.${viewId}`) === id) localStorage.removeItem(`hyper-openbot.channel.${viewId}`); await refresh(); }} />}
  </div>;
}
export function HyperOpenBotPage({ viewId }: { viewId: string }) {
  return <HyperOpenBotProvider><HyperOpenBotWorkspace viewId={viewId} /></HyperOpenBotProvider>;
}
