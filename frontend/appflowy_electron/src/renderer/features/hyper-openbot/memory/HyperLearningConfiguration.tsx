// Adapted from OpenBot app/src/routes/_authed/admin/learning.tsx.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LearningSettings, LearningOverview, LearningAutoAssignState, LearningDeliveryStatus } from './HyperLearningTypes';
import { HyperMemoryStatus, useHyperMemoryData, useHyperMemoryAction } from './HyperMemorySection';
import { hyperOpenBotRequest } from '../transport';

export function HyperLearningBotPicker({value,onChange,extra=[]}:{value:string;onChange(value:string):void;extra?:string[]}) {
 const visible=useHyperMemoryData<{id:string;name:string}[]>('/api/agents','agents');
 const hidden=useHyperMemoryData<{id:string;name:string}[]>('/api/agents?hidden=true','agents');
 const roster=[...(visible.data??[]),...(hidden.data??[])];
 return <label>Bot<HyperMemoryStatus {...visible}/><HyperMemoryStatus {...hidden}/><select value={value} onChange={event=>onChange(event.target.value)}><option value="">Deployment default</option>{[...new Set([...roster.map(bot=>bot.id),...extra])].map(id=><option key={id} value={id}>{roster.find(bot=>bot.id===id)?.name??id}</option>)}</select></label>;
}
export function HyperLearningConfiguration({value,onChange,onRefresh}:{value:LearningSettings;onChange(value:LearningSettings):void;onRefresh():void}) {
 const [bot,setBot]=useState('');
 const automatic=useHyperMemoryData<LearningAutoAssignState>('/api/admin/learning/settings','automatic');
 const action=useHyperMemoryAction(()=>{automatic.reload();onRefresh();});
 const override=value.agents[bot]; const mode=override===undefined?'inherit':override===null?'exclude':'container';
 const state=automatic.data;
 return <fieldset className="grid gap-3 rounded-lg border p-4"><legend>Bot participation</legend>
 <p>Container changes apply to new conversations. Existing conversations keep their first container. Containers must exist in the same project.</p>
 <HyperMemoryStatus {...automatic}/>{action.error&&<p role="alert">{action.error}</p>}
 {state?.state==='assigned'&&<p>Automatically assigned container: {state.containerId}</p>}
 {state?.state==='not_entitled'&&<p>This project's plan does not include Learning. No container was assigned.</p>}
 {state?.state==='learning_off'&&<p>Learning is switched off in the backend. Nothing is collected.</p>}
 {state?.state==='unavailable'&&<p>Could not reach the backend. Automatic assignment will try again.</p>}
 {state?.state==='pending'&&<p>Checking automatic assignment.</p>}
 {state?.state==='absent'&&<><p>No {state.containerId} Learning container exists. Nothing is collected.</p>{state.canCreate&&<Button type="button" disabled={action.busy} onClick={()=>void action.run(()=>hyperOpenBotRequest('/api/admin/learning/container','POST',{}))}>Create the {state.containerId} container</Button>}{state.createError&&<p role="alert">Container creation failed. Retry or follow the setup instructions.</p>}{state.instructions&&<p className="whitespace-pre-wrap">{state.instructions}</p>}</>}
 <HyperLearningBotPicker value={bot} onChange={setBot} extra={Object.keys(value.agents)}/>
 {bot&&<><label>Participation<select value={mode} onChange={event=>{const agents={...value.agents};if(event.target.value==='inherit')delete agents[bot];else agents[bot]=event.target.value==='exclude'?null:{containerId:''};onChange({...value,agents});}}><option value="inherit">Use deployment default</option><option value="exclude">Leave out of Learning</option><option value="container">Use a specific container</option></select></label>{mode==='container'&&<><label>Container ID<Input required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={override?.containerId??''} onChange={event=>onChange({...value,agents:{...value.agents,[bot]:{...override,containerId:event.target.value}}})}/></label><label>Revision<Input maxLength={256} value={override?.revision??''} onChange={event=>onChange({...value,agents:{...value.agents,[bot]:{containerId:override?.containerId??'',revision:event.target.value||undefined}}})}/></label></>}</>}
 </fieldset>;
}
export function HyperLearningHealth({agentId}:{agentId:string}) {
 const overview=useHyperMemoryData<LearningOverview>(`/api/admin/learning/overview${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`,'overview',10000);
 const delivery=useHyperMemoryData<LearningDeliveryStatus>(agentId?`/api/admin/learning/status/${encodeURIComponent(agentId)}`:null,'status',10000);
 return <section className="grid gap-2 rounded-lg border p-4"><HyperMemoryStatus {...overview}/>{overview.data&&<><p>Configuration: {overview.data.configuration}</p><p>{overview.data.container?.name} {overview.data.container?.id}</p>{overview.data.modelProblem&&<p role="alert">{overview.data.modelProblem}</p>}<dl>{[['Threads ready',overview.data.pendingThreadCount],['Candidates to review',overview.data.pendingCandidateCount],['Published skills',overview.data.publishedSkillCount],['Insights',overview.data.insightCount]].map(([title,count])=>count!==null&&<div key={title}><dt>{title}</dt><dd>{count}</dd></div>)}</dl><p>{overview.data.hasActiveRun?'Analysis running':overview.data.latestRunStatus??'No analysis yet'}</p></>}
 {agentId&&<><h3>Skill delivery</h3><HyperMemoryStatus {...delivery}/>{delivery.data&&<><p>{!delivery.data.configured?'Delivery is off for this Bot.':!delivery.data.initialized?'Waiting for the first verified skill snapshot.':delivery.data.stale?'Using the last verified snapshot. A refresh is pending.':'A verified snapshot is available.'}</p>{delivery.data.revision&&<p>Loaded revision: {delivery.data.revision}</p>}{delivery.data.lastCheckedAt&&<p>Last checked: {new Date(delivery.data.lastCheckedAt).toLocaleString()}</p>}{delivery.data.error&&<p role="alert">Skill delivery failed. {delivery.data.error.retryable?'A retry is possible.':'Check the backend configuration.'}</p>}</>}</>}
 <Button type="button" variant="outline" onClick={()=>{overview.reload();delivery.reload();}}>Refresh status</Button></section>;
}
