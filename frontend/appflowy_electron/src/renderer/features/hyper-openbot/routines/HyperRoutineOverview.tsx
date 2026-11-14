// Adapted from OpenBot app/src/components/routines/routines-list.tsx.
// Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { describeEvent } from './HyperRoutineEvents';
import { mergeRoutines, routineDoes, goalCanEnd, goalStarts, intervalLabel } from './HyperRoutineMerged';
import { HyperAction } from './HyperRoutineControls';
import type { RoutineRecord, ResponsibilityRecord, ProactiveSetting } from './HyperRoutineTypes';
function useHyperOverviewRead<T>(path:string) {
 const [state,setState]=useState<{data?:T;error?:string}>({}),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;let loading=false;const load=async()=>{if(loading)return;loading=true;try{const data=await request<T>(path);if(live)setState({data});}catch(error){if(live)setState(previous=>({...previous,error:error instanceof Error?error.message:'Could not load routines.'}));}finally{loading=false;}};void load();const timer=setInterval(load,10000);return()=>{live=false;clearInterval(timer);};},[path,retry]);
 return {...state,retry:()=>setRetry(n=>n+1)};
}
export function HyperRoutineOverview({agentId,select}:{agentId?:string;select:(family:string,id:string)=>void}) {
 const routines=useHyperOverviewRead<{routines:RoutineRecord[];sweep?:{working:boolean;lastSweptAt:string|null}}>('/api/routines');
 const goals=useHyperOverviewRead<{responsibilities:ResponsibilityRecord[]}>('/api/responsibilities');
 const checkIns=useHyperOverviewRead<{settings:ProactiveSetting[];allowed:boolean}>('/api/proactive/settings');
 const rows=mergeRoutines({routines:routines.data?.routines||[],goals:goals.data?.responsibilities||[],checkIns:checkIns.data?.settings||[],agentId});
 return <div className="space-y-3">{[routines,goals,checkIns].map((read,i)=><div key={i}>{!read.data&&!read.error&&<p role="status">Loading {['schedules','goals','check-ins'][i]}…</p>}{read.error&&<p role="alert">{read.error}<Button onClick={read.retry}>Retry {['schedules','goals','check-ins'][i]}</Button></p>}</div>)}{routines.data?.sweep?.working===false&&routines.data.routines.length>0&&<p role="status">OpenBot is not running routines. None will run until it starts again. Last checked: {routines.data.sweep.lastSweptAt||'Never'}</p>}{!rows.length&&routines.data&&goals.data&&checkIns.data&&<p>No routines yet. Create a routine to get started.</p>}{rows.map(row=>{
 const family=row.kind==='routine'?'routines':row.kind==='goal'?'responsibilities':'proactive/settings';
 return <article key={row.kind+row.id} className="space-y-2 rounded-lg border border-border p-4"><Button variant="ghost" onClick={()=>select(family,row.id)}>{row.kind==='routine'?(row.routine.title||row.routine.schedule):row.kind==='goal'?row.goal.title:(row.checkIn.subject||row.checkIn.focus)}</Button>{row.kind==='routine'?<><p>{routineDoes(row.routine)}</p><p>{row.routine.schedule} · {row.routine.timezone} · {row.routine.enabled?'On':'Off'}</p><p>Next: {row.routine.nextRunAt} · Last: {row.routine.lastRun?.status??'No finished run'}</p></>:row.kind==='goal'?<><p>{row.goal.instruction}</p><p>{row.goal.status} · {goalStarts(row.goal,undefined,row.routines,describeEvent)} · {goalCanEnd(row.goal,row.routines,undefined)?'Until done':'Ongoing'}</p></>:<><p>{row.checkIn.focus}</p><p>{intervalLabel(row.checkIn.intervalMinutes)} · {row.checkIn.enabled?'On':'Off'} · {row.checkIn.lastRun?.outcome||row.checkIn.lastStatus}</p>{checkIns.data?.allowed===false&&<p>An admin has turned check-ins off.</p>}</>}</article>;
 })}<HyperAction label="Refresh routines" run={async()=>{routines.retry();goals.retry();checkIns.retry();}} done={()=>{}}/></div>;
}
