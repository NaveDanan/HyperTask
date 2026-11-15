// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { OpenGenerativeUIActivityRenderer } from '@copilotkit/react-core/v2';
import { useEffect, useRef, useState } from 'react';
import { hyperGalleryComponent as lookup } from './HyperGalleryRegistry';
import { hyperScreensApi } from './HyperScreensApi';
import { HyperReportContext } from './HyperReportContext';
import { hyperSettledGalleryArguments } from './HyperSettledGalleryArguments';
import { HyperGalleryDecidedContext, HyperGalleryStreamingContext } from './streaming';
import type { PublishedSandboxed } from './HyperScreensTypes';

export interface HyperInteractiveResultProps {
  name: string;
  agentId: string;
  args: Record<string, unknown>;
  complete?: boolean;
  decided?: boolean;
  callId?: string;
  ask?: (text: string) => void;
  result?: string;
  respond?: (value: unknown) => Promise<void>;
}
/** Never infer the calling Bot from selection. A partial display cannot answer or read report data. */
export function HyperInteractiveResult({name, agentId, args, complete = true, decided = complete, callId, respond, result, ask}: HyperInteractiveResultProps) {
  const [state, setState] = useState<{allowed: boolean; reason?: string; source?: PublishedSandboxed; key?: string; grantKey?: string} | null>(null);
  const spec = lookup(name);
  const permissionKey = JSON.stringify([name, agentId, args, complete]);
  const functions = spec?.reads && complete && decided ? spec.reads(args) : [];
  const canCheck = !!agentId.trim() && (complete || !!spec && spec.kind !== 'decision') && (!spec?.reads || complete && decided) && (!!spec || decided);
  // Grants cover the component, Bot and declared data functions. Argument deltas do not change
  // that permission, so streaming updates keep the same mounted widget and permission read.
  const grantKey = JSON.stringify([callId, name, agentId, canCheck, functions]);
  const validState = !!state && (state.grantKey ? state.grantKey === grantKey : state.key === permissionKey);
  const scope = JSON.stringify([permissionKey, grantKey, decided, result]);
  const current = useRef({active: true, scope, grantKey, token: {}, allowed: false, respond, ask});
  const token = current.current.scope === scope ? current.current.token : {};
  current.current = {active: current.current.active, scope, grantKey, token, allowed: validState && !!state?.allowed, respond, ask};
  useEffect(() => {
    current.current.active = true;
    return () => {current.current.active = false;};
  }, []);
  useEffect(() => {
    let live = true;
    let generation = 0;
    setState(null);
    const check = async () => {
      const attempt = ++generation;
      if (!canCheck) return;
      const decision = await hyperScreensApi.decision(name, agentId, functions);
      if (!live || attempt !== generation || current.current.grantKey !== grantKey) return;
      let source: PublishedSandboxed | undefined;
      if (decision.allowed && !spec) {
        try { source = (await hyperScreensApi.published()).find(item => item.name === name); }
        catch { if (live && attempt === generation && current.current.grantKey === grantKey) setState({key: permissionKey, grantKey, allowed: false, reason: 'The published component could not be loaded.'}); return; }
      }
      if (live && attempt === generation && current.current.grantKey === grantKey) {
        // Cached callbacks must stop at revocation even before React commits its next render.
        current.current.allowed = decision.allowed;
        setState({...decision, source, key: permissionKey, grantKey});
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {live = false; clearInterval(timer);};
  }, [name, agentId, grantKey]);
  const response = complete && decided && result === undefined && respond ? async (value: unknown) => {
    const now = current.current;
    if (now.active && now.token === token && now.allowed && now.respond === respond) await respond(value);
  } : undefined;
  const followUp = complete && decided && ask ? (text: string) => {
    const now = current.current;
    if (now.active && now.token === token && now.allowed && now.ask === ask) ask(text);
  } : undefined;
  useEffect(() => {
    if (!validState || !state || state.allowed || !complete || !decided || !respond || result !== undefined) return;
    const now = current.current;
    if (now.active && now.token === token && now.respond === respond) {
      void respond(state.reason ?? 'This component is not available to this Bot.').catch(() => undefined);
    }
  }, [state, validState, complete, decided, respond, result, token]);
  if (!agentId.trim()) return <p role="alert">The calling Bot is required to check component permission.</p>;
  if (!canCheck || !validState || !state) return <p role="status">Drawing {name}…</p>;
  if (!state.allowed) return <p role="alert">{state.reason ?? 'This component is not available to this Bot.'}</p>;
  // Partial compiled props are validated by their original streaming-aware widgets. Decisions keep
  // their invalid-input response/retry path. Final non-decision arguments still need their schema.
  if (complete && spec && spec.kind !== 'decision') {
    const verdict = spec.parameters?.['~standard']?.validate(args);
    if (verdict && !(verdict instanceof Promise) && verdict.issues) return <p role="alert">This component received unreadable arguments.</p>;
  }
  if (spec) {
    // Model data must not create interaction callbacks. A record's `status` remains display data;
    // only a decision receives the SDK interaction envelope.
    const {respond: _respond, ask: _ask, args: _args, result: _result, ...displayArgs} = hyperSettledGalleryArguments(args, complete);
    const props = spec.kind === 'decision'
      ? {...displayArgs, args, status: response ? 'executing' : 'complete', result, respond: response}
      : displayArgs;
    return <HyperGalleryStreamingContext.Provider value={!complete}><HyperGalleryDecidedContext.Provider value={decided}><HyperReportContext.Provider value={{botId: agentId, ask: followUp}}><spec.Component {...props} /></HyperReportContext.Provider></HyperGalleryDecidedContext.Provider></HyperGalleryStreamingContext.Provider>;
  }
  if (!state.source) return <p role="alert">This build cannot draw {name}.</p>;
  return <HyperSandboxPreview source={state.source} args={args} />;
}
/** SDK owns the sandbox iframe and its CSP. Source is never evaluated in the Electron main world. */
export function HyperSandboxPreview({source, args}: {source: PublishedSandboxed; args: Record<string, unknown>}) {
  return <OpenGenerativeUIActivityRenderer key={JSON.stringify([source, args])} activityType="open-generative-ui" agent={null} message={null} content={{css: source.css, cssComplete: true, html: [source.html], htmlComplete: true, jsFunctions: `window.__args = ${JSON.stringify(args)};\n${source.jsFunctions}`, jsFunctionsComplete: true, generating: false}} />;
}
