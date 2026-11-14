// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { hyperOpenBotRequest } from '../transport';
import { type MemoryRecord, type MemorySource, type MemorySourceTool, createMemory, updateMemory, deleteMemory, addMemorySource, memorySourceAction } from './HyperMemoryApi';

export function useHyperMemoryData<T>(path: string, key?: string, interval?: number) {
  const [data, setData] = useState<T>(); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setData(undefined); setError('');
    const load = () => hyperOpenBotRequest<Record<string, unknown>>(path).then(value => { if(active) { setData((key ? value[key] : value) as T); setError(''); } }).catch(() => { if(active) setError('Could not load this page. Access may be refused by the server.'); }).finally(() => { if(active) setLoading(false); });
    void load(); const timer = interval ? setInterval(load, interval) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [path, key, revision, interval]);
  return { data, error, loading, reload: () => setRevision(value => value + 1) };
}
export function HyperMemoryStatus({ loading, error }: { loading: boolean; error: string }) { return loading ? <p role="status">Loading…</p> : error ? <p role="alert" className="text-destructive">{error}</p> : null; }
export function useHyperMemoryAction(reload: () => void) {
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 return { busy,error, run: async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); reload(); return true; } catch { setError('The server could not save this change. Check your permissions and try again.'); return false; } finally { setBusy(false); } } };
}
export default function HyperMemorySection() {
 const memories=useHyperMemoryData<MemoryRecord[]>('/api/memory','memories');
 const capabilities=useHyperMemoryData<{edition?:string}>('/api/capabilities');
 const action=useHyperMemoryAction(memories.reload); const [content,setContent]=useState(''); const [editing,setEditing]=useState<string>();
 if(capabilities.data?.edition==='personal') return <p className="p-6">Memory is unavailable in the personal edition. Use your Bot's Routines instead.</p>;
 return <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6"><h2 className="text-lg font-semibold">Memory</h2><p>Facts you add are shared with all Bots; learned facts stay with the Bot that learned them.</p>
 <form className="grid gap-2" onSubmit={event=>{event.preventDefault(); void action.run(()=> editing ? updateMemory(editing,{content}) : createMemory(content)).then(ok=>{if(ok){setContent('');setEditing(undefined);}});}}><label htmlFor="hyper-memory-content">{editing?'Edit memory':'Remember a fact'}</label><Textarea id="hyper-memory-content" required maxLength={6000} value={content} onChange={event=>setContent(event.target.value)}/><div className="flex gap-2"><Button disabled={action.busy||!content.trim()}>{editing?'Save':'Remember'}</Button>{editing&&<Button type="button" variant="outline" onClick={()=>{setEditing(undefined);setContent('');}}>Cancel</Button>}</div></form>
 <HyperMemoryStatus {...memories}/>{action.error&&<p role="alert">{action.error}</p>}{memories.error&&<Button onClick={memories.reload}>Retry</Button>}
 {memories.data?.length===0&&<p>No memories yet. Add one with Remember a fact.</p>}
 {memories.data?.map(memory=><article className="grid gap-2 rounded-lg border p-4" key={memory.id}><p className="whitespace-pre-wrap">{memory.content}</p><p className="text-sm text-muted-foreground">{memory.provenance} · {memory.formedBy} · {memory.reviewState}</p>{memory.sourceApp&&<p>{memory.sourceApp} {memory.observedAt&&new Date(memory.observedAt).toLocaleString()}</p>}<div className="flex gap-2"><Button variant="outline" disabled={action.busy} onClick={()=>{setEditing(memory.id);setContent(memory.content);}}>Edit</Button>{memory.formedBy!=='intelligence'&&memory.reviewState==='unreviewed'&&<Button disabled={action.busy} onClick={()=>void action.run(()=>updateMemory(memory.id,{reviewState:'confirmed'}))}>Confirm</Button>}<Button variant="destructive" disabled={action.busy} onClick={()=>void action.run(()=>deleteMemory(memory.id))}>Forget</Button>{memory.formedBy!=='intelligence'&&<Switch aria-label="Use this memory" checked={memory.enabled} disabled={action.busy} onCheckedChange={enabled=>void action.run(()=>updateMemory(memory.id,{enabled}))}/>}</div></article>)}
 </section>;
}
export function HyperBotMemoryTab({agentId}:{agentId:string}) {
 const sources=useHyperMemoryData<MemorySource[]>('/api/memory/sources','sources',15000); const tools=useHyperMemoryData<MemorySourceTool[]>(`/api/memory/sources/available/${encodeURIComponent(agentId)}`,'tools');
 const action=useHyperMemoryAction(sources.reload); const [toolRef,setTool]=useState(''); const [title,setTitle]=useState(''); const [args,setArgs]=useState<Record<string,string>>({});
 const chosen=tools.data?.find(tool=>tool.ref===toolRef); const properties=(chosen?.inputSchema.properties??{}) as Record<string,{type?:string;title?:string;description?:string;enum?:unknown[]}>; const required=(chosen?.inputSchema.required??[]) as string[];
 return <section className="grid gap-4 p-6"><h2 className="text-lg font-semibold">App sources</h2><p>Choose which apps this Bot learns from. Sources refresh every 15 minutes.</p><HyperMemoryStatus {...sources}/><HyperMemoryStatus {...tools}/>{action.error&&<p role="alert">{action.error}</p>}
 {sources.data?.filter(source=>source.agentId===agentId).map(source=><article className="flex flex-wrap items-center gap-3 rounded-lg border p-3" key={source.id}><span>{source.title} · {source.enabled?source.syncStatus:'Turned off'} {source.lastSyncAt&&new Date(source.lastSyncAt).toLocaleString()}</span>{source.syncError&&<p role="alert">Source sync failed. Try syncing again.</p>}<Switch aria-label={`Read ${source.title}`} disabled={action.busy} checked={source.enabled} onCheckedChange={enabled=>void action.run(()=>memorySourceAction(source.id,enabled?'enable':'disable'))}/><Button disabled={action.busy||!source.enabled} onClick={()=>void action.run(()=>memorySourceAction(source.id,'sync'))}>Sync now</Button><Button disabled={action.busy} variant="outline" onClick={()=>void action.run(()=>memorySourceAction(source.id,'remove'))}>Remove</Button></article>)}
 {sources.data?.filter(source=>source.agentId===agentId).length===0&&<p>No sources yet.</p>}
 <form className="grid gap-3" onSubmit={event=>{event.preventDefault(); const values:Record<string,unknown>={}; for(const [name,schema] of Object.entries(properties)){ const value=args[name];if(!value)continue; values[name]=schema.type==='boolean'?value==='true':schema.type==='number'||schema.type==='integer'?Number(value):schema.type==='array'?value.split('\n').map(x=>x.trim()).filter(Boolean):value; } void action.run(()=>addMemorySource({agentId,toolRef,title,args:values})).then(ok=>{if(ok){setTitle('');setArgs({});}});}}><label>What to read<select className="w-full rounded-md border bg-background p-2" required value={toolRef} onChange={event=>{setTool(event.target.value);setArgs({});}}><option value="">Choose what to read</option>{tools.data?.map(tool=><option key={tool.ref} value={tool.ref}>{tool.title}</option>)}</select></label>{chosen?.description&&<p>{chosen.description}</p>}<label>Source name<Input required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label>
 {Object.entries(properties).map(([name,schema])=><label key={name}>{schema.title||name}{schema.type==='object'?<p>This source has unsupported object settings. Choose another.</p>:schema.enum||schema.type==='boolean'?<select required={required.includes(name)} value={args[name]??''} onChange={event=>setArgs({...args,[name]:event.target.value})}><option value="">Choose a value</option>{(schema.enum??['true','false']).map(value=><option key={String(value)}>{String(value)}</option>)}</select>:<Input type={schema.type==='number'||schema.type==='integer'?'number':'text'} required={required.includes(name)} value={args[name]??''} onChange={event=>setArgs({...args,[name]:event.target.value})}/>}<span className="text-sm text-muted-foreground">{schema.description}</span></label>)}<Button disabled={action.busy||!toolRef||Object.values(properties).some(schema=>schema.type==='object')}>Add and sync source</Button></form></section>;
}
