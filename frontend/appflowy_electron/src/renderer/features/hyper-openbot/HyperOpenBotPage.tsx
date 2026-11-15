import { hyperRefreshPendingConnection } from './connections/HyperAccessRefresh';
import { hyperConnectionSelectionPath } from './connections/HyperNativeConnections';
import { hyperContinueAppTask, hyperAppCallIsLatest } from './connections/HyperAppContinuation';
import { readConnectPrompt, SHOW_APP_ACCESS_TOOL } from './screens-gen/HyperConnectPrompt';
import { useHyperRoutineNavigation } from './routines/HyperRoutineNavigation';
import { hyperObserveHomeDraftIdentity } from './onboarding/HyperHomeDraft';
import { hyperReplyToConversationQuestion, hyperShownQuestionAnswer, hyperHasUnseenActivity } from './conversations/HyperQuestionReply';
import { turnsLeftRunning, turnsNoLongerAway, turnsGoingAway, turnFinishedAway, onTurnFinishedAway, onTurnsAwayChanged } from './conversations/HyperTurnsAway';
import { HyperNotifyPrompt } from './approvals-inbox/HyperNotifications';
import { HyperStarterTasks } from './onboarding/HyperStarterTasks';
import { HyperConversationTitle } from './screens/HyperScreenModels';
import { HyperSubagentSteps } from './conversations/HyperSubagentSteps';
import { HyperToolMessage } from './transcript/HyperTranscript';
import { matchesHotkey, getHotkey } from './conversations/HyperHotkeys';
import { Input } from '@/components/ui/input';
import { HyperPauseNotice } from './conversations/HyperPauseNotice';
import { hyperWatchChannelEvents, hyperMarkChannelRead } from './conversations/HyperChannelEvents';
import { hyperSettingsApi } from './settings/HyperSettingsApi';
import { hyperConversationDestination } from './conversations/HyperNavigation';
import { HyperGalleryTools, hyperPrepareGalleryAgent } from './screens-gen/HyperGalleryRuntime';
import { hyperRuntimeBotOf } from './runtime';
import { HyperConversationResult } from './screens-gen/HyperConversationResult';
import { HyperInitialDraftTransfer, hyperReceiveInitialDraft, type HyperInitialDraftReceiver } from './conversations/HyperInitialDraftTransfer';
import { HyperRoutineNavigationProvider } from './routines';
import type { HyperInitialDraft } from './conversations/HyperInitialDraftTransfer';
import { HyperVoiceControls } from './conversations/HyperVoiceControls';
import { voiceContext, askChannelAgent, withVoiceContext } from './conversations/HyperVoiceAgentBridge';
import { HyperDeliveryControls } from './conversations/HyperDeliveryControls';
import { HyperGroupChat, hyperStartGroup, hyperSendGroup, hyperRenameConversation } from './conversations';
import { HyperServiceStatus, useHyperOpenBotService } from './HyperServiceStatus';
// OpenBot channel/provider integration adapted from pinned f8af37a. Copyright (c) 2026 CopilotKit, MIT.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { hyperLoadAllChannels } from './HyperChannelPaging';
import { hyperChannelHasWork, hyperUpdateChannelWork, type HyperChannelWorkHint } from './HyperChannelWork';
import { hyperResolveModelPick, hyperRequestModelPick, type HyperConversationModel, type HyperModelCatalogue } from './HyperModelSelection';
import { hyperAcquireConversationDraft, useHyperConversationDraft } from './useHyperConversationDraft';
import type { HyperDraftAttachment } from './HyperConversationDraft';
import { HYPER_PENDING_ATTACHMENT, hyperUploadDraftFiles } from './HyperConversationDraft';
import { HyperRunConnectionError } from './HyperRunConnection';
import { hyperRunWithRecovery, hyperWatchGatewayActivity, hyperWatchGatewayErrors } from './HyperRun';
import { hyperOpenBotComputer } from './computer-browser/HyperComputerDestination';
import { HyperComputerPanel } from './HyperComputerPanel';
import HyperNativeSkills from './skills/HyperNativeSkills';
import { readThreadMessages } from './HyperThreadMessages';
import { hyperRestoreStoredMessages } from './HyperHistoryMerge';
import { hyperMessageContent } from './HyperMessageContent';
import { hyperToolOutcome } from './HyperToolOutcome';
import { hyperGatewayJoin } from './HyperRun';
import { HyperConversationActions, type HyperInbox } from './HyperConversationActions';
import { Button } from '@/components/ui/button';
import { HyperOpenBotProvider } from './provider';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN, hyperOpenBotRequest as request } from './transport';
import { HyperComposer, HyperScreenPickedFiles, type HyperModelOption, type HyperModelPick } from './composer';
import { HyperTranscript, type HyperTranscriptMessage } from './transcript';
import { HyperConversationsScreen, type HyperConversation } from './screens';
import { HyperBotsPanel } from './bots';
import { HyperAgentPath, type HyperBotProfile } from './bots/HyperBotsApi';
import { hyperReceiveConnectionReturn, type HyperNativeConnectionBridge } from './connections/HyperNativeConnections';
import { HyperRuntimeTools, hyperObserveApprovalAgent, hyperWhileObserved } from './runtime';
import { hyperPrepareRuntimeAgent, hyperResolveRuntimeFacts } from './HyperRuntimeIntegration';
import { HYPER_OPENBOT_SECTIONS, hyperRenderConnections, type HyperOpenBotSectionContext } from './HyperOpenBotSections';

type HyperChannel = HyperConversation & HyperChannelWorkHint & { threadId: string; agentIds: string[]; active: boolean; lastMessageAgentId?: string | null; lastMessageAt?: string | null; lastReadAt?: string | null };
function HyperChannelChat({ channel, serviceReady, eventRevision = 0, registerReceiver, rosterSaysWorking }: { channel: HyperChannel; serviceReady: boolean; eventRevision?: number; registerReceiver?: (receiver: HyperInitialDraftReceiver | undefined) => void; rosterSaysWorking?: (channelId: string) => boolean | undefined }) {
  const { copilotkit, executingToolCallIds } = useCopilotKit();
  const { agent, isReady } = useAgent({ agentId: `channel:${channel.id}`, runtimeAgentId: channel.agentIds[0], threadId: channel.threadId });
  const questions = useRef<HyperInbox['questions']>([]);
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
  const mounted = useRef(true);
  const turns = useRef(new Set<object>());
  const [awayTurns, setAwayTurns] = useState(() => turnsGoingAway(channel.id));
  useEffect(() => { mounted.current = true; const off = onTurnFinishedAway(channel.id, () => setHistoryRevision(value => value + 1)); const offAway = onTurnsAwayChanged(channel.id, () => setAwayTurns(turnsGoingAway(channel.id))); return () => { mounted.current = false; turnsLeftRunning(channel.id, turns.current); off(); offAway(); }; }, [channel.id]);
  const [sending, setSending] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [showComputer, setShowComputer] = useState(false);
  const stopped = useRef(false);
  const stopEpoch = useRef(0);
  const workingHint = useRef({ busy: channel.busy, rosterSaysWorking }); workingHint.current = { busy: channel.busy, rosterSaysWorking };
  const serverWorking = () => continuation.current || workingHint.current.rosterSaysWorking?.(channel.id) === true || workingHint.current.busy === true || turnsGoingAway(channel.id) > 0;
  const stopRun = () => { supersedeAppCards(); stopEpoch.current++; stopped.current = true; return copilotkit.stopAgent({ agent }); };
  const generation = useRef(0);
  const { draft, getDraft, assertDraftCurrent, updateDraft, beginAttachmentSend, restoreQueuedDraft, prepareSubmission } = useHyperConversationDraft(channel.id);
  const { attachments } = draft;
  const setAttachments = (change: (current: readonly HyperDraftAttachment[]) => readonly HyperDraftAttachment[]) => updateDraft(current => ({ ...current, attachments: change(current.attachments) }));
  const [voiceHistory, setVoiceHistory] = useState('');
  const [commands, setCommands] = useState<{ id: string; label: string }[]>([]);
  const [models, setModels] = useState<HyperModelOption[]>([]);
  const [pick, setPick] = useState<HyperModelPick>({ model: '', effort: null });
  const [modelPending, setModelPending] = useState(false);
  const modelUpdating = useRef(false);
  const defaultModel = useRef('');
  const catalogueRef = useRef<HyperModelCatalogue | undefined>(undefined);
  const modelKey = JSON.stringify([channel.id, channel.agentIds[0], serviceReady]);
  const modelScope = useRef({ key: modelKey, active: false, sequence: 0, allowed: false });
  if (modelScope.current.key !== modelKey) modelScope.current = { key: modelKey, active: false, sequence: 0, allowed: false };
  const modelOwner = modelScope.current;
  const [modelCapability, setModelCapability] = useState<{ owner: typeof modelOwner; allowed: boolean }>();
  const modelAllowed = modelCapability?.owner === modelOwner && modelCapability.allowed && modelOwner.allowed;
  useEffect(() => {
    if (!serviceReady) return;
    let current = true;
    modelOwner.active = true; modelOwner.allowed = false;
    const sequence = ++modelOwner.sequence;
    const valid = () => current && modelScope.current === modelOwner && modelOwner.active && sequence === modelOwner.sequence;
    setModels([]); setPick({ model: '', effort: null }); setModelPending(false); setModelCapability({ owner: modelOwner, allowed: false });
    modelUpdating.current = false; defaultModel.current = ''; catalogueRef.current = undefined;
    void request<{ skills: { slug: string; title: string }[] }>(`/api/plugins/for/${encodeURIComponent(channel.agentIds[0])}`).then(value => { if (valid()) setCommands(value.skills.map(skill => ({ id: skill.slug, label: skill.title || skill.slug }))); }).catch(() => {});
    void (async () => {
      try {
        const profile = await request<{ agent: Pick<HyperBotProfile, 'id' | 'runsOnOpenBotModel'> }>(HyperAgentPath(channel.agentIds[0]));
        if (!valid() || profile.agent.id !== channel.agentIds[0] || profile.agent.runsOnOpenBotModel !== true) return;
        modelOwner.allowed = true; setModelCapability({ owner: modelOwner, allowed: true });
        const catalogue = await request<HyperModelCatalogue>('/api/models');
        if (!valid()) return;
        if (catalogue.choosable !== true) { modelOwner.allowed = false; setModelCapability({ owner: modelOwner, allowed: false }); return; }
        const saved = await request<HyperConversationModel>(`/api/channels/${channel.id}/model`);
        if (valid() && modelOwner.allowed) { catalogueRef.current = catalogue; defaultModel.current = catalogue.default; setModels(catalogue.models); setPick(hyperResolveModelPick(saved, catalogue.default)); }
      } catch (error) { if (valid()) setError(String(error)); }
    })();
    return () => { current = false; modelOwner.active = false; modelOwner.allowed = false; modelOwner.sequence++; };
  }, [channel.id, channel.agentIds[0], serviceReady]);
  useEffect(() => {
    if (!isReady || !serviceReady) return;
    let current = true;
    hyperPrepareRuntimeAgent(agent);
    hyperPrepareGalleryAgent(agent);
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
      if (current && version === generation.current && !watching.isAnswering() && !serverWorking()) agent.detachActiveRun();
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
  const continuation = useRef(false);
  const [carryingOn, setCarryingOn] = useState(false);
  const priorCarryOn = useRef(false);
  useEffect(() => { if (priorCarryOn.current && !carryingOn && serviceReady) setHistoryRevision(value => value + 1); priorCarryOn.current = carryingOn; }, [carryingOn, serviceReady]);
  const running = sending || agent.isRunning || serverWorking() || awayTurns > 0;
  useEffect(() => { if (eventRevision && serviceReady && !agent.isRunning && !sending && !channel.busy) setHistoryRevision(value => value + 1); }, [eventRevision, serviceReady]);
  const messages: HyperTranscriptMessage[] = agent.messages.flatMap<HyperTranscriptMessage>(message => {
    if (message.role === 'activity' && message.activityType === 'open-generative-ui') return [{id: message.id, role: 'assistant' as const, content: '', tools: [{id: message.id, label: 'open-generative-ui', arguments: JSON.stringify(message.content), status: 'complete' as const}]}];
    // System instructions remain in the agent context, outside the visible transcript.
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const tools = 'toolCalls' in message ? message.toolCalls?.map(call => {
      const result = agent.messages.find(each => each.role === 'tool' && each.toolCallId === call.id);
      const content = result && typeof result.content === 'string' ? result.content : undefined;
      return { id: call.id, label: call.function.name, arguments: call.function.arguments, result: content, status: hyperToolOutcome(content, agent.isRunning) };
    }) : undefined;
    return [{ id: message.id, role: message.role, content: message.role === 'user' ? hyperShownQuestionAnswer(message.id, hyperMessageContent(message.content).text) : hyperMessageContent(message.content).text, attachments: hyperMessageContent(message.content).attachments, tools, live: sending, streaming: sending && agent.isRunning }];
  });
  const latestAssistant = agent.messages.slice(agent.messages.findLastIndex(message => message.role === 'user') + 1).findLast(message => message.role === 'assistant');
  const latestArguments = latestAssistant?.toolCalls?.at(-1)?.id;
  async function sendDraft(draft: { commandIds?: readonly string[]; text: string; attachments: readonly import('./composer').HyperComposerAttachment[] }) {
      if (turns.current.size || agent.isRunning || serverWorking()) throw new Error('This Bot is still working. Wait or stop it first.');
      supersedeAppCards();
      let answerMessage: { id: string; role: 'user'; content: string } | undefined;
      if (!draft.attachments.length && !draft.commandIds?.length && !/^\s*\//.test(draft.text)) {
        let asked = questions.current.find(question => question.threadId === channel.threadId && (!question.channelId || question.channelId === channel.id));
        if (!asked) {
          const lastUser = agent.messages.findLastIndex(message => message.role === 'user');
          const justAsked = agent.messages.slice(lastUser + 1).some(message => message.role === 'assistant' && message.toolCalls?.some(call => call.function.name === 'ask_person'));
          if (justAsked) { const inbox = await request<HyperInbox>('/api/approvals'); asked = inbox.questions.find(question => question.threadId === channel.threadId && (!question.channelId || question.channelId === channel.id)); }
        }
        if (asked) {
          const result = await hyperReplyToConversationQuestion(asked, draft.text);
          answerMessage = result.message;
          if (!agent.messages.some(message => message.id === answerMessage!.id)) agent.addMessage(answerMessage);
          questions.current = questions.current.filter(question => question.id !== asked!.id);
          if (!result.continueHere) { setHistoryRevision(value => value + 1); return; }
        }
      }
       // Question lookups/responses can await while the server takes ownership.
       // A committed answer stays sent once; an uncommitted draft remains retryable.
       if (turns.current.size || agent.isRunning || serverWorking()) { if (answerMessage) { setHistoryRevision(value => value + 1); return; } throw new Error('This Bot is still working. Wait or stop it first.'); }
       const sent = answerMessage ? { id: answerMessage.id, text: draft.text, files: '' } : prepareSubmission(draft.text, draft.attachments.map(file => file.id).join(','));
      if (answerMessage) updateDraft(current => ({ ...current, retry: sent }));
      const turn = {}; turns.current.add(turn);
      const activity = (text: string, agentId: string | null) => { void request(`/api/channels/${encodeURIComponent(channel.id)}/activity`, 'POST', { text, agentId, at: new Date().toISOString() }).catch(() => {}); };
      const before = new Set(agent.messages.map(message => message.id));
      void request(`/api/channels/${encodeURIComponent(channel.id)}/busy`, 'POST', { busy: true }).catch(() => {});
      activity(draft.text, null);
      setError(undefined); setSending(true); stopped.current = false;
      agent.pendingInterrupts = agent.pendingInterrupts.filter(interrupt => !interrupt.metadata?.openbotWaiting);
      if (!agent.messages.some(message => message.id === sent.id)) agent.addMessage({ id: sent.id, role: 'user', content: draft.attachments.length ? [{ type: 'text' as const, text: draft.text.trim() }, ...draft.attachments.map(file => ({ type: (file as HyperDraftAttachment).mimeType.startsWith('image/') ? 'image' as const : 'document' as const, source: { type: 'url' as const, value: `/api/attachments/${file.id}`, mimeType: (file as HyperDraftAttachment).mimeType }, metadata: { attachmentId: file.id, filename: file.name } }))] : draft.text.trim() });
      const finishAttachments = beginAttachmentSend(sent.id, draft.attachments.map(file => file.id));
      try { await hyperRunWithRecovery(agent, () => withVoiceContext(copilotkit, channel.agentIds[0], voiceHistory, () => hyperWhileObserved(agent, () => copilotkit.runAgent({ agent }))), () => stopped.current); updateDraft(current => current.retry?.id === sent.id ? { ...current, retry: undefined } : current); }
      catch (error) { if (error instanceof HyperRunConnectionError) setReconnectRequired(true); setError(String(error)); throw error; }
      finally {
        finishAttachments();
        const reply = [...agent.messages].reverse().find(message => message.role === 'assistant' && !before.has(message.id) && hyperMessageContent(message.content).text.trim());
        if (reply) activity(hyperMessageContent(reply.content).text, channel.agentIds[0]);
        turns.current.delete(turn); turnsNoLongerAway(channel.id, [turn]);
        void request(`/api/channels/${encodeURIComponent(channel.id)}/busy`, 'POST', { busy: false }).catch(() => {});
        if (!mounted.current) turnFinishedAway(channel.id); else setSending(false);
      }
  }
  useEffect(() => {
    if (!registerReceiver || !isReady || !serviceReady || restoring || reconnectRequired || !channel.active || continuation.current) return;
    registerReceiver(async (initial, signal, uploaded) => {
       const abort = () => { void stopRun(); };
      signal.addEventListener('abort', abort, { once: true });
      try { await hyperReceiveInitialDraft(channel.id, initial, signal, { get: getDraft, assertCurrent: assertDraftCurrent, update: updateDraft, uploaded, send: sendDraft }); }
      finally { signal.removeEventListener('abort', abort); }
    });
    return () => registerReceiver(undefined);
  }, [registerReceiver, isReady, serviceReady, restoring, reconnectRequired, channel.active, carryingOn]);
  const navigation = useHyperRoutineNavigation();
  const appCardsSuperseded = useRef(new Set<string>());
  function supersedeAppCards() {
    for (const message of agent.messages) if (message.role === 'assistant') for (const call of message.toolCalls ?? []) appCardsSuperseded.current.add(call.id);
  }
  const appReadiness = useRef({ serviceReady, isReady, restoring, reconnectRequired, modelPending, active: channel.active });
  appReadiness.current = { serviceReady, isReady, restoring, reconnectRequired, modelPending, active: channel.active };
  const appRuntime = useRef({ agent, copilotkit, threadId: channel.threadId, botId: channel.agentIds[0] });
  appRuntime.current = { agent, copilotkit, threadId: channel.threadId, botId: channel.agentIds[0] };
  function latestAppCard(id: string) {
    if (appCardsSuperseded.current.has(id) || !hyperAppCallIsLatest(agent.messages, id)) return false;
    // Only the newest access card may wake this task when several tools were refused together.
    const cards = agent.messages.flatMap(message => message.role === 'assistant' ? (message.toolCalls ?? []).filter(call => {
      const result = agent.messages.find(row => row.role === 'tool' && row.toolCallId === call.id);
      const raw = result && typeof result.content === 'string' ? result.content : '';
      let decoded = raw;
      try { const value: unknown = JSON.parse(raw); if (typeof value === 'string') decoded = value; } catch { /* Plain result. */ }
      return (call.function.name === SHOW_APP_ACCESS_TOOL || hyperToolOutcome(raw, false) === 'refused') && !!readConnectPrompt(decoded.trim().replace(/^Refused\.\s+/, ''));
    }) : []);
    return cards.at(-1)?.id === id;
  }
  function appContinuationState(id: string) {
    const ready = appReadiness.current, draft = getDraft();
    return {
      current: mounted.current && navigation?.isCurrentNavigation?.() !== false && appRuntime.current.agent === agent && appRuntime.current.copilotkit === copilotkit && appRuntime.current.threadId === channel.threadId && appRuntime.current.botId === channel.agentIds[0],
      ready: ready.serviceReady && ready.isReady && ready.active && !ready.restoring && !ready.reconnectRequired && !ready.modelPending && !modelUpdating.current,
      busy: !!turns.current.size || agent.isRunning || serverWorking(),
      latest: latestAppCard(id),
      hasDraft: !!draft.text.trim() || !!draft.attachments.length || !!draft.commandIds?.length || !!draft.retry || !!draft.activeAttachments,
      hasQuestion: questions.current.some(question => question.threadId === channel.threadId) || agent.pendingInterrupts.some(interrupt => !!interrupt.metadata?.openbotWaiting),
      assertOwner: assertDraftCurrent,
    };
  }
  async function continueAppTask(id: string) {
    return hyperContinueAppTask(() => appContinuationState(id), async () => {
      appCardsSuperseded.current.add(id);
      const turn = {}; turns.current.add(turn); setSending(true); setError(undefined); stopped.current = false;
      const before = new Set(agent.messages.map(message => message.id));
      void request(`/api/channels/${encodeURIComponent(channel.id)}/busy`, 'POST', { busy: true }).catch(() => {});
      try {
        // The existing channel agent/thread and CopilotKit core receive the unchanged transcript.
        await hyperRunWithRecovery(agent, () => hyperWhileObserved(agent, () => copilotkit.runAgent({ agent })), () => stopped.current);
      } catch (error) { if (error instanceof HyperRunConnectionError) setReconnectRequired(true); setError('The app task could not continue. Reopen the conversation to retry.'); throw error; }
      finally {
        turns.current.delete(turn); turnsNoLongerAway(channel.id, [turn]);
        const reply = agent.messages.findLast(message => message.role === 'assistant' && !before.has(message.id) && hyperMessageContent(message.content).text.trim());
        if (reply) void request(`/api/channels/${encodeURIComponent(channel.id)}/activity`, 'POST', { text: hyperMessageContent(reply.content).text, agentId: channel.agentIds[0], at: new Date().toISOString() }).catch(() => {});
        void request(`/api/channels/${encodeURIComponent(channel.id)}/busy`, 'POST', { busy: false }).catch(() => {});
        if (!mounted.current) turnFinishedAway(channel.id); else setSending(false);
      }
    });
  }
  // The existing workspace support bubble occupies the bottom-right corner.
  // Keep the composer controls above it, including in the minimum-size window.
  return <div className="flex h-full min-h-0 flex-col pb-12">
    {error && serviceReady && <div className="flex items-center gap-3 p-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={running || restoring} onClick={() => { reconnecting.current = true; setError(undefined); setHistoryRevision(value => value + 1); }}>Reconnect</Button></div>}
    <div className="flex justify-end border-b border-border px-4 py-1"><Button variant="ghost" aria-expanded={showComputer} onClick={() => setShowComputer(value => !value)}>Computer</Button></div>
    {showComputer && <HyperComputerPanel botId={channel.agentIds[0]} steps={messages.flatMap(message => message.tools ?? []).filter(tool => tool.label.startsWith('computer_')).map(tool => ({ id: tool.id, label: tool.label, status: tool.status === 'complete' ? 'completed' : tool.status === 'refused' ? 'denied' : tool.status === 'failed' ? 'failed' : tool.status === 'running' ? 'running' : 'waiting', detail: tool.result }))} />}
    <HyperPauseNotice botId={channel.agentIds[0]} enabled={serviceReady} />
    <HyperVoiceControls onHistory={setVoiceHistory} channelId={channel.id} disabled={!serviceReady || !isReady || !channel.active || restoring || reconnectRequired} canContinue={serviceReady && channel.active && !reconnectRequired} context={() => voiceContext(agent.messages)} anchorMessageId={() => agent.messages.at(-1)?.id ?? null} askAgent={async (text, signal) => { const epoch = stopEpoch.current; const answer = await askChannelAgent(text, signal, { busy: () => running || serverWorking(), send: async prompt => {
      const before = new Set(agent.messages.map(message => message.id));
      await sendDraft({ text: prompt, attachments: [] });
      return [...agent.messages].reverse().filter(message => message.role === 'assistant' && !before.has(message.id)).map(message => hyperMessageContent(message.content).text).find(Boolean) ?? '';

    } }); if (epoch !== stopEpoch.current) throw new Error('The user stopped this task before it completed.'); return answer; }} />
    <HyperDeliveryControls channelId={channel.id} bots={channel.agentIds.map(id => ({ id, name: id }))} enabled={serviceReady} />
    <HyperTranscript renderTool={tool => tool.label === 'run_subagent' ? <HyperToolMessage {...tool}><HyperSubagentSteps toolCallId={tool.id} parentThreadId={channel.threadId} agentId={channel.agentIds[0]} result={tool.result} live={tool.status === 'running'} /></HyperToolMessage> : <HyperConversationResult tool={tool} callingBotId={hyperRuntimeBotOf(agent)} argumentsArriving={agent.isRunning && tool.id === latestArguments && tool.result === undefined && !executingToolCallIds?.has(tool.id)} turnInFlight={running} appCarryOn={{ key: `${channel.id}:${channel.threadId}:${hyperRuntimeBotOf(agent) ?? ''}:${tool.id}`, latest: () => { const state = appContinuationState(tool.id); return state.current && state.ready && !state.busy && state.latest && !state.hasDraft && !state.hasQuestion; }, resume: () => continueAppTask(tool.id) }} ask={!running && serviceReady && !restoring && !reconnectRequired ? text => { void sendDraft({ text, attachments: [] }).catch(() => setError('The follow-up could not be sent.')); } : undefined} />} messages={messages} busy={running} restoring={restoring} onOpenLink={url => void window.appflowy.shell.openExternal(url)} />
    {!!agent.messages.length && <HyperNotifyPrompt />}
    <HyperConversationActions onQuestions={value => { questions.current = value; }} onCarryOnChange={value => { continuation.current = value; setCarryingOn(value); }} threadId={channel.threadId} enabled={serviceReady} onResolved={() => { if (!running) setHistoryRevision(value => value + 1); }} />
    <HyperStarterTasks agentId={channel.agentIds[0]} channelId={channel.id} disabled={running || restoring || reconnectRequired || !serviceReady || !isReady || !channel.active} onSelect={text => sendDraft({ text, attachments: [] })} />
    <HyperComposer activeAttachmentIds={draft.activeAttachments?.ids} onRestoreQueued={(...args) => { supersedeAppCards(); return restoreQueuedDraft(...args); }} commandIds={draft.commandIds} onCommandIdsChange={ids => { supersedeAppCards(); updateDraft(current => ({ ...current, commandIds: ids })); }} commands={commands} onDiscardAttachment={id => { if (!getDraft().activeAttachments?.ids.includes(id)) void request(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(() => {}); }} className="m-4" value={draft.text} onTextChange={change => { supersedeAppCards(); updateDraft(current => ({ ...current, text: typeof change === 'function' ? change(current.text) : change })); }} recoveryVersion={recoveryVersion} autoFocus disabled={!serviceReady || !isReady || restoring || reconnectRequired || !channel.active || modelPending} pending={running} attachments={attachments} getAttachmentCount={() => getDraft().attachments.length} onRemoveAttachment={id => { if (getDraft().activeAttachments?.ids.includes(id)) return; setAttachments(previous => previous.filter(file => file.id !== id)); if (!id.startsWith(HYPER_PENDING_ATTACHMENT)) void request(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(error => setError(String(error))); }} onConsumeAttachments={ids => { setAttachments(previous => previous.filter(file => !ids.includes(file.id))); }} onFiles={files => { if (!mounted.current) throw new Error('This conversation is no longer active.'); assertDraftCurrent(); const batchUploadGroup = getDraft().uploadGroup; supersedeAppCards(); return hyperUploadDraftFiles(files, async file => {
      const form = new FormData(); form.append('file', file); form.append('uploadGroup', batchUploadGroup);
      const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/channels/${channel.id}/attachments`, { method: 'POST', body: form });
      const saved = await response.json();
      if (!response.ok || typeof saved.id !== 'string' || typeof saved.name !== 'string' || typeof saved.mimeType !== 'string') throw new Error(saved.error ?? 'Attachment upload failed');
      return { id: saved.id, name: saved.name, mimeType: saved.mimeType, status: 'ready' };
    }, setAttachments, id => { void request(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(() => {}); }, assertDraftCurrent); }} modelPicker={modelAllowed && models.length ? { models, value: pick, disabled: running || modelPending, onChange: next => {
      if (serverWorking() || turns.current.size || agent.isRunning || modelScope.current !== modelOwner || !modelOwner.active || !modelOwner.allowed || catalogueRef.current?.choosable !== true || modelUpdating.current) return;
      const sequence = modelOwner.sequence;
      const valid = () => modelScope.current === modelOwner && modelOwner.active && modelOwner.allowed && sequence === modelOwner.sequence;
      modelUpdating.current = true; setModelPending(true);
      void request<HyperConversationModel>(`/api/channels/${channel.id}/model`, 'PUT', hyperRequestModelPick(next, catalogueRef.current)).then(saved => { if (valid()) setPick(hyperResolveModelPick(saved, defaultModel.current)); }).catch(error => { if (valid()) setError(String(error)); }).finally(() => { if (valid()) { modelUpdating.current = false; setModelPending(false); } });
    } } : undefined} onStop={stopRun} onSubmit={sendDraft} />
  </div>;
}
export function HyperOpenBotWorkspace({ viewId, serviceReady }: { viewId: string; serviceReady: boolean }) {
  const [screen, setScreen] = useState<string>('conversations');
  const [newRecipients, setNewRecipients] = useState<string[]>([]);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteBots, setPaletteBots] = useState<{ id: string; name: string }[]>([]);
  const [emphasis, setEmphasis] = useState<'agent' | 'thread'>('thread');
  const [eventRevision, setEventRevision] = useState(0);
  const [connectionReturnRevision, setConnectionReturnRevision] = useState(0);
  const [navigationIntent, setNavigationIntent] = useState<{ path: string }>();
  const [channels, setChannels] = useState<HyperChannel[]>([]);
  const [channel, setChannel] = useState<HyperChannel>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const selectionVersion = useRef(0);
  const [transfer] = useState(() => new HyperInitialDraftTransfer<HyperChannel>());
  const [receiving, setReceiving] = useState<HyperChannel>();
  const [compositionRevision, setCompositionRevision] = useState(0);
  const receiverWait = useRef<{ resolve: (receiver: HyperInitialDraftReceiver) => void } | undefined>(undefined);
  const receiver = useRef<HyperInitialDraftReceiver | undefined>(undefined);
  const serviceRef = useRef(serviceReady); serviceRef.current = serviceReady;
  const registerReceiver = useRef((next: HyperInitialDraftReceiver | undefined) => { receiver.current = next; if (next) receiverWait.current?.resolve(next); }).current;
  useEffect(() => { if (!serviceReady) { selectionVersion.current++; transfer.cancel(); } return () => transfer.cancel(); }, [serviceReady, transfer]);
  function cancelStart() { transfer.cancel(); setReceiving(undefined); }
  function freshComposition(agentIds: readonly string[] = []) { transfer.resetComposition(); setNewRecipients([...agentIds]); setCompositionRevision(value => value + 1); }
  useEffect(() => {
    // Optional until the main/preload specialist's API is merged. No callback URL is read here.
    const bridge = window.appflowy.hyperOpenBot as typeof window.appflowy.hyperOpenBot & HyperNativeConnectionBridge;
    return bridge.onNativeDestination?.(destination => {
      if (!serviceRef.current) return;
      if (destination?.kind === 'connections' && destination.confirmation === 'native-confirmed' && hyperRefreshPendingConnection()) return;
      hyperReceiveConnectionReturn(destination, (id, intent) => {
        cancelStart(); selectionVersion.current++; setNavigationIntent(intent); setScreen(id); setChannel(undefined);
      }, () => setConnectionReturnRevision(value => value + 1));
    });
  }, []);

  const busyChannels = useRef(new Map<string, HyperChannelWorkHint>());
  const rosterSaysWorking = (id: string) => hyperChannelHasWork(busyChannels.current.get(id)) ? true : undefined;
  const activeChannel = useRef(channel); activeChannel.current = channel;
  const eventsCallback = useRef({ refresh: () => refresh(), open: (id: string) => { void openAny(id); } });
  eventsCallback.current = { refresh: () => refresh(), open: id => { void openAny(id); } };
  useEffect(() => {
    if (!serviceReady) return;
    return hyperWatchChannelEvents(event => {
      if (event && 'resync' in event) busyChannels.current.clear();
      else if (event) busyChannels.current.set(event.channelId, hyperUpdateChannelWork(busyChannels.current.get(event.channelId), event));
      void eventsCallback.current.refresh(); setEventRevision(value => value + 1);
      if (event && !('resync' in event) && event.deleted) setChannel(current => current?.id === event.channelId ? undefined : current);
      if (event && !('resync' in event) && event.channelId === activeChannel.current?.id && event.lastMessageAt) void hyperMarkChannelRead(event.channelId).catch(() => {});
    }, id => eventsCallback.current.open(id));
  }, [serviceReady, viewId]);
  useEffect(() => { if (serviceReady && channel) void hyperMarkChannelRead(channel.id).catch(() => {}); }, [channel?.id, serviceReady]);
  useEffect(() => { if (!serviceReady) return; let current = true; const load = () => { void hyperSettingsApi.preferences().then(value => { if (current) setEmphasis(value.messageListEmphasis); }).catch(() => {}); }; load(); window.addEventListener('focus', load); return () => { current = false; window.removeEventListener('focus', load); }; }, [serviceReady, screen]);
  async function refresh(restoreInitial = false) {
    const current = ++version.current, selection = selectionVersion.current; setLoading(true); setError(undefined);
    try {
      const list = await hyperLoadAllChannels();
      if (current !== version.current) return;
      const live = list.channels.map(row => {
        if (Array.isArray(row.work)) busyChannels.current.set(row.id, hyperUpdateChannelWork(busyChannels.current.get(row.id), { work: row.work, workAt: row.workAt }));
        return { ...row, title: HyperConversationTitle(row), busy: hyperChannelHasWork(busyChannels.current.get(row.id)) || hyperChannelHasWork(row), unreadCount: hyperHasUnseenActivity(row) ? 1 : 0 };
      });
      setChannels(live);
      setChannel(current => current ? live.find(row => row.id === current.id) ?? current : current);
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
    if (initialDraft?.agentId && !agentIds.includes(initialDraft.agentId)) throw new Error('Address a Bot selected in this conversation.');
    if (!initialDraft) { cancelStart(); selectionVersion.current++; freshComposition(agentIds); setChannel(undefined); setNavigationIntent(undefined); setScreen('new-conversation'); return; }
    if (initialDraft && HyperScreenPickedFiles(initialDraft.files, { alreadyStaged: 0 }).rejected.length) throw new Error('Some files cannot be attached. Check file types, sizes, and the eight-file limit.');
    if (agentIds.length > 1 && initialDraft && (initialDraft.files.length || initialDraft.commandIds.length)) throw new Error('Files and skills require a conversation with one Bot.');
    selectionVersion.current++;
    try {
      await transfer.start(agentIds, initialDraft, {
        create: async ids => {
          const created = ids.length > 1 ? await hyperStartGroup<HyperChannel>(ids) : (await request<{ channel: HyperChannel }>('/api/channels', 'POST', { agentIds: ids })).channel;
          if (initialDraft?.modelPick && ids.length === 1) { try { await request(`/api/channels/${encodeURIComponent(created.id)}/model`, 'PUT', initialDraft.modelPick); } catch (error) { await request(`/api/channels/${encodeURIComponent(created.id)}?discardFailedStart=true`, 'DELETE').catch(() => {}); throw error; } }
          version.current++; setLoading(false); setChannels(previous => [{ ...created, title: HyperConversationTitle(created) }, ...previous]); return created;
        },
        receive: async (created, initial, signal, uploaded) => {
          if (created.agentIds.length > 1) {
            const lease = hyperAcquireConversationDraft(created.id);
            lease.update(current => ({ ...current, text: initial.text, commandIds: initial.commandIds }));
            if (initial.submit) { const sent = lease.prepareSubmission(initial.text, ''); try { await hyperSendGroup(created.id, { id: sent.id, text: initial.text, agentId: initial.agentId ?? null }); } catch (error) { await request(`/api/channels/${encodeURIComponent(created.id)}?discardFailedStart=true`, 'DELETE').catch(() => {}); transfer.forget(created); throw error; } lease.update(current => ({ ...current, text: '', commandIds: [], retry: undefined })); } return;
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
          signal.throwIfAborted(); await receive(initial, signal, uploaded);
        },
        navigate: created => { selectionVersion.current++; setChannel(created); setReceiving(undefined); localStorage.setItem(`hyper-openbot.channel.${viewId}`, created.id); },
      });
    } catch (error) { if (serviceRef.current) setError('Conversation could not be started. Your Home draft is kept.'); throw error; }
  }
  const tabs: readonly { id: string; label: string }[] = [{ id: 'conversations', label: 'Conversations' }, { id: 'bots', label: 'Bots' }, { id: 'skills', label: 'Skills' }, { id: 'connections', label: 'Connections' }, ...HYPER_OPENBOT_SECTIONS];
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!serviceRef.current || event.defaultPrevented || event.isComposing || event.repeat) return;
      if (matchesHotkey(event, getHotkey('command-menu').combo)) { event.preventDefault(); setPalette(value => !value); return; }
      const editable = event.target instanceof HTMLElement && (!!event.target.closest('input,textarea,select,[contenteditable="true"]'));
      if (!editable && matchesHotkey(event, getHotkey('new-chat').combo)) { event.preventDefault(); cancelStart(); selectionVersion.current++; freshComposition(); setChannel(undefined); setNavigationIntent(undefined); setScreen('new-conversation'); }
      if (event.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (!palette || !serviceReady) return; let current = true; void request<{ agents: { id: string; name: string }[] }>('/api/agents').then(value => { if (current) setPaletteBots(value.agents); }).catch(() => {}); return () => { current = false; }; }, [palette, serviceReady]);
  const section = HYPER_OPENBOT_SECTIONS.find(each => each.id === screen);
  const contextVersion = selectionVersion.current;
  const context: HyperOpenBotSectionContext = { openAppConnection: (key, intent) => { if (serviceRef.current && selectionVersion.current === contextVersion) context.navigate?.(intent.admin ? 'admin-plugins' : 'connections', { path: hyperConnectionSelectionPath(intent.provider ? { page: 'browse', provider: intent.provider } : { page: 'app', key }, intent.admin) }); }, isCurrentNavigation: () => serviceRef.current && selectionVersion.current === contextVersion, openConversation: id => void openAny(id), initialDraftSupported: true, startConversation: start, initialAgentIds: newRecipients, navigationIntent, navigate: (id, intent) => { if (!serviceRef.current) return; cancelStart(); selectionVersion.current++; const resolved = hyperConversationDestination(id, intent); const destination = resolved.sectionId; if (tabs.some(tab => tab.id === destination)) { if (destination === 'new-conversation') freshComposition(); setNavigationIntent(resolved.path ? { path: resolved.path } : undefined); setScreen(destination); setChannel(undefined); } else { setNavigationIntent(current => current?.path === resolved.path ? current : resolved.path ? { path: resolved.path } : undefined); setError(`The ${destination} destination has not been registered by its owning area yet.`); } } };
  return <HyperRoutineNavigationProvider context={context}><div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <HyperRuntimeTools resolveFacts={hyperResolveRuntimeFacts} />
    <HyperGalleryTools />
    <nav aria-label="OpenBot" className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2">
      {tabs.map(tab => <Button key={tab.id} variant={screen === tab.id && !channel ? 'secondary' : 'ghost'} onClick={() => { cancelStart(); selectionVersion.current++; if (tab.id === 'new-conversation') freshComposition(); setScreen(tab.id); setNavigationIntent(undefined); setChannel(undefined); }}>{tab.label}</Button>)}
      {screen === 'conversations' && <Button variant="ghost" onClick={() => void refresh()}>Refresh</Button>}
    </nav>
    {palette && <section aria-label="Command palette" className="max-h-80 space-y-1 overflow-auto border-b p-3"><Input autoFocus aria-label="Find a page, Bot or conversation" value={paletteQuery} onChange={event => setPaletteQuery(event.target.value)} /><Button variant="ghost" onClick={() => setPalette(false)}>Close palette</Button>{tabs.filter(tab => tab.label.toLowerCase().includes(paletteQuery.toLowerCase())).map(tab => <Button key={tab.id} variant="ghost" onClick={() => { cancelStart(); selectionVersion.current++; if (tab.id === 'new-conversation') freshComposition(); setScreen(tab.id); setNavigationIntent(undefined); setChannel(undefined); setPalette(false); }}>{tab.label}</Button>)}{channels.filter(row => `${row.name} ${row.summary ?? ''}`.toLowerCase().includes(paletteQuery.toLowerCase())).map(row => <Button key={row.id} variant="ghost" onClick={() => { open(row.id); setPalette(false); }}>{row.summary ?? row.name}</Button>)}{paletteBots.filter(bot => bot.name.toLowerCase().includes(paletteQuery.toLowerCase())).map(bot => <Button key={bot.id} variant="ghost" onClick={() => { setPalette(false); void start([bot.id]).catch(() => {}); }}>Chat with {bot.name}</Button>)}</section>}
    {error && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
    {receiving && <div hidden><HyperChannelChat key={receiving.id} channel={receiving} serviceReady={serviceReady} registerReceiver={registerReceiver} rosterSaysWorking={rosterSaysWorking} /></div>}
    {channel ? channel.agentIds.length > 1 ? <HyperGroupChat key={channel.id} channelId={channel.id} serviceReady={serviceReady} eventRevision={eventRevision} /> : <HyperChannelChat key={channel.id} channel={channel} serviceReady={serviceReady} eventRevision={eventRevision} rosterSaysWorking={rosterSaysWorking} /> : section ? section.id === 'new-conversation' ? <Fragment key={`hyper-new-conversation-${compositionRevision}`}>{section.render(context)}</Fragment> : section.render(context) : screen === 'bots' ? <HyperBotsPanel onOpenConversation={context.openConversation} onComputer={id => hyperOpenBotComputer(id, context.navigate)} onChat={id => { void start([id]).catch(() => {}); }} /> : screen === 'skills' ? <HyperNativeSkills key={navigationIntent?.path} context={context} path={navigationIntent?.path} /> : screen === 'connections' ? <Fragment key={connectionReturnRevision}>{hyperRenderConnections(context)}</Fragment> : <HyperConversationsScreen onRename={async (id, title) => { await hyperRenameConversation(id, title); await refresh(); }} loading={loading} conversations={channels.map(row => emphasis === 'agent' ? { ...row, summary: row.name, name: row.summary ?? row.opening ?? 'New conversation' } : row)} onRetry={() => void refresh()} onOpen={open} onNew={() => { cancelStart(); selectionVersion.current++; freshComposition(); setNavigationIntent(undefined); setScreen('new-conversation'); }} onSetPinned={async (id, pinned) => { await request(`/api/channels/${encodeURIComponent(id)}/pin`, 'PUT', { pinned }); await refresh(); }} onDelete={async id => { await request(`/api/channels/${encodeURIComponent(id)}`, 'DELETE'); if (localStorage.getItem(`hyper-openbot.channel.${viewId}`) === id) localStorage.removeItem(`hyper-openbot.channel.${viewId}`); await refresh(); }} />}
  </div></HyperRoutineNavigationProvider>;
}
export function HyperOpenBotPage({ viewId }: { viewId: string }) {
  const service = useHyperOpenBotService(true);
  // Home drafts outlive its page and service restarts, but never a trusted identity rejection.
  useEffect(() => hyperObserveHomeDraftIdentity(listener => window.appflowy.hyperOpenBot.service.onState(listener)), []);
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (service.state.ready) setOpened(true); else if (['signed_out', 'profile_required', 'unsupported'].includes(service.state.problem)) setOpened(false); }, [service.state.ready, service.state.problem]);
  return <div className="flex h-full min-h-0 flex-col"><HyperServiceStatus {...service} />
    <div className="min-h-0 flex-1">{opened ? <HyperOpenBotProvider><HyperOpenBotWorkspace viewId={viewId} serviceReady={service.state.ready} /></HyperOpenBotProvider> : <p className="p-6 text-sm text-muted-foreground">Chat will connect when the AI services are ready. Your other HyperTask pages remain available.</p>}</div>
  </div>;
}
