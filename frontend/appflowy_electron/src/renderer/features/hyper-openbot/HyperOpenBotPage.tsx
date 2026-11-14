// OpenBot channel/provider integration adapted from pinned f8af37a. Copyright (c) 2026 CopilotKit, MIT.
import { useEffect, useState } from 'react';
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { HyperConversationActions } from './HyperConversationActions';
import { Button } from '@/components/ui/button';
import { HyperOpenBotProvider } from './provider';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN, hyperOpenBotRequest as request } from './transport';
import { HyperComposer, type HyperComposerAttachment, type HyperModelOption, type HyperModelPick } from './composer';
import { HyperMarkdown, HyperTranscript, type HyperTranscriptMessage } from './transcript';
import { HyperBotProfileScreen, HyperConnectionsScreen, HyperBotRosterScreen, HyperConversationsScreen, HyperSkillsScreen, type HyperConnection, type HyperBotNotify, type HyperBot, type HyperConversation, type HyperSkill } from './screens';

type HyperChannel = HyperConversation & { threadId: string; agentIds: string[]; active: boolean };
function HyperChannelChat({ channel }: { channel: HyperChannel }) {
  const { copilotkit } = useCopilotKit();
  const { agent, isReady } = useAgent({ agentId: `channel:${channel.id}`, runtimeAgentId: channel.agentIds[0], threadId: channel.threadId });
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState(true);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<(HyperComposerAttachment & { mimeType: string })[]>([]);
  const [models, setModels] = useState<HyperModelOption[]>([]);
  const [pick, setPick] = useState<HyperModelPick>({ model: '', effort: null });
  useEffect(() => {
    void Promise.all([request<{ models: HyperModelOption[]; default: string }>('/api/models'), request<HyperModelPick>(`/api/channels/${channel.id}/model`)]).then(([catalogue, saved]) => { setModels(catalogue.models); setPick({ model: saved.model || catalogue.default, effort: saved.effort }); }).catch(error => setError(String(error)));
  }, [channel.id]);
  useEffect(() => {
    if (!isReady) return;
    let current = true;
    setRestoring(true);
    void copilotkit.connectAgent({ agent }).catch(error => { if (current) setError(String(error)); }).finally(() => { if (current) setRestoring(false); });
    return () => { current = false; };
  }, [agent, copilotkit, isReady]);
  const messages: HyperTranscriptMessage[] = agent.messages.flatMap(message => {
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') return [];
    const tools = 'toolCalls' in message ? message.toolCalls?.map(call => {
      const result = agent.messages.find(each => each.role === 'tool' && each.toolCallId === call.id);
      return { id: call.id, label: call.function.name, arguments: call.function.arguments, result: result && typeof result.content === 'string' ? result.content : undefined, status: result ? 'complete' as const : agent.isRunning ? 'running' as const : 'not-yet' as const };
    }) : undefined;
    return [{ id: message.id, role: message.role, content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''), tools, live: sending, streaming: sending && agent.isRunning }];
  });
  return <div className="flex h-full min-h-0 flex-col">
    {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
    <HyperTranscript messages={messages} busy={sending} restoring={restoring} onOpenLink={url => void window.appflowy.shell.openExternal(url)} />
    <HyperConversationActions threadId={channel.threadId} />
    <HyperComposer className="m-4" autoFocus disabled={!isReady || restoring || !channel.active} pending={sending} attachments={attachments} onRemoveAttachment={id => { setAttachments(previous => previous.filter(file => file.id !== id)); void request(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(error => setError(String(error))); }} onConsumeAttachments={ids => setAttachments(previous => previous.filter(file => !ids.includes(file.id)))} onFiles={async files => {
      const group = crypto.randomUUID();
      for (const file of files) {
        const form = new FormData(); form.append('file', file); form.append('uploadGroup', group);
        const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/channels/${channel.id}/attachments`, { method: 'POST', body: form });
        const saved = await response.json();
        if (!response.ok || typeof saved.id !== 'string') throw new Error(saved.error ?? 'Attachment upload failed');
        setAttachments(previous => [...previous, { id: saved.id, name: saved.name, mimeType: saved.mimeType, status: 'ready' }]);
      }
    }} modelPicker={models.length ? { models, value: pick, disabled: sending, onChange: next => { void request<HyperModelPick>(`/api/channels/${channel.id}/model`, 'PUT', next).then(setPick).catch(error => setError(String(error))); } } : undefined} onStop={() => copilotkit.stopAgent({ agent })} onSubmit={async draft => {
      setError(undefined); setSending(true);
      agent.pendingInterrupts = agent.pendingInterrupts.filter(interrupt => !interrupt.metadata?.openbotWaiting);
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: attachments.length ? [{ type: 'text' as const, text: draft.text.trim() }, ...attachments.map(file => ({ type: file.mimeType.startsWith('image/') ? 'image' as const : 'document' as const, source: { type: 'url' as const, value: `/api/attachments/${file.id}`, mimeType: file.mimeType }, metadata: { attachmentId: file.id, filename: file.name } }))] : draft.text.trim() });
      try { await copilotkit.runAgent({ agent }); }
      catch (error) { setError(String(error)); throw error; }
      finally { setSending(false); }
    }} />
  </div>;
}
function HyperOpenBotWorkspace({ viewId }: { viewId: string }) {
  const [screen, setScreen] = useState<'conversations' | 'bots' | 'skills' | 'connections'>('conversations');
  const [channels, setChannels] = useState<HyperChannel[]>([]);
  const [bots, setBots] = useState<HyperBot[]>([]);
  const [skills, setSkills] = useState<HyperSkill[]>([]);
  const [connections, setConnections] = useState<HyperConnection[]>([]);
  const [profile, setProfile] = useState<HyperBot>();
  const [lifecycle, setLifecycle] = useState<{ paused: boolean; notify: HyperBotNotify }>({ paused: false, notify: 'all' });
  const [detail, setDetail] = useState<{ title: string; content: string }>();
  const [channel, setChannel] = useState<HyperChannel>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError(undefined);
    try {
      const [list, roster, plugins, connected] = await Promise.all([request<{ channels: HyperChannel[] }>('/api/channels'), request<{ agents: HyperBot[] }>('/api/agents'), request<{ skills: HyperSkill[]; servers: { id: string; title?: string; name?: string; description?: string }[] }>('/api/plugins'), request<{ connections: { serverId: string; revoked?: boolean; holder?: string; scope: string }[] }>('/api/plugins/connections')]);
      setChannels(list.channels); setBots(roster.agents); setSkills(plugins.skills); setConnections(connected.connections.map(row => { const server = plugins.servers.find(server => server.id === row.serverId); return { key: row.serverId, title: server?.title ?? server?.name ?? row.serverId, summary: server?.description ?? row.scope, state: row.revoked ? 'needs_reconnect' : row.holder === 'deployment' ? 'team' : 'connected' }; }));
      const remembered = localStorage.getItem(`hyper-openbot.channel.${viewId}`);
      if (remembered) setChannel(list.channels.find(each => each.id === remembered));
    } catch (error) { setError(String(error)); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [viewId]);
  function open(id: string) { const found = channels.find(each => each.id === id); if (found) { setChannel(found); localStorage.setItem(`hyper-openbot.channel.${viewId}`, id); } }
  async function start(botId: string) {
    try { const value = await request<{ channel: HyperChannel }>('/api/channels', 'POST', { agentIds: [botId] }); setChannels(previous => [value.channel, ...previous]); setChannel(value.channel); localStorage.setItem(`hyper-openbot.channel.${viewId}`, value.channel.id); }
    catch (error) { setError(String(error)); }
  }
  const state = { loading, error, onRetry: () => void refresh() };
  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <nav aria-label="OpenBot" className="flex shrink-0 gap-1 border-b border-border p-2">
      {(['conversations', 'bots', 'skills', 'connections'] as const).map(tab => <Button key={tab} variant={screen === tab && !channel ? 'secondary' : 'ghost'} onClick={() => { setScreen(tab); setChannel(undefined); setProfile(undefined); setDetail(undefined); }}>{tab === 'conversations' ? 'Conversations' : tab === 'bots' ? 'Bots' : tab === 'skills' ? 'Skills' : 'Connections'}</Button>)}
      <Button variant="ghost" onClick={() => void refresh()}>Refresh</Button>
    </nav>
    {error && channel && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
    {detail ? <section className="overflow-y-auto p-4"><h2 className="mb-4 text-xl font-semibold">{detail.title}</h2><HyperMarkdown content={detail.content} onOpenLink={url => void window.appflowy.shell.openExternal(url)} /></section> : profile ? <HyperBotProfileScreen {...state} bot={profile} paused={lifecycle.paused} notify={lifecycle.notify} onChat={() => { void start(profile.id); setProfile(undefined); }} onSetPaused={paused => { void request<{ lifecycle: typeof lifecycle }>(`/api/bots/${encodeURIComponent(profile.id)}/${paused ? 'pause' : 'resume'}`, 'POST').then(value => setLifecycle(value.lifecycle)).catch(error => setError(String(error))); }} onSetNotify={notify => { void request<{ lifecycle: typeof lifecycle }>(`/api/bots/${encodeURIComponent(profile.id)}/notifications`, 'PUT', { notify }).then(value => setLifecycle(value.lifecycle)).catch(error => setError(String(error))); }} /> : channel ? <HyperChannelChat key={channel.id} channel={channel} /> : screen === 'bots' ? <HyperBotRosterScreen {...state} bots={bots} onOpen={id => { setProfile(bots.find(bot => bot.id === id)); void request<{ lifecycle: typeof lifecycle }>(`/api/bots/${encodeURIComponent(id)}/lifecycle`).then(value => setLifecycle(value.lifecycle)).catch(error => setError(String(error))); }} /> : screen === 'skills' ? <HyperSkillsScreen {...state} skills={skills} bots={bots} onOpen={slug => { const skill = skills.find(skill => skill.slug === slug); if (skill) setDetail({ title: skill.title, content: skill.summary ?? '' }); }} /> : screen === 'connections' ? <HyperConnectionsScreen {...state} connections={connections} onOpen={key => { const row = connections.find(row => row.key === key); if (row) setDetail({ title: row.title, content: `${row.summary}\n\nStatus: ${row.state}` }); }} /> : <HyperConversationsScreen {...state} conversations={channels} onOpen={open} onNew={() => setScreen('bots')} onSetPinned={async (id, pinned) => { await request(`/api/channels/${encodeURIComponent(id)}/pin`, 'PUT', { pinned }); await refresh(); }} onDelete={async id => { await request(`/api/channels/${encodeURIComponent(id)}`, 'DELETE'); await refresh(); }} />}
  </div>;
}
export function HyperOpenBotPage({ viewId }: { viewId: string }) {
  return <HyperOpenBotProvider><HyperOpenBotWorkspace viewId={viewId} /></HyperOpenBotProvider>;
}
