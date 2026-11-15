// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { OpenGenerativeUIActivityRenderer } from '@copilotkit/react-core/v2';
import { useEffect, useState } from 'react';
import { hyperGalleryComponent as lookup } from './HyperGalleryRegistry';
import { hyperScreensApi } from './HyperScreensApi';
import { HyperReportContext } from './HyperReportContext';
import type { PublishedSandboxed } from './HyperScreensTypes';
/** Transcript seam: pass the calling Bot, complete tool arguments and a durable response callback.
 * Never infer the calling Bot from the currently selected conversation. Unknown/missing identity fails closed. */
export function HyperInteractiveResult({name, agentId, args, complete = true, respond, result, ask}: {name: string; agentId: string; args: Record<string, unknown>; complete?: boolean; ask?: (text: string) => void; result?: string; respond?: (value: unknown) => Promise<void>}) {
  const [state, setState] = useState<{allowed: boolean; reason?: string; source?: PublishedSandboxed; key?: string} | null>(null);
  const spec = lookup(name);
  const permissionKey = JSON.stringify([name, agentId, args, complete]);
  useEffect(() => {
    let live = true;
    let generation = 0;
    setState(null);
    const check = async () => {
      const current = ++generation;
      if (!agentId || !complete) return;
      const decision = await hyperScreensApi.decision(name, agentId, spec?.reads?.(args));
      if (!live || current !== generation) return;
      let source: PublishedSandboxed | undefined;
      if (decision.allowed && !spec) {
        try { source = (await hyperScreensApi.published()).find(item => item.name === name); }
        catch { if (live && current === generation) setState({key: permissionKey, allowed: false, reason: 'The published component could not be loaded.'}); return; }
      }
      if (live && current === generation) setState({...decision, source, key: permissionKey});
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {live = false; clearInterval(timer);};
  }, [name, agentId, permissionKey, complete, spec]);
  useEffect(() => {
    if (state?.key === permissionKey && !state.allowed && respond) void respond(state.reason ?? 'This component is not available to this Bot.');
  }, [state, permissionKey, respond]);
  if (!agentId) return <p role="alert">The calling Bot is required to check component permission.</p>;
  if (!complete || !state || state.key !== permissionKey) return <p role="status">Drawing {name}…</p>;
  if (!state.allowed) return <p role="alert">{state.reason ?? 'This component is not available to this Bot.'}</p>;
  if (spec) {
    const verdict = spec.parameters?.['~standard']?.validate(args);
    if (verdict && !(verdict instanceof Promise) && verdict.issues) return <p role="alert">This component received unreadable arguments.</p>;
  }
  if (spec) return <HyperReportContext.Provider value={{botId: agentId, ask}}><spec.Component {...args} args={args} status={respond ? "executing" : "complete"} result={result} respond={respond} /></HyperReportContext.Provider>;
  if (!state.source) return <p role="alert">This build cannot draw {name}.</p>;
  return <HyperSandboxPreview source={state.source} args={args} />;
}
/** SDK owns the sandbox iframe and its CSP. Source is never evaluated in the Electron main world. */
export function HyperSandboxPreview({source, args}: {source: PublishedSandboxed; args: Record<string, unknown>}) {
  return <OpenGenerativeUIActivityRenderer key={JSON.stringify([source, args])} activityType="open-generative-ui" agent={null} message={null} content={{css: source.css, cssComplete: true, html: [source.html], htmlComplete: true, jsFunctions: `window.__args = ${JSON.stringify(args)};\n${source.jsFunctions}`, jsFunctionsComplete: true, generating: false}} />;
}
