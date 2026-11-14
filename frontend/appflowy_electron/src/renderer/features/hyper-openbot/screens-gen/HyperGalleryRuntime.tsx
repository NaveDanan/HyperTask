// Adapted from OpenBot lib/copilot/gallery-tools.tsx, sandboxed-tools.tsx and bot-offer.ts.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { useCopilotKit, useFrontendTool, type AbstractAgent } from '@copilotkit/react-core/v2';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { defer, mergeMap } from 'rxjs';
import { z } from 'zod';
import { hyperRuntimeBotOf } from '../runtime';
import { hyperScreensApi as api } from './HyperScreensApi';
import { GALLERY_COMPONENTS, HyperGalleryManifest, hyperGalleryComponent, type HyperGalleryComponent } from './HyperGalleryRegistry';
import type { PublishedSandboxed } from './HyperScreensTypes';
import { hyperOpenBotRequest as request } from '../transport';

export const HYPER_NOT_DRAWN = 'Not drawn: you called this in the same step as other tools, before their results came back. Draw it now, from those results.';
export const HYPER_NOT_ASKED = 'Not asked: you called this in the same step as other tools, before their results came back. Ask it now, from those results.';
type Pending = {botId: string; resolve: (value: unknown) => void; reject: (reason: Error) => void; stop: () => void};
const waiting = new Map<string, Pending>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function hyperAnswerGalleryCall(id: string, value: unknown) {
  const call = waiting.get(id);
  if (!call) return;
  waiting.delete(id); call.stop(); emit(); call.resolve(value);
}
export function useHyperGalleryCall(id: string) {
  return useSyncExternalStore(listener => {listeners.add(listener); return () => {listeners.delete(listener);};}, () => waiting.get(id), () => undefined);
}
const prepared = new WeakSet<AbstractAgent>();
/** Bound runtime identity is the same channel runtimeAgentId used upstream, independent of selection. */
export function hyperPrepareGalleryAgent(agent: AbstractAgent) {
  if (prepared.has(agent)) return;
  prepared.add(agent);
  agent.use((input, next) => defer(async () => {
    const bot = hyperRuntimeBotOf(agent);
    const held = bot ? await request<{components: {name: string; description: string}[]}>(`/api/components/for-agent/${encodeURIComponent(bot)}`).catch(() => ({components: []})) : {components: []};
    const descriptions = new Map(held.components.map(item => [item.name, item.description]));
    return {...input, tools: input.tools.filter(tool => !hyperGalleryComponent(tool.name) && !tool.name.startsWith('custom_') || descriptions.has(tool.name)).map(tool => descriptions.has(tool.name) ? {...tool, description: descriptions.get(tool.name)!} : tool)};
  }).pipe(mergeMap(input => next.run(input))));
}
export async function hyperExecuteGalleryCall(spec: Pick<HyperGalleryComponent, 'name' | 'title' | 'kind' | 'confirmation' | 'reads'>, args: Record<string, unknown>, context: {agent?: {runtimeAgentId?: string; agentId?: string; messages?: readonly {role: string; toolCalls?: readonly {id: string; function: {name: string}}[]}[]}; toolCall?: {id: string}; signal?: AbortSignal}) {
  const step = context.agent?.messages?.find(message => message.toolCalls?.some(call => call.id === context.toolCall?.id))?.toolCalls;
  if (step?.some(call => !hyperGalleryComponent(call.function.name) && !call.function.name.startsWith('custom_'))) return spec.kind === 'decision' ? HYPER_NOT_ASKED : HYPER_NOT_DRAWN;
  const botId = hyperRuntimeBotOf(context.agent) ?? '';
  const decision = await api.decision(spec.name, botId, spec.reads?.(args));
  if (!decision.allowed) return `Not shown: ${spec.title}. ${decision.reason ?? 'That component is not allowed here.'} Nothing was displayed, so tell the person that.`;
  if (spec.kind !== 'decision') return spec.confirmation ?? 'It is now on screen for the person.';
  const id = context.toolCall?.id;
  if (!id) throw new Error('A decision needs a tool call identity.');
  return new Promise<unknown>((resolve, reject) => {
    const abort = () => {if (waiting.get(id)?.resolve === resolve) {waiting.delete(id); emit();} reject(new Error('Human-in-the-loop interaction aborted'));};
    if (context.signal?.aborted) {abort(); return;}
    context.signal?.addEventListener('abort', abort, {once: true});
    waiting.set(id, {botId, resolve, reject, stop: () => context.signal?.removeEventListener('abort', abort)}); emit();
  });
}
function HyperRegisteredGalleryTool({spec}: {spec: HyperGalleryComponent}) {
  const { copilotkit } = useCopilotKit();
  useEffect(() => () => copilotkit.removeHookRenderToolCall(spec.name), [copilotkit, spec.name]);
  useFrontendTool({name: spec.name, description: spec.description, parameters: spec.parameters,
    ...(spec.kind === 'decision' ? {type: 'human-in-the-loop' as const} : {}),
    handler: (args, context) => hyperExecuteGalleryCall(spec, args, context),
    render: () => null,
  });
  return null;
}
function HyperRegisteredSandbox({source}: {source: PublishedSandboxed}) {
  let parameters = z.object({}).catchall(z.unknown());
  try { const parsed = z.fromJSONSchema(source.argumentSchema); if (parsed instanceof z.ZodObject) parameters = parsed as typeof parameters; } catch { /* Upstream permissive fallback. */ }
  useFrontendTool({name: source.name, description: `A component authored in this deployment: ${source.name}.`, parameters,
    handler: (args, context) => hyperExecuteGalleryCall({name: source.name, title: source.name, kind: 'card'}, args, context), render: () => null});
  return null;
}
export function HyperGalleryTools() {
  const [sources, setSources] = useState<PublishedSandboxed[]>([]);
  useEffect(() => {
    void request('/api/components/catalogue', 'PUT', {components: HyperGalleryManifest()}).catch(() => undefined);
    let live = true;
    const refresh = () => void api.published().then(items => {if (live) setSources(items);}).catch(() => {if (live) setSources([]);});
    refresh(); const timer = setInterval(refresh, 30000);
    return () => {live = false; clearInterval(timer);};
  }, []);
  return <>{GALLERY_COMPONENTS.map(spec => <HyperRegisteredGalleryTool key={spec.name} spec={spec} />)}{sources.map(source => <HyperRegisteredSandbox key={source.name} source={source} />)}</>;
}
