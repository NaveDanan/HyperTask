// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
const selectClass = 'rounded-md border border-border bg-background p-2 text-sm';
export function HyperSelect({label,value,options,onChange,disabledValues=[]}:{label:string;value:string;options:[string,string][];onChange:(v:string)=>void;disabledValues?:readonly string[]}) { return <label className="grid gap-1 text-sm">{label}<select className={selectClass} value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,l])=><option key={v} value={v} disabled={disabledValues.includes(v)}>{l}</option>)}</select></label>; }
export function HyperRead<T>({path,field,children,interval=10000}:{path:string;field?:string;children:(data:T)=>React.ReactNode;interval?:number}) {
 const identity=JSON.stringify([path,field]);
 const source=useRef({identity,active:false,generation:0,read:0});
 if(source.current.identity!==identity)source.current={identity,active:false,generation:0,read:0};
 const owner=source.current;
 const [state,setState]=useState<{owner:typeof owner;data?:T;error?:string}>({owner});const [retry,setRetry]=useState(0);
 useEffect(()=>{
  owner.active=true;const generation=++owner.generation;
  const valid=()=>source.current===owner&&owner.active&&owner.generation===generation;
  setState(current=>current.owner===owner?{...current,error:undefined}:{owner});
  const load=async()=>{if(!valid())return;const read=++owner.read;try{const body=await request<Record<string,unknown>>(path);if(valid()&&read===owner.read)setState({owner,data:(field?body[field]:body) as T});}catch(error){if(valid()&&read===owner.read)setState(current=>({owner,data:current.owner===owner?current.data:undefined,error:error instanceof Error?error.message:'Could not load this data.'}));}};
  void load();const timer=setInterval(()=>void load(),interval);
  return()=>{owner.active=false;owner.generation++;clearInterval(timer);};
 },[path,field,retry,interval]);
 const current=state.owner===owner?state:undefined;
 const failure=current?.error?<div role="alert">{current.error}<Button variant="outline" onClick={()=>{if(source.current===owner&&owner.active)setRetry(value=>value+1);}}>Retry</Button></div>:null;
 if(current?.data===undefined)return failure??<p role="status">Loading…</p>;
 // Keep the editor first in the same fragment through refresh failures/retries.
 return <>{children(current.data)}{failure}</>;
}
/** Lock a submitted editor and refuse refreshes from an obsolete mount/target. */
export function useHyperRoutineSave(id:string,refresh:()=>void) {
 const source=useRef({id,active:true,pending:false});
 if(source.current.id!==id)source.current={id,active:true,pending:false};
 const owner=source.current;
 const [state,setState]=useState({owner,pending:false});
 const valid=()=>source.current===owner&&owner.active;
 useEffect(()=>{owner.active=true;return()=>{owner.active=false;};},[id]);
 return {saving:state.owner===owner&&state.pending,done:()=>{if(valid())refresh();},run:async(action:()=>Promise<unknown>)=>{
  if(!valid())throw new Error('This editor has changed. Start the save again.');
  if(owner.pending)throw new Error('This editor is already saving.');
  owner.pending=true;setState({owner,pending:true});
  try{return await action();}finally{owner.pending=false;if(valid())setState({owner,pending:false});}
 }};
}
export function HyperAction({label,run,done,confirm,disabled=false}:{label:string;run:()=>Promise<unknown>;done:()=>void;confirm?:string;disabled?:boolean}) {const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ask,setAsk]=useState(false);return <span className="inline-flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy||disabled} onClick={()=>{if(confirm&&!ask){setAsk(true);return;}setBusy(true);setError('');void Promise.resolve().then(run).then(()=>{setAsk(false);done();},e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'Working…':ask?'Confirm '+label:label}</Button>{ask&&<><span>{confirm}</span><Button variant="ghost" onClick={()=>setAsk(false)}>Cancel</Button></>}{error&&<span role="alert" className="text-destructive">{error}</span>}</span>;}
/** Personal preferences can block every check-in even when enterprise policy permits it. */
export function useHyperCheckInsOff() {
 const [off,setOff]=useState(false);
 useEffect(()=>{let live=true;const load=()=>request<{preferences?:{proactive?:string};proactive?:string}>('/api/settings/preferences').then(result=>{if(live)setOff((result.preferences?.proactive??result.proactive)==='off');},()=>{});void load();const timer=setInterval(load,10000);return()=>{live=false;clearInterval(timer);};},[]);
 return off;
}
