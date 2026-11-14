// Adapted from OpenBot components/settings/{learning-sharing,learning-review}.tsx.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { hyperOpenBotRequest } from '../transport';
import { HyperLearningDetail } from './HyperLearningDetail';
import { HyperLearningProposals } from './HyperLearningSection';
import { HyperMemoryStatus, useHyperMemoryData, useHyperMemoryAction } from './HyperMemorySection';
import type { PersonalReview, PersonalLearningSharing } from './HyperLearningTypes';
export function HyperPersonalLearningSection({onOpenRecordings}:{onOpenRecordings?:()=>void}) {
 const capabilities=useHyperMemoryData<{edition?:string}>('/api/capabilities');
 const personal=capabilities.data?.edition==='personal';
 const sharing=useHyperMemoryData<PersonalLearningSharing>('/api/settings/learning');
 const review=useHyperMemoryData<PersonalReview>('/api/settings/learning/review',undefined,10000);
 const action=useHyperMemoryAction(()=>{sharing.reload();review.reload();});
 const [detail,setDetail]=useState('');
 const previousWaiting=useRef<number>();
 const waiting=review.data?.sources.reduce((count,source)=>count+(source.proposals??[]).filter(item=>item.status==='pending_review').length,0);
 useEffect(()=>{if(waiting!==undefined){if((previousWaiting.current!==undefined&&waiting<previousWaiting.current)||(review.data?.approved??0)>0)sharing.reload();previousWaiting.current=waiting;}},[review.data]);
 const groups=[...new Set(review.data?.sources.map(source=>source.label)??[])];
 return <section className="mx-auto grid max-w-4xl gap-4 p-6"><h2 className="text-lg font-semibold">Your learned skills</h2><HyperMemoryStatus {...capabilities}/><HyperMemoryStatus {...sharing}/><HyperMemoryStatus {...review}/>{action.error&&<p role="alert">{action.error}</p>}<Button variant="outline" onClick={()=>{sharing.reload();review.reload();}}>Refresh skills</Button>
 {sharing.data&&<>{!personal&&!capabilities.loading&&<><label>Who can use your skills<select disabled={action.busy} value={sharing.data.mode} onChange={event=>void action.run(()=>hyperOpenBotRequest('/api/settings/learning/mode','PUT',{mode:event.target.value}))}><option value="closed">Only your Bots</option><option disabled={!sharing.data.sharingAllowed} value="open">Every Bot</option><option disabled={!sharing.data.sharingAllowed} value="choose">Choose skills</option></select></label>{!sharing.data.sharingAllowed&&<p>An administrator has disabled skill sharing. Only your Bots use these skills.</p>}</>}
 {sharing.data.skills===null?<p>Skills unavailable: {sharing.data.unavailable}</p>:sharing.data.skills.length===0?<p>No learned skills yet.</p>:sharing.data.skills.map(skill=>{
 const needsAdmin=sharing.data!.mode!=='closed'&&skill.approvedBy==='person'&&skill.sharing!=='approved';
 return <article className="grid gap-2 rounded-lg border p-3" key={skill.name}><Button variant="ghost" onClick={()=>setDetail(`/api/settings/learning/skills/${encodeURIComponent(skill.name)}`)}>{skill.name}</Button><p>{skill.description}</p>{!personal&&<><p>{needsAdmin?'Only your Bots use it.':`Sharing: ${skill.sharing}`}</p>{sharing.data?.mode==='choose'?<Switch aria-label={`Share ${skill.name}`} checked={skill.open} disabled={action.busy||(!sharing.data.sharingAllowed&&!skill.open)} onCheckedChange={open=>void action.run(async()=>{try{await hyperOpenBotRequest(`/api/settings/learning/skills/${encodeURIComponent(skill.name)}`,'PUT',{open});if(open&&needsAdmin&&skill.sharing!=='requested')await hyperOpenBotRequest(`/api/settings/learning/skills/${encodeURIComponent(skill.name)}/share-request`,'POST',{});}finally{sharing.reload();}})}/>:needsAdmin&&skill.sharing!=='requested'&&<Button disabled={action.busy} onClick={()=>void action.run(()=>hyperOpenBotRequest(`/api/settings/learning/skills/${encodeURIComponent(skill.name)}/share-request`,'POST',{}))}>Ask to share</Button>}{skill.sharing==='requested'&&<p>Asked to share</p>}</>}</article>;
 })}</>}
 {review.data?.modelProblem&&<p role="alert">{review.data.modelProblem}</p>}
 {review.data&&review.data.autoApprove!==null&&<label>Approve automatically<Switch checked={review.data.autoApprove} disabled={action.busy} onCheckedChange={autoApprove=>void action.run(()=>hyperOpenBotRequest('/api/settings/learning/auto-approve','PUT',{autoApprove}))}/></label>}
 {groups.map(label=>{
 const sources=review.data!.sources.filter(source=>source.label===label);
 const running=sources.some(source=>source.latestRun&&!['succeeded','failed'].includes(source.latestRun.status));
 return <section className="grid gap-3" key={label}><h3>{label}</h3>{review.data?.canReview&&<Button disabled={action.busy||running||!!review.data.modelProblem||sources.every(source=>!!source.unavailable)} onClick={()=>void action.run(async()=>{try{for(const source of sources.filter(source=>!source.unavailable))await hyperOpenBotRequest(`/api/settings/learning/runs?container=${encodeURIComponent(source.containerId)}`,'POST',{});}finally{review.reload();}})}>{running?'Learning in progress…':'Learn now'}</Button>}{sources.map(source=><div key={source.containerId}>{review.data?.canReview&&<p>{source.latestRun?.status??'No run yet.'}{source.latestRun?.failure}</p>}{source.unavailable&&<p>Learning is switched off for this source.</p>}<HyperLearningProposals proposals={source.proposals?.filter(item=>item.status==='pending_review')??null} base="/api/settings/learning/proposals" query={`?container=${encodeURIComponent(source.containerId)}`} canReview={review.data?.canReview} reload={()=>{review.reload();sharing.reload();}}/></div>)}</section>;
 })}
 {review.data?.sources.length===0&&<p>No Learning sources yet. Teach a Bot with your recordings.</p>}{detail&&<HyperLearningDetail path={detail} kind="skill" onOpenRecordings={onOpenRecordings} onClose={()=>setDetail('')}/>}</section>;
}
export default HyperPersonalLearningSection;
