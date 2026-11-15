import { hyperMemorySelectionFromPath } from './HyperMemoryNavigation';
import { HyperMemorySources } from './HyperMemorySources';
// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { hyperSafeMemoryLink, hyperSourceFields, hyperSourceArguments } from './HyperLearningActions';
import { hyperOpenBotRequest } from '../transport';
import { type MemoryRecord, type MemorySource, type MemorySourceTool, createMemory, updateMemory, deleteMemory, addMemorySource, memorySourceAction } from './HyperMemoryApi';

export function useHyperMemoryData<T>(path: string | null, key?: string, interval?: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);
  const identity = `${path ?? ''}:${key ?? ''}`;
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  useEffect(() => {
    let active = true;
    setData(undefined); setLoadedIdentity(identity); setError(''); setLoading(Boolean(path));
    if (!path) return;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await hyperOpenBotRequest<Record<string, unknown>>(path);
        if (active) { setData((key ? value[key] : value) as T); setError(''); }
      } catch { if (active) setError('Could not load this page. Access may be refused by the server.'); }
      finally { pending = false; if (active) setLoading(false); }
    };
    void load();
    const timer = interval ? setInterval(load, interval) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [path, key, revision, interval]);
  return { data:loadedIdentity===identity?data:undefined, error:loadedIdentity===identity?error:'', loading:loadedIdentity!==identity||loading, reload: () => { setLoading(Boolean(path)); setRevision(value => value + 1); } };
}
export function HyperMemoryStatus({ loading, error, reload }: { loading: boolean; error: string; reload?:()=>void }) { return loading ? <p role="status">Loading…</p> : error ? <div><p role="alert" className="text-destructive">{error}</p>{reload&&<Button type="button" variant="outline" onClick={reload}>Retry</Button>}</div> : null; }
export function useHyperMemoryAction(reload: () => void) {
 const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const pending=useRef(false);
 return { busy,error, run: async (action: () => Promise<unknown>) => { if(pending.current)return false;pending.current=true;setBusy(true); setError(''); try { await action(); reload(); return true; } catch { setError('The server could not save this change. Check your permissions and try again.'); return false; } finally { pending.current=false;setBusy(false); } } };
}
export default function HyperMemorySection({context,path}:{path?:string;context?:HyperOpenBotSectionContext}) {
 const [selection,setSelection]=useState(()=>hyperMemorySelectionFromPath(path));
 const capabilities=useHyperMemoryData<{edition?:string}>('/api/capabilities');
 const factsAvailable=selection.page==='facts'&&!capabilities.loading&&!capabilities.error&&!!capabilities.data&&capabilities.data.edition!=='personal';
 const memories=useHyperMemoryData<MemoryRecord[]>(factsAvailable?'/api/memory':null,'memories');
 const bots=useHyperMemoryData<{id:string;name:string}[]>(factsAvailable?'/api/agents':null,'agents');
 const action=useHyperMemoryAction(memories.reload); const [content,setContent]=useState(''); const [editing,setEditing]=useState<string>();
 if(capabilities.loading||capabilities.error)return <HyperMemoryStatus {...capabilities}/>;
 if(capabilities.data?.edition==='personal') return <section className="p-6"><p>Memory is unavailable in the personal edition. Use your Bot's Routines instead.</p><Button onClick={()=>context?.navigate?.('bots')}>Bots</Button></section>;
 if(selection.page==='missing')return <section className="p-6"><p role="alert">This Memory destination is unavailable.</p><Button onClick={()=>setSelection({page:'facts'})}>Back to memory</Button></section>;
 if(selection.page==='sources'||selection.page==='source')return <HyperMemorySources selection={selection} onSelect={setSelection}/>;
 return <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6"><h2 className="text-lg font-semibold">Memory</h2><Button variant="outline" onClick={()=>setSelection({page:'sources'})}>Memory sources</Button><p>Facts you add are shared with all Bots; learned facts stay with the Bot that learned them.</p>
  <form className="grid gap-2" onSubmit={event=>{event.preventDefault(); void action.run(()=> editing ? updateMemory(editing,{content}) : createMemory(content)).then(ok=>{if(ok){setContent('');setEditing(undefined);}});}}><label htmlFor="hyper-memory-content">{editing?'Edit memory':'Remember a fact'}</label><Textarea id="hyper-memory-content" disabled={action.busy} required maxLength={6000} value={content} onChange={event=>setContent(event.target.value)}/><div className="flex gap-2"><Button type="submit" disabled={action.busy||!content.trim()}>{editing?'Save':'Remember'}</Button>{editing&&<Button type="button" disabled={action.busy} variant="outline" onClick={()=>{setEditing(undefined);setContent('');}}>Cancel</Button>}</div></form>
 <HyperMemoryStatus {...memories}/>{action.error&&<p role="alert">{action.error}</p>}{memories.error&&<Button onClick={memories.reload}>Retry</Button>}
 {memories.data?.length===0&&<p>No memories yet. Add one with Remember a fact.</p>}
 {memories.data?.map(memory=><article className="grid gap-2 rounded-lg border p-4" key={memory.id}><p className="whitespace-pre-wrap">{memory.content}</p><p className="text-sm text-muted-foreground">{memory.provenance} · {memory.formedBy==='intelligence'?'Kept in the backend':!memory.enabled?'Turned off':memory.formedBy==='bot'?`Formed by ${bots.data?.find(bot=>bot.id===memory.formedByAgentId)?.name??'Bot'} · ${memory.reviewState}`:memory.reviewState}</p>{memory.sourceApp&&<p>{memory.sourceApp} {memory.observedAt&&new Date(memory.observedAt).toLocaleString()}</p>}{hyperSafeMemoryLink(memory.sourceLink)&&<a className="underline" href={hyperSafeMemoryLink(memory.sourceLink)} target="_blank" rel="noreferrer">Open record</a>}<div className="flex gap-2"><Button variant="outline" disabled={action.busy} onClick={()=>{setEditing(memory.id);setContent(memory.content);}}>Edit</Button>{memory.formedBy!=='intelligence'&&memory.reviewState==='unreviewed'&&<Button disabled={action.busy} onClick={()=>void action.run(()=>updateMemory(memory.id,{reviewState:'confirmed'}))}>Confirm</Button>}<Button variant="destructive" disabled={action.busy} onClick={()=>void action.run(()=>deleteMemory(memory.id))}>Forget</Button>{memory.formedBy!=='intelligence'&&<Switch aria-label="Use this memory" checked={memory.enabled} disabled={action.busy} onCheckedChange={enabled=>void action.run(()=>updateMemory(memory.id,{enabled}))}/>}</div></article>)}
 </section>;
}
export function HyperBotMemoryTab({agentId}:{agentId:string}) {
 return <HyperBotMemorySources key={agentId} agentId={agentId}/>;
}
function HyperBotMemorySources({agentId}:{agentId:string}) {
 const capabilities=useHyperMemoryData<{edition?:string}>('/api/capabilities');
 const available=!capabilities.loading&&capabilities.data?.edition!=='personal';
 const sources=useHyperMemoryData<MemorySource[]>(available?'/api/memory/sources':null,'sources',15000); const tools=useHyperMemoryData<MemorySourceTool[]>(available?`/api/memory/sources/available/${encodeURIComponent(agentId)}`:null,'tools');
 const action=useHyperMemoryAction(sources.reload); const [toolRef,setTool]=useState(''); const [title,setTitle]=useState(''); const [args,setArgs]=useState<Record<string,string>>({});
 const chosen=tools.data?.find(tool=>tool.ref===toolRef); const properties=hyperSourceFields(chosen?.inputSchema??{}); const required=Array.isArray(chosen?.inputSchema.required)?chosen.inputSchema.required:[];
 if(capabilities.loading)return <HyperMemoryStatus {...capabilities}/>;
 if(!available)return <p>Memory is unavailable in the personal edition. Use this Bot's Routines page.</p>;
 return <section className="grid gap-4 p-6"><h2 className="text-lg font-semibold">App sources</h2><p>Choose which apps this Bot learns from. Sources refresh every 15 minutes.</p><HyperMemoryStatus {...sources}/><HyperMemoryStatus {...tools}/>{(tools.error||sources.error)&&<Button onClick={()=>{tools.reload();sources.reload();}}>Retry sources</Button>}{tools.data?.length===0&&<p>No connected app actions are available. Connect an app to this Bot first.</p>}{action.error&&<p role="alert">{action.error}</p>}
 {sources.data?.filter(source=>source.agentId===agentId).map(source=><article className="flex flex-wrap items-center gap-3 rounded-lg border p-3" key={source.id}><span>{source.title} · {source.toolRef} · {source.enabled?source.syncStatus:'Turned off'} {source.lastSyncAt&&new Date(source.lastSyncAt).toLocaleString()}</span>{source.syncError&&<p role="alert">Source sync failed. Try syncing again.</p>}<Switch aria-label={`Read ${source.title}`} disabled={action.busy} checked={source.enabled} onCheckedChange={enabled=>void action.run(()=>memorySourceAction(source.id,enabled?'enable':'disable'))}/><Button disabled={action.busy||!source.enabled||source.syncStatus==='running'} onClick={()=>void action.run(()=>memorySourceAction(source.id,'sync'))}>Sync now</Button><Button disabled={action.busy} variant="outline" onClick={()=>void action.run(()=>memorySourceAction(source.id,'remove'))}>Remove</Button></article>)}
 {sources.data?.filter(source=>source.agentId===agentId).length===0&&<p>No sources yet.</p>}
  <form className="grid gap-3" onSubmit={event=>{event.preventDefault(); void action.run(()=>addMemorySource({agentId,toolRef,title,args:hyperSourceArguments(properties,args)})).then(ok=>{if(ok){setTitle('');setArgs({});}});}}><fieldset disabled={action.busy} className="grid gap-3" aria-label="New source"><label>What to read<select className="w-full rounded-md border bg-background p-2" required value={toolRef} onChange={event=>{setTool(event.target.value);setArgs({});}}><option value="">Choose what to read</option>{tools.data?.map(tool=><option key={tool.ref} value={tool.ref}>{tool.title}</option>)}</select></label>{chosen?.description&&<p>{chosen.description}</p>}<label>Source name<Input required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label>
  {Object.entries(properties).map(([name,schema])=><label key={name}>{schema.title||name}{schema.enum||schema.type==='boolean'?<select required={required.includes(name)} value={args[name]??''} onChange={event=>setArgs({...args,[name]:event.target.value})}><option value="">Choose a value</option>{(schema.enum??['true','false']).map(value=><option key={String(value)}>{String(value)}</option>)}</select>:schema.type==='array'?<Textarea required={required.includes(name)} value={args[name]??''} onChange={event=>setArgs({...args,[name]:event.target.value})}/>:<Input step={schema.type==='number'?'any':undefined} type={schema.type==='number'||schema.type==='integer'?'number':'text'} required={required.includes(name)} value={args[name]??''} onChange={event=>setArgs({...args,[name]:event.target.value})}/>}<span className="text-sm text-muted-foreground">{schema.description}</span></label>)}<Button type="submit" disabled={action.busy||!toolRef}>Add and sync source</Button></fieldset></form></section>;
}
