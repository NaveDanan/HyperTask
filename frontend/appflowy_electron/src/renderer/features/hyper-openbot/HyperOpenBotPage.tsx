import { HyperInitialDraftTransfer, hyperReceiveInitialDraft, type HyperInitialDraftReceiver } from './conversations/HyperInitialDraftTransfer';
import type { HyperInitialDraft } from './onboarding/HyperHomeApi';
import { HyperVoiceControls } from './conversations/HyperVoiceControls';
import { voiceContext, askChannelAgent } from './conversations/HyperVoiceAgentBridge';
import { HyperDeliveryControls } from './conversations/HyperDeliveryControls';
import { HyperGroupChat, hyperStartGroup, hyperSendGroup } from './conversations';
import { HyperServiceStatus, useHyperOpenBotService } from './HyperServiceStatus';
// OpenBot channel/provider integration adapted from pinned f8af37a. Copyright (c) 2026 CopilotKit, MIT.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { hyperLoadAllChannels } from './HyperChannelPaging';
import { hyperResolveModelPick, type HyperConversationModel } from './HyperModelSelection';
import { hyperAcquireConversationDraft, useHyperConversationDraft } from './useHyperConversationDraft';
import type { HyperDraftAttachment } from './HyperConversationDraft';
import { HYPER_PENDING_ATTACHMENT, hyperUploadDraftFiles } from './HyperConversationDraft';
import { HyperRunConnectionError } from './HyperRunConnection';
import { hyperRunWithRecovery, hyperWatchGatewayActivity, hyperWatchGatewayErrors } from './HyperRun';
import { HyperComputerPanel } from './HyperComputerPanel';
import { HyperSkillsPanel } from './skills';
import { readThreadMessages } from './HyperThreadMessages';
import { hyperRestoreStoredMessages } from './HyperHistoryMerge';
import { hyperMessageContent } from './HyperMessageContent';
import { hyperToolOutcome } from './HyperToolOutcome';
import { hyperGatewayJoin } from './HyperRun';
import { HyperConversationActions } from './HyperConversationActions';
import { Button } from '@/components/ui/button';
import { HyperOpenBotProvider } from './provider';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN, hyperOpenBotRequest as request } from './transport';
import { HyperComposer, HyperScreenPickedFiles, type HyperModelOption, type HyperModelPick } from './composer';
import { HyperTranscript, type HyperTranscriptMessage } from './transcript';
import { HyperConversationsScreen, type HyperConversation } from './screens';
import { HyperBotsPanel } from './bots';
import { HyperConnectionsPanel } from './connections';
import { HyperRuntimeTools, hyperObserveApprovalAgent, hyperWhileObserved } from './runtime';
import { hyperPrepareRuntimeAgent, hyperResolveRuntimeFacts } from './HyperRuntimeIntegration';
import { HYPER_OPENBOT_SECTIONS, type HyperOpenBotSectionContext } from './HyperOpenBotSections';

type HyperChannel = HyperConversation & { threadId: string; agentIds: string[]; active: boolean };
function HyperChannelChat({ channel, serviceReady, registerReceiver }: { channel: HyperChannel; serviceReady: boolean; registerReceiver?: (receiver: HyperInitialDraftReceiver | undefined) => void }) {
  const { copilotkit } = useCopilotKit();
  const { agent, isReady } = useAgent({ agentId: `channel:${channel.id}`, runtimeAgentId: channel.agentIds[0], threadId: channel.threadId });
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState(true);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const reconnecting = useRef(false);
  const priorServiceReady = useRef(serviceReady);
  useLayoutEffect(() => {
    const recovering = serviceReady && !priorServiceReady.current;
    priorServiceReady.current = serviceReady;
    if (recovering) {
      reconnecting.current = true; setReconnectRequired(true); setRestoring(true); setError(undefined);
    }
  }, [serviceReady]);
  const [sending, setSending] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [showComputer, setShowComputer] = useState(false);
  const stopped = useRef(false);
  const generation = useRef(0);
  const { draft, getDraft, updateDraft, prepareSubmission } = useHyperConversationDraft(channel.id);
  const { uploadGroup, attachments } = draft;
  const setAttachments = (change: (current: readonly HyperDraftAttachment[]) => readonly HyperDraftAttachment[]) => updateDraft(current => ({ ...current, attachments: change(current.attachments) }));
  const [models, setModels] = useState<HyperModelOption[]>([]);
  const [pick, setPick] = useState<HyperModelPick>({ model: '', effort: null });
  const [modelPending, setModelPending] = useState(false);
  const modelUpdating = useRef(false);
  const defaultModel = useRef('');
  useEffect(() => {
    if (!serviceReady) return;
    let current = true;
    void Promise.all([request<{ models: HyperModelOption[]; default: string }>('/api/models'), request<HyperConversationModel>(`/api/channels/${channel.id}/model`)]).then(([catalogue, saved]) => { if (current) { defaultModel.current = catalogue.default; setModels(catalogue.models); setPick(hyperResolveModelPick(saved, catalogue.default)); } }).catch(error => { if (current) setError(String(error)); });
    return () => { current = false; };
  }, [channel.id, serviceReady]);
  useEffect(() => {
    if (!isReady || !serviceReady) return;
    let current = true;
    hyperPrepareRuntimeAgent(agent);
    const releaseApproval = hyperObserveApprovalAgent(agent);
    const version = ++generation.current;
    setRestoring(true);
    // Capture this attempt; an error must block sends without starting another join.
    const reconnectAttempt = reconnecting.current || reconnectRequired;
    let connectFailed = false;
    const watchErrors = hyperWatchGatewayErrors(copilotkit, agent, error => {
      if (!current || version !== generation.current) return;
      connectFailed = true; setError(error.message); setReconnectRequired(true);
    });
    const watching = hyperWatchGatewayActivity(agent);
    const join = hyperGatewayJoin(() => hyperWhileObserved(agent, () => copilotkit.connectAgent({ agent })), () => {
      if (current && version === generation.current && !watching.isAnswering()) agent.detachActiveRun();
    }, 5000, watching.isConnected);
    void (async () => {
      try {
        // A bounded gateway join precedes the durable read. Never replace live text with a partial store copy.
        const joined = await join.promise;
        if (!current || version !== generation.current) return;
        const stored = await readThreadMessages(channel.threadId, channel.agentIds[0]);
        if (!current || version !== generation.current) return;
        if (stored.availability === 'unavailable') setError('Conversation history could not be loaded. Retry by reopening the conversation.');
        else {
          // History availability alone does not confirm the gateway. Keep retry visible after a deadline.
          if (connectFailed || (reconnectAttempt && joined !== 'connected')) {
            setReconnectRequired(true);
            setError('OpenBot reconnect was not confirmed. Try Reconnect again. Your draft is kept.');
          } else {
            setReconnectRequired(false);
            if (reconnecting.current) { reconnecting.current = false; setRecoveryVersion(value => value + 1); }
          }
          if (!watching.isAnswering()) hyperRestoreStoredMessages(agent, stored.messages);
          if (stored.unreadable) setError(`${stored.unreadable} stored messages could not be read.`);
        }
      } catch (error) { if (current) setError(String(error)); }
      finally { if (current) setRestoring(false); }
    })();
    return () => { current = false; generation.current++; join.cancel(); watching.unsubscribe(); watchErrors.unsubscribe(); releaseApproval(); };
  }, [agent, copilotkit, isReady, channel.threadId, historyRevision, serviceReady]);
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
  async function sendDraft(draft: { text: string; attachments: readonly import('./composer').HyperComposerAttachment[] }) {
      const sent = prepareSubmission(draft.text, draft.attachments.map(file => file.id).join(','));
      setError(undefined); setSending(true); stopped.current = false;
      agent.pendingInterrupts = agent.pendingInterrupts.filter(interrupt => !interrupt.metadata?.openbotWaiting);
      if (!agent.messages.some(message => message.id === sent.id)) agent.addMessage({ id: sent.id, role: 'user', content: draft.attachments.length ? [{ type: 'text' as const, text: draft.text.trim() }, ...draft.attachments.map(file => ({ type: (file as HyperDraftAttachment).mimeType.startsWith('image/') ? 'image' as const : 'document' as const, source: { type: 'url' as const, value: `/api/attachments/${file.id}`, mimeType: (file as HyperDraftAttachment).mimeType }, metadata: { attachmentId: file.id, filename: file.name } }))] : draft.text.trim() });
      try { await hyperRunWithRecovery(agent, () => hyperWhileObserved(agent, () => copilotkit.runAgent({ agent })), () => stopped.current); updateDraft(current => current.retry?.id === sent.id ? { ...current, retry: undefined } : current); }
      catch (error) { if (error instanceof HyperRunConnectionError) setReconnectRequired(true); setError(String(error)); throw error; }
      finally { setSending(false); }
  }
  const uploadedInitial = useRef(new Map<File, HyperDraftAttachment>());
  useEffect(() => {
    if (!registerReceiver || !isReady || !serviceReady || restoring || reconnectRequired || !channel.active) return;
    registerReceiver(async (initial, signal) => {
      const abort = () => { stopped.current = true; void copilotkit.stopAgent({ agent }); };
      signal.addEventListener('abort', abort, { once: true });
      try { await hyperReceiveInitialDraft(channel.id, initial, signal, { get: getDraft, update: updateDraft, uploaded: uploadedInitial.current, send: sendDraft }); }
      finally { signal.removeEventListener('abort', abort); }
    });
    return () => registerReceiver(undefined);
  }, [registerReceiver, isReady, serviceReady, restoring, reconnectRequired, channel.active]);
  // The existing workspace support bubble occupies the bottom-right corner.
  // Keep the composer controls above it, including in the minimum-size window.
  return <div className="flex h-full min-h-0 flex-col pb-12">
    {error && serviceReady && <div className="flex items-center gap-3 p-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={running || restoring} onClick={() => { reconnecting.current = true; setError(undefined); setHistoryRevision(value => value + 1); }}>Reconnect</Button></div>}
    <div className="flex justify-end border-b border-border px-4 py-1"><Button variant="ghost" aria-expanded={showComputer} onClick={() => setShowComputer(value => !value)}>Computer</Button></div>
    {showComputer && <HyperComputerPanel botId={channel.agentIds[0]} steps={messages.flatMap(message => message.tools ?? []).filter(tool => tool.label.startsWith('computer_')).map(tool => ({ id: tool.id, label: tool.label, status: tool.status === 'complete' ? 'completed' : tool.status === 'refused' ? 'denied' : tool.status === 'failed' ? 'failed' : tool.status === 'running' ? 'running' : 'waiting', detail: tool.result }))} />}
    <HyperVoiceControls channelId={channel.id} disabled={!serviceReady || restoring || reconnectRequired} context={() => voiceContext(agent.messages)} anchorMessageId={() => agent.messages.at(-1)?.id ?? null} askAgent={(text, signal) => askChannelAgent(text, signal, { busy: () => running, send: async prompt => {
      const id = crypto.randomUUID(); agent.addMessage({ id, role: 'user', content: prompt }); setSending(true); stopped.current = false;
      try { await hyperRunWithRecovery(agent, () => hyperWhileObserved(agent, () => copilotkit.runAgent({ agent })), () => stopped.current); return agent.messages.filter(message => message.role === 'assistant').map(message => hyperMessageContent(message.content).text).at(-1) ?? ''; }
      finally { setSending(false); }
    } })} />
    <HyperDeliveryControls channelId={channel.id} bots={channel.agentIds.map(id => ({ id, name: id }))} enabled={serviceReady} />
    <HyperTranscript messages={messages} busy={running} restoring={restoring} onOpenLink={url => void window.appflowy.shell.openExternal(url)} />
    <HyperConversationActions threadId={channel.threadId} enabled={serviceReady} onResolved={() => { if (!running) setHistoryRevision(value => value + 1); }} />
    <HyperComposer className="m-4" value={draft.text} onTextChange={change => { updateDraft(current => ({ ...current, text: typeof change === 'function' ? change(current.text) : change })); }} recoveryVersion={recoveryVersion} autoFocus disabled={!serviceReady || !isReady || restoring || reconnectRequired || !channel.active || modelPending} pending={running} attachments={attachments} getAttachmentCount={() => getDraft().attachments.length} onRemoveAttachment={id => { setAttachments(previous => previous.filter(file => file.id !== id)); if (!id.startsWith(HYPER_PENDING_ATTACHMENT)) void request(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(error => setError(String(error))); }} onConsumeAttachments={ids => { setAttachments(previous => previous.filter(file => !ids.includes(file.id))); }} onFiles={files => hyperUploadDraftFiles(files, async file => {
      const form = new FormData(); form.append('file', file); form.append('uploadGroup', uploadGroup);
      const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/channels/${channel.id}/attachments`, { method: 'POST', body: form });
      const saved = await response.json();
      if (!response.ok || typeof saved.id !== 'string' || typeof saved.name !== 'string' || typeof saved.mimeType !== 'string') throw new Error(saved.error ?? 'Attachment upload failed');
      return { id: saved.id, name: saved.name, mimeType: saved.mimeType, status: 'ready' };
    }, setAttachments, id => { void request(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(() => {}); })} modelPicker={models.length ? { models, value: pick, disabled: running || modelPending, onChange: next => {
      if (modelUpdating.current) return;
      modelUpdating.current = true; setModelPending(true);
      void request<HyperConversationModel>(`/api/channels/${channel.id}/model`, 'PUT', next).then(saved => setPick(hyperResolveModelPick(saved, defaultModel.current))).catch(error => setError(String(error))).finally(() => { modelUpdating.current = false; setModelPending(false); });
    } } : undefined} onStop={() => { stopped.current = true; return copilotkit.stopAgent({ agent }); }} onSubmit={sendDraft} />
  </div>;
}
function HyperOpenBotWorkspace({ viewId, serviceReady }: { viewId: string; serviceReady: boolean }) {
  const [screen, setScreen] = useState<string>('conversations');
  const [channels, setChannels] = useState<HyperChannel[]>([]);
  const [channel, setChannel] = useState<HyperChannel>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const selectionVersion = useRef(0);
  const [transfer] = useState(() => new HyperInitialDraftTransfer<HyperChannel>());
  const [receiving, setReceiving] = useState<HyperChannel>();
  const receiverWait = useRef<{ resolve: (receiver: HyperInitialDraftReceiver) => void } | undefined>(undefined);
  const receiver = useRef<HyperInitialDraftReceiver | undefined>(undefined);
  const serviceRef = useRef(serviceReady); serviceRef.current = serviceReady;
  const registerReceiver = useRef((next: HyperInitialDraftReceiver | undefined) => { receiver.current = next; if (next) receiverWait.current?.resolve(next); }).current;
  useEffect(() => { if (!serviceReady) transfer.cancel(); return () => transfer.cancel(); }, [serviceReady, transfer]);
  function cancelStart() { transfer.cancel(); setReceiving(undefined); }

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
  function open(id: string) { cancelStart(); selectionVersion.current++; const found = channels.find(each => each.id === id); if (found) { setChannel(found); localStorage.setItem(`hyper-openbot.channel.${viewId}`, id); } }
  async function openAny(id: string) {
    cancelStart();
    if (channels.some(each => each.id === id)) return open(id);
    const selection = ++selectionVersion.current;
    try { const saved = await request<{ channel: HyperChannel }>(`/api/channels/${encodeURIComponent(id)}`); if (selection === selectionVersion.current) { setChannel(saved.channel); localStorage.setItem(`hyper-openbot.channel.${viewId}`, id); } }
    catch (error) { if (selection === selectionVersion.current) setError(String(error)); }
  }
  async function start(agentIds: string[], initialDraft?: HyperInitialDraft) {
    if (!serviceRef.current) throw new Error('AI services are not ready.');
    if (!agentIds.length) throw new Error('Choose a Bot.');
    if (initialDraft && HyperScreenPickedFiles(initialDraft.files, { alreadyStaged: 0 }).rejected.length) throw new Error('Some files cannot be attached. Check file types, sizes, and the eight-file limit.');
    if (agentIds.length > 1 && initialDraft && (initialDraft.files.length || initialDraft.commandIds.length)) throw new Error('Files and skills require a conversation with one Bot.');
    selectionVersion.current++;
    try {
      await transfer.start(agentIds, initialDraft, {
        create: async ids => {
          const created = ids.length > 1 ? await hyperStartGroup<HyperChannel>(ids) : (await request<{ channel: HyperChannel }>('/api/channels', 'POST', { agentIds: ids })).channel;
          version.current++; setLoading(false); setChannels(previous => [created, ...previous]); return created;
        },
        receive: async (created, initial, signal) => {
          if (created.agentIds.length > 1) {
            const lease = hyperAcquireConversationDraft(created.id);
            lease.update(current => ({ ...current, text: initial.text, commandIds: initial.commandIds }));
            if (initial.submit) { const sent = lease.prepareSubmission(initial.text, ''); await hyperSendGroup(created.id, { id: sent.id, text: initial.text, agentId: null }); lease.update(current => ({ ...current, text: '', commandIds: [], retry: undefined })); } return;
          }
          if (receiving?.id !== created.id) { receiver.current = undefined; setReceiving(created); }
          const receive = await new Promise<HyperInitialDraftReceiver>((resolve, reject) => {
            const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); receiverWait.current = undefined; };
            const abort = () => { cleanup(); reject(new DOMException('Conversation start cancelled', 'AbortError')); };
            const timer = setTimeout(() => { cleanup(); reject(new Error('Conversation was not ready. Try again.')); }, 20_000);
            signal.addEventListener('abort', abort, { once: true });
            receiverWait.current = { resolve: next => { cleanup(); resolve(next); } };
            if (receiver.current) receiverWait.current.resolve(receiver.current);
          });
          signal.throwIfAborted(); await receive(initial, signal);
        },
        navigate: created => { selectionVersion.current++; setChannel(created); setReceiving(undefined); localStorage.setItem(`hyper-openbot.channel.${viewId}`, created.id); },
      });
    } catch (error) { if (serviceRef.current) setError('Conversation could not be started. Your Home draft is kept.'); throw error; }
  }
  const tabs: readonly { id: string; label: string }[] = [{ id: 'conversations', label: 'Conversations' }, { id: 'bots', label: 'Bots' }, { id: 'skills', label: 'Skills' }, { id: 'connections', label: 'Connections' }, ...HYPER_OPENBOT_SECTIONS];
  const section = HYPER_OPENBOT_SECTIONS.find(each => each.id === screen);
  const context: HyperOpenBotSectionContext = { openConversation: id => void openAny(id), initialDraftSupported: true, startConversation: start, navigate: id => { if (!serviceRef.current) return; const destination = id.split(/[/?]/)[0]; if (tabs.some(tab => tab.id === destination)) { cancelStart(); selectionVersion.current++; setScreen(destination); setChannel(undefined); } } };
  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <HyperRuntimeTools resolveFacts={hyperResolveRuntimeFacts} />
    <nav aria-label="OpenBot" className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2">
      {tabs.map(tab => <Button key={tab.id} variant={screen === tab.id && !channel ? 'secondary' : 'ghost'} onClick={() => { cancelStart(); selectionVersion.current++; setScreen(tab.id); setChannel(undefined); }}>{tab.label}</Button>)}
      {screen === 'conversations' && <Button variant="ghost" onClick={() => void refresh()}>Refresh</Button>}
    </nav>
    {error && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
    {receiving && <div hidden><HyperChannelChat key={receiving.id} channel={receiving} serviceReady={serviceReady} registerReceiver={registerReceiver} /></div>}
    {channel ? channel.agentIds.length > 1 ? <HyperGroupChat key={channel.id} channelId={channel.id} serviceReady={serviceReady} /> : <HyperChannelChat key={channel.id} channel={channel} serviceReady={serviceReady} /> : section ? section.render(context) : screen === 'bots' ? <HyperBotsPanel onChat={id => { void start([id]).catch(() => {}); }} /> : screen === 'skills' ? <HyperSkillsPanel /> : screen === 'connections' ? <HyperConnectionsPanel /> : <HyperConversationsScreen loading={loading} conversations={channels} onRetry={() => void refresh()} onOpen={open} onNew={() => setScreen('new-conversation')} onSetPinned={async (id, pinned) => { await request(`/api/channels/${encodeURIComponent(id)}/pin`, 'PUT', { pinned }); await refresh(); }} onDelete={async id => { await request(`/api/channels/${encodeURIComponent(id)}`, 'DELETE'); if (localStorage.getItem(`hyper-openbot.channel.${viewId}`) === id) localStorage.removeItem(`hyper-openbot.channel.${viewId}`); await refresh(); }} />}
  </div>;
}
export function HyperOpenBotPage({ viewId }: { viewId: string }) {
  const service = useHyperOpenBotService(true);
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (service.state.ready) setOpened(true); else if (['signed_out', 'profile_required', 'unsupported'].includes(service.state.problem)) setOpened(false); }, [service.state.ready, service.state.problem]);
  return <div className="flex h-full min-h-0 flex-col"><HyperServiceStatus {...service} />
    <div className="min-h-0 flex-1">{opened ? <HyperOpenBotProvider><HyperOpenBotWorkspace viewId={viewId} serviceReady={service.state.ready} /></HyperOpenBotProvider> : <p className="p-6 text-sm text-muted-foreground">Chat will connect when the AI services are ready. Your other HyperTask pages remain available.</p>}</div>
  </div>;
}
