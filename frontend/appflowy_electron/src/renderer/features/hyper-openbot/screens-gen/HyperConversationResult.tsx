import { HyperAppAccessAction } from '../connections';
import { readConnectPrompt, SHOW_APP_ACCESS_TOOL } from './HyperConnectPrompt';
// Adapted from OpenBot lib/copilot/gallery-tools.tsx and sandboxed-tools.tsx.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { HyperGenerativeActivity } from './HyperGenerativeActivity';
import { useHyperGalleryCall, hyperAnswerGalleryCall } from './HyperGalleryRuntime';
import { HyperToolMessage, type HyperToolMessageProps } from '../transcript/HyperTranscript';
import { hyperGalleryComponent } from './HyperGalleryRegistry';
import { HyperInteractiveResult } from './HyperInteractiveResult';
import { useHyperRoutineNavigation } from '../routines/HyperRoutineNavigation';
import { hyperConnectionSelectionPath } from '../connections/HyperNativeConnections';

/** Identity must come from call provenance, never the selected channel or model arguments. */
export function HyperConversationResult({tool, callingBotId, ask}: {tool: HyperToolMessageProps; callingBotId?: string; ask?: (text: string) => void}) {
  const pending = useHyperGalleryCall(tool.id);
  const navigation = useHyperRoutineNavigation();
  if (tool.label === 'open-generative-ui') {
    try {return <HyperGenerativeActivity content={JSON.parse(tool.arguments ?? '{}')} />;}
    catch {return <p role="alert">The generated screen could not be read.</p>;}
  }
  let accessResult = tool.result;
  try { const decoded: unknown = JSON.parse(accessResult ?? ''); if (typeof decoded === 'string') accessResult = decoded; } catch { /* Plain protocol result. */ }
  const prompt = tool.label === SHOW_APP_ACCESS_TOOL || tool.status === 'refused' ? readConnectPrompt(accessResult) : null;
  if (prompt && callingBotId && (!prompt.agentId || prompt.agentId === callingBotId)) return <HyperToolMessage {...tool}><HyperAppAccessAction key={`${callingBotId}:${prompt.serverId}`} agentId={callingBotId} app={prompt.serverId} refusal={prompt.reason === 'access' ? undefined : prompt.reason ?? 'connect'} refusalAt={prompt.at} onOpenConnection={navigation?.navigate ? key => { if (navigation.isCurrentNavigation?.() !== false) navigation.navigate?.('connections', { path: hyperConnectionSelectionPath({ page: 'app', key }) }); } : undefined} /></HyperToolMessage>;
  const known = hyperGalleryComponent(tool.label) || tool.label.startsWith('custom_');
  if (!known) return <HyperToolMessage {...tool} />;
  let result = tool.result;
  try { const value: unknown = JSON.parse(result ?? ''); if (typeof value === 'string') result = value; } catch { /* Plain protocol sentence. */ }
  if (result?.startsWith('Not drawn:') || result?.startsWith('Not asked:')) return null;
  if (result?.startsWith('Not shown:') || tool.status === 'refused' || (tool.status === 'failed' && hyperGalleryComponent(tool.label)?.kind !== 'decision')) return <HyperToolMessage {...tool} status={tool.status === 'failed' ? 'failed' : 'refused'} />;
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(tool.arguments ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    args = parsed as Record<string, unknown>;
  } catch {
    return <p role={tool.status === 'running' ? 'status' : 'alert'}>{tool.status === 'running' ? `Drawing ${tool.label}…` : 'This component received unreadable arguments.'}</p>;
  }
  return <HyperInteractiveResult name={tool.label} agentId={pending?.botId ?? callingBotId ?? ''} ask={ask} args={args} complete={tool.status !== 'running' || !!pending} result={result} respond={pending ? async value => {hyperAnswerGalleryCall(tool.id, value);} : undefined} />;
}
