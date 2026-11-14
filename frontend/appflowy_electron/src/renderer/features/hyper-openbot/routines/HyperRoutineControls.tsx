// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
const selectClass = 'rounded-md border border-border bg-background p-2 text-sm';
export function HyperSelect({label,value,options,onChange,disabledValues=[]}:{label:string;value:string;options:[string,string][];onChange:(v:string)=>void;disabledValues?:readonly string[]}) { return <label className="grid gap-1 text-sm">{label}<select className={selectClass} value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,l])=><option key={v} value={v} disabled={disabledValues.includes(v)}>{l}</option>)}</select></label>; }
export function HyperRead<T>({path,field,children,interval=10000}:{path:string;field?:string;children:(data:T)=>React.ReactNode;interval?:number}) {
 const [state,setState]=useState<{data?:T;error?:string}>({}); const [retry,setRetry]=useState(0);
 useEffect(()=>{setState({});let live=true; const load=()=>request<Record<string,unknown>>(path).then(body=>{if(live)setState({data:(field?body[field]:body) as T});},e=>{if(live)setState({error:e.message});}); void load(); const timer=setInterval(load,interval); return ()=>{live=false;clearInterval(timer);};},[path,field,retry,interval]);
 if(state.error)return <div role="alert">{state.error}<Button variant="outline" onClick={()=>setRetry(retry+1)}>Retry</Button></div>;
 if(state.data===undefined)return <p role="status">Loading…</p>; return <>{children(state.data)}</>;
}
export function HyperAction({label,run,done,confirm,disabled=false}:{label:string;run:()=>Promise<unknown>;done:()=>void;confirm?:string;disabled?:boolean}) {const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ask,setAsk]=useState(false);return <span className="inline-flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy||disabled} onClick={()=>{if(confirm&&!ask){setAsk(true);return;}setBusy(true);setError('');void Promise.resolve().then(run).then(()=>{setAsk(false);done();},e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'Working…':ask?'Confirm '+label:label}</Button>{ask&&<><span>{confirm}</span><Button variant="ghost" onClick={()=>setAsk(false)}>Cancel</Button></>}{error&&<span role="alert" className="text-destructive">{error}</span>}</span>;}
/** Personal preferences can block every check-in even when enterprise policy permits it. */
export function useHyperCheckInsOff() {
 const [off,setOff]=useState(false);
 useEffect(()=>{let live=true;const load=()=>request<{preferences?:{proactive?:string};proactive?:string}>('/api/settings/preferences').then(result=>{if(live)setOff((result.preferences?.proactive??result.proactive)==='off');},()=>{});void load();const timer=setInterval(load,10000);return()=>{live=false;clearInterval(timer);};},[]);
 return off;
}
