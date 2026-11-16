// Adapted from pinned OpenBot components/component-preview.tsx.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { useEffect, useRef, useState } from 'react';
import { HyperSandboxPreview } from './HyperInteractiveResult';
import { hyperScreensApi } from './HyperScreensApi';
import type { SandboxedRecord } from './HyperScreensTypes';

/** Saved samples are administrator working-copy data, never fetched by the personal gallery. */
export function HyperAdminComponentPreview({name, published, version}: {name: string; published: boolean; version: string}) {
  const key = JSON.stringify([name, published, version]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [state, setState] = useState<{key: string; record?: SandboxedRecord; error?: boolean}>();
  useEffect(() => {
    let live = true, generation = 0;
    const refresh = async () => {
      const attempt = ++generation;
      // Clear old published artwork while its replacement or a revoked admin read is checked.
      setState(undefined);
      try {
        const records = await hyperScreensApi.sandboxed();
        if (live && currentKey.current === key && attempt === generation) setState({key, record: records.find(item => item.name === name)});
      } catch {
        if (live && currentKey.current === key && attempt === generation) setState({key, error: true});
      }
    };
    void refresh(); window.addEventListener('focus', refresh);
    return () => {live = false; window.removeEventListener('focus', refresh);};
  }, [key, name]);
  if (!published) return <p className="text-xs text-muted-foreground">Publish in the playground to see a preview.</p>;
  if (!state || state.key !== key) return <p role="status">Loading preview…</p>;
  if (state.error) return <p role="status">Preview could not be loaded.</p>;
  if (!state.record) return <p className="text-xs text-muted-foreground">Published in the playground.</p>;
  return <HyperPublishedSamplePreview record={state.record} />;
}
/** This is artwork, with no calling Bot, decision callback or data-function bridge. */
export function HyperPublishedSamplePreview({record}: {record: SandboxedRecord}) {
  if (!record.published || record.publishedHtml === null) return <p className="text-xs text-muted-foreground">Publish in the playground to see a preview.</p>;
  return <div className="pointer-events-none w-full" aria-hidden="true" inert title="Published component with saved sample arguments"><HyperSandboxPreview source={{name: record.name, html: record.publishedHtml, css: record.publishedCss ?? '', jsFunctions: record.publishedJsFunctions ?? '', argumentSchema: record.publishedArgumentSchema ?? {}}} args={record.sampleArguments} /></div>;
}
