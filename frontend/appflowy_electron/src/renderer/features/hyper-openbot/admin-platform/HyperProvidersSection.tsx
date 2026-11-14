// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { hyperLoadProvider, hyperLoadProviderControls, hyperLoadModelUsage, hyperSaveModelAllowlist, type HyperProviderControls, type HyperModelUsage, type HyperModels } from './HyperPlatformApi';
export default function HyperProvidersSection() {
  const [data, setData] = useState<HyperModels>();
  const [controls, setControls] = useState<HyperProviderControls>();
  const [usage, setUsage] = useState<HyperModelUsage>();
  const [selected, setSelected] = useState<string[]>();
  const [other, setOther] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() { setError(''); try { const next = await hyperLoadProvider(); setData(next); if (next.exposure === 'allowed') setControls(await hyperLoadProviderControls()); setUsage(await hyperLoadModelUsage()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load provider'); } }
  useEffect(() => { void load(); }, []);
  async function save(value: HyperProviderControls['settings']['modelAllowlist']) {
    setBusy(true); setError('');
    try { await hyperSaveModelAllowlist(value); setSelected(undefined); }
    catch { setError('Could not save the model allowlist. Check your permissions and retry.'); }
    finally { await load(); setBusy(false); }
  }
  return <section className="space-y-4 p-6 text-sm"><h2 className="text-lg font-semibold">Providers</h2><Button variant="outline" onClick={() => void load()}>Refresh</Button>{error ? <p role="alert" className="text-destructive">{error}</p> : !data ? <p role="status">Loading provider…</p> : <><h3 className="font-medium">Connected</h3><p>{data.source} · {data.provider}</p><p>Default model: {data.default}</p>{!data.listed && <p role="status">The provider’s model listing could not be read.</p>}<h3 className="font-medium">Available models</h3>{data.models.length === 0 ? <p>No models available</p> : data.models.map(m => <div key={m.id} className="rounded-lg border border-border p-4"><p>{m.label}</p><p className="text-muted-foreground">{m.id}{m.efforts?.length ? ` · Thinking: ${m.efforts.join(', ')}` : ''}{m.defaultEffort ? ` · Default: ${m.defaultEffort}` : ''}</p></div>)}</>}
    {data && <><h3 className="font-medium">In conversations</h3><p>{data.exposure === 'all' ? 'Every listed model and its thinking level are available.' : 'People pick among allowed models. Until you allow one, conversations use the default.'}</p></>}
    {controls && <div className="space-y-3 rounded-lg border border-border p-4"><h3>Allowed models</h3><label className="flex gap-2"><input type="checkbox" checked={controls.settings.modelAllowlist.enabled} disabled={busy} onChange={e => void save({ ...controls.settings.modelAllowlist, enabled: e.target.checked })} />Only allowed models</label><p>{controls.settings.modelAllowlist.models.join(', ') || 'None listed'}</p><Button disabled={busy} onClick={() => setSelected([...controls.settings.modelAllowlist.models])}>Edit allowed models</Button>
    {selected && <div className="space-y-3"><Input aria-label="Search models" value={search} onChange={e => setSearch(e.target.value)} />{[...new Set([...selected, ...(data?.models.map(m => `${data.provider}/${m.id}`) ?? [])])].filter(name => name.toLowerCase().includes(search.toLowerCase())).map(name => <label className="flex gap-2" key={name}><input type="checkbox" checked={selected.includes(name)} disabled={busy} onChange={e => setSelected(e.target.checked ? [...selected, name] : selected.filter(n => n !== name))} />{name}{name === `${data?.provider}/${data?.default}` ? ' · default' : ''}</label>)}<Input aria-label="Another model" placeholder="provider/model" value={other} onChange={e => setOther(e.target.value)} /><Button disabled={busy || !/^[^\s/]+\/\S+$/.test(other.trim())} onClick={() => { setSelected([...new Set([...selected, other.trim()])]); setOther(''); }}>Add model</Button><p>The default stays offered. With Only allowed models on, a built-in Bot on it is refused unless allowed.</p><Button disabled={busy} onClick={() => void save({ ...controls.settings.modelAllowlist, models: selected })}>Save</Button><Button variant="outline" disabled={busy} onClick={() => setSelected(undefined)}>Cancel</Button></div>}</div>}
    <h3 className="font-medium">Usage · last 30 days</h3>{usage && (usage.summary.length ? usage.summary.map(row => <div className="rounded-lg border border-border p-4" key={`${row.model}-${row.source}`}><p>{row.model} · {row.source}</p><p>{row.runs} runs by {row.people} people · {row.refused} off the allowlist · {new Date(row.lastUsedAt).toLocaleDateString()}</p></div>) : <p>No recent runs. Runs appear once a Bot answers.</p>)}
    </section>;
}
