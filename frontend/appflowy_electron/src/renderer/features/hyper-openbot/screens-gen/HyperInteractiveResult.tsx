// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { OpenGenerativeUIActivityRenderer } from '@copilotkit/react-core/v2';
import { useEffect, useState } from 'react';
import { hyperGalleryComponent as lookup } from './HyperGalleryRegistry';
import { hyperScreensApi } from './HyperScreensApi';
import type { PublishedSandboxed } from './HyperScreensTypes';
/** Transcript seam: pass the calling Bot, complete tool arguments and a durable response callback.
 * Never infer the calling Bot from the currently selected conversation. Unknown/missing identity fails closed. */
export function HyperInteractiveResult({name, agentId, args, complete = true, respond}: {name: string; agentId: string; args: Record<string, unknown>; complete?: boolean; respond?: (value: string) => void}) {
  const [state, setState] = useState<{allowed: boolean; reason?: string; source?: PublishedSandboxed; key?: string} | null>(null);
  const spec = lookup(name);
  const permissionKey = JSON.stringify([name, agentId, args, complete]);
  useEffect(() => {
    let live = true;
    setState(null);
    const check = async () => {
      if (!agentId || !complete) return;
      const decision = await hyperScreensApi.decision(name, agentId, spec?.reads?.(args));
      let source: PublishedSandboxed | undefined;
      if (decision.allowed && !spec) {
        try { source = (await hyperScreensApi.published()).find(item => item.name === name); }
        catch { if (live) setState({key: permissionKey, allowed: false, reason: 'The published component could not be loaded.'}); return; }
      }
      if (live) setState({...decision, source, key: permissionKey});
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {live = false; clearInterval(timer);};
  }, [name, agentId, permissionKey, complete, spec]);
  if (!agentId) return <p role="alert">The calling Bot is required to check component permission.</p>;
  if (!complete || !state || state.key !== permissionKey) return <p role="status">Drawing {name}…</p>;
  if (!state.allowed) return <p role="alert">{state.reason ?? 'This component is not available to this Bot.'}</p>;
  if (spec) return <spec.Component {...args} args={args} status="complete" respond={respond} />;
  if (!state.source) return <p role="alert">This build cannot draw {name}.</p>;
  return <HyperSandboxPreview source={state.source} args={args} />;
}
/** SDK owns the sandbox iframe and its CSP. Source is never evaluated in the Electron main world. */
export function HyperSandboxPreview({source, args}: {source: PublishedSandboxed; args: Record<string, unknown>}) {
  return <OpenGenerativeUIActivityRenderer key={JSON.stringify([source, args])} activityType="open-generative-ui" agent={null} message={null} content={{css: source.css, cssComplete: true, html: [source.html], htmlComplete: true, jsFunctions: `window.__args = ${JSON.stringify(args)};\n${source.jsFunctions}`, jsFunctionsComplete: true, generating: false}} />;
}
