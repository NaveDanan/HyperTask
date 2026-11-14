// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperLoadProvider, type HyperModels } from './HyperPlatformApi';
export default function HyperProvidersSection() {
  const [data, setData] = useState<HyperModels>();
  const [error, setError] = useState('');
  async function load() { setError(''); try { setData(await hyperLoadProvider()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load provider'); } }
  useEffect(() => { void load(); }, []);
  return <section className="space-y-4 p-6 text-sm"><h2 className="text-lg font-semibold">Providers</h2><Button variant="outline" onClick={() => void load()}>Refresh</Button>{error ? <p role="alert" className="text-destructive">{error}</p> : !data ? <p role="status">Loading provider…</p> : <><h3 className="font-medium">Connected</h3><p>{data.source} · {data.provider}</p><p>Default model: {data.default}</p>{!data.listed && <p role="status">The provider’s model listing could not be read.</p>}<h3 className="font-medium">Available models</h3>{data.models.length === 0 ? <p>No models available</p> : data.models.map(m => <div key={m.id} className="rounded-lg border border-border p-4"><p>{m.label}</p><p className="text-muted-foreground">{m.id}{m.efforts?.length ? ` · Thinking: ${m.efforts.join(', ')}` : ''}{m.defaultEffort ? ` · Default: ${m.defaultEffort}` : ''}</p></div>)}</>}</section>;
}
