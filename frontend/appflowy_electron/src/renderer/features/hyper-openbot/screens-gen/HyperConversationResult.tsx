import type { HyperAppCarryOn } from '../connections/HyperAppAccessAction';
import { HyperAppAccessAction } from '../connections';
import { readConnectPrompt, SHOW_APP_ACCESS_TOOL } from './HyperConnectPrompt';
// Adapted from OpenBot lib/copilot/gallery-tools.tsx and sandboxed-tools.tsx.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { HyperGenerativeActivity } from './HyperGenerativeActivity';
import { useHyperGalleryCall, hyperAnswerGalleryCall } from './HyperGalleryRuntime';
import { HyperToolMessage, type HyperToolMessageProps } from '../transcript/HyperTranscript';
import { hyperGalleryComponent } from './HyperGalleryRegistry';
import { HyperProgressiveGalleryResult } from './HyperProgressiveGalleryResult';
import { useHyperRoutineNavigation } from '../routines/HyperRoutineNavigation';
import { hyperConnectionSelectionPath } from '../connections/HyperNativeConnections';

/** Identity must come from call provenance, never the selected channel or model arguments. */
export function HyperConversationResult({tool, callingBotId, ask, appCarryOn, argumentsArriving = false, turnInFlight = false}: {tool: HyperToolMessageProps; callingBotId?: string; ask?: (text: string) => void; appCarryOn?: Omit<HyperAppCarryOn, 'blockedWhenAsked'>; argumentsArriving?: boolean; turnInFlight?: boolean}) {
  const pending = useHyperGalleryCall(tool.id);
  const navigation = useHyperRoutineNavigation();
  if (tool.label === 'open-generative-ui') {
    try {return <HyperGenerativeActivity content={JSON.parse(tool.arguments ?? '{}')} />;}
    catch {return <p role="alert">The generated screen could not be read.</p>;}
  }
  let accessResult = tool.result;
  try { const decoded: unknown = JSON.parse(accessResult ?? ''); if (typeof decoded === 'string') accessResult = decoded; } catch { /* Plain protocol result. */ }
  const accessMarker = tool.status === 'refused' ? accessResult?.trim().replace(/^Refused\.\s+/, '') : accessResult;
  const prompt = tool.label === SHOW_APP_ACCESS_TOOL || tool.status === 'refused' ? readConnectPrompt(accessMarker) : null;
  if (prompt && callingBotId && (!prompt.agentId || prompt.agentId === callingBotId)) return <HyperToolMessage {...tool}><HyperAppAccessAction key={`${callingBotId}:${prompt.serverId}`} agentId={callingBotId} app={prompt.serverId} deriveAdmin carryOn={appCarryOn ? { ...appCarryOn, blockedWhenAsked: prompt.reason !== 'access' || prompt.blocked === true } : undefined} refusal={prompt.reason === 'access' ? undefined : prompt.reason ?? 'connect'} refusalAt={prompt.at} onOpenConnection={navigation?.openAppConnection ? (key, intent) => { if (navigation.isCurrentNavigation?.() !== false) navigation.openAppConnection?.(key, { admin: intent?.admin === true, ...(intent?.provider ? { provider: intent.provider } : {}) }); } : navigation?.navigate ? (key, intent) => { if (navigation.isCurrentNavigation?.() !== false) navigation.navigate?.(intent?.admin ? 'admin-plugins' : 'connections', { path: hyperConnectionSelectionPath(intent?.provider ? { page: 'browse', provider: intent.provider } : { page: 'app', key }, intent?.admin) }); } : undefined} /></HyperToolMessage>;
  const known = hyperGalleryComponent(tool.label) || tool.label.startsWith('custom_');
  if (!known) return <HyperToolMessage {...tool} />;
  let result = tool.result;
  try { const value: unknown = JSON.parse(result ?? ''); if (typeof value === 'string') result = value; } catch { /* Plain protocol sentence. */ }
  if (result?.startsWith('Not drawn:') || result?.startsWith('Not asked:')) return null;
  if (result?.startsWith('Not shown:') || tool.status === 'refused' || (tool.status === 'failed' && hyperGalleryComponent(tool.label)?.kind !== 'decision')) return <HyperToolMessage {...tool} status={tool.status === 'failed' ? 'failed' : 'refused'} />;
  return <HyperProgressiveGalleryResult name={tool.label} agentId={pending?.botId ?? callingBotId ?? ''} ask={ask} callId={tool.id} arguments={tool.arguments} argumentsComplete={!argumentsArriving || tool.status !== 'running' || !!pending} decided={tool.result !== undefined || !turnInFlight || !!pending} result={result} respond={pending ? async value => { hyperAnswerGalleryCall(tool.id, value, pending); } : undefined} />;
}
