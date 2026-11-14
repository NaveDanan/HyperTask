import { hyperLearningSelectionFromPath } from './HyperLearningNavigation';
// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HyperLearningDetail } from './HyperLearningDetail';
import { HyperSharingRequests } from './HyperSharingRequests';
import { HyperLearningPermissions } from './HyperLearningPermissions';
import { HyperLearningConfiguration, HyperLearningBotPicker, HyperLearningHealth } from './HyperLearningConfiguration';
import { hyperSaveParticipation } from './HyperLearningActions';
import { hyperOpenBotRequest } from '../transport';
import { HyperMemoryStatus, useHyperMemoryAction, useHyperMemoryData } from './HyperMemorySection';
import type { LearningSettings, LearningProposal, LearningRunSummary, PeopleProposals } from './HyperLearningTypes';

export { HyperLearningDetail } from './HyperLearningDetail';
export function HyperLearningProposals({proposals,base,query='',canReview=true,reload,initialProposalId}:{initialProposalId?:string;proposals:LearningProposal[]|null; base:string;query?:string;canReview?:boolean;reload:()=>void}) {
 const action=useHyperMemoryAction(reload); const [detail,setDetail]=useState(initialProposalId ?? '');
 return <div className="grid gap-3">{proposals===null?<p role="alert">Proposed skills could not be read.</p>:proposals.length===0?<p>No proposed skills yet.</p>:proposals.map(proposal=><article className="rounded-lg border p-3" key={proposal.id}><Button variant="ghost" onClick={()=>setDetail(proposal.id)}>{proposal.title}</Button><p>{proposal.description}</p><p>{proposal.operation} · {proposal.status}</p></article>)}{detail&&<HyperLearningDetail key={`${base}/${detail}${query}`} path={`${base}/${encodeURIComponent(detail)}${query}`} kind="proposal" busy={action.busy} error={action.error} onClose={()=>setDetail('')} onDecide={canReview?decision=>void action.run(()=>hyperOpenBotRequest(`${base}/${encodeURIComponent(detail)}/${decision}${query}`,'POST',{})).then(ok=>{if(ok)setDetail('');}):undefined}/>}</div>;
}
export { HyperPersonalLearningSection } from './HyperPersonalLearningSection';
export default function HyperLearningSection({context,path}:{path?:string;context?:HyperOpenBotSectionContext}) {
 const capabilities=useHyperMemoryData<{edition?:string}>('/api/capabilities');
 if(capabilities.loading)return <HyperMemoryStatus {...capabilities}/>;
 if(capabilities.data?.edition==='personal')return <section className="p-6"><h2>Automatic learning</h2><p>These controls apply to a team.</p><Button onClick={()=>context?.navigate?.('personal-learning')}>Your own learning</Button></section>;
 return <HyperTeamLearningSection path={path}/>;
}
function HyperTeamLearningSection({path}:{path?:string}) {
 const selection=hyperLearningSelectionFromPath(path);
 const [tab,setTab]=useState(selection.tab ?? 'configuration');const [agentId,setAgentId]=useState(selection.agentId ?? '');const query=agentId?`?agentId=${encodeURIComponent(agentId)}`:'';
 const settings=useHyperMemoryData<LearningSettings>('/api/admin/learning/settings','settings');const [draft,setDraft]=useState<LearningSettings>();
 const proposals=useHyperMemoryData<{containerId:string|null;proposals:LearningProposal[]}>(`/api/admin/learning/proposals${query}`,undefined,10000); const runs=useHyperMemoryData<{containerId:string|null;runs:LearningRunSummary[]}>(`/api/admin/learning/runs${query}`,undefined,10000);const skills=useHyperMemoryData<{containerId:string|null;skills:{name:string;description:string}[]}>(`/api/admin/learning/skills${query}`,undefined,10000);
 const people=useHyperMemoryData<PeopleProposals>(settings.data&&(settings.data.personalReview??'admins')==='admins'?'/api/admin/learning/people/proposals':null); const [detail,setDetail]=useState(selection.skill ? `/api/admin/learning/skills/${encodeURIComponent(selection.skill)}${query}` : ''); const action=useHyperMemoryAction(()=>{settings.reload();proposals.reload();runs.reload();people.reload();skills.reload();});const value=draft??settings.data;
 return <section className="mx-auto grid max-w-4xl gap-4 p-6"><h2 className="text-lg font-semibold">Automatic learning</h2><nav className="flex flex-wrap gap-2">{['configuration','skills','proposals','runs','people','sharing requests','permissions'].map(name=><Button key={name} variant={tab===name?'default':'outline'} onClick={()=>setTab(name)}>{name}</Button>)}</nav>{action.error&&<p role="alert">{action.error}</p>}
 {tab==='configuration'&&<><HyperMemoryStatus {...settings}/>{value&&<form className="grid gap-3" onSubmit={event=>{event.preventDefault();void action.run(()=>hyperSaveParticipation(value)).then(ok=>{if(ok)setDraft(undefined);});}}><label>Enable learning<Switch checked={value.enabled} onCheckedChange={enabled=>setDraft({...value,enabled})}/></label><label>Default container ID<Input pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} value={value.defaultTarget?.containerId??''} onChange={event=>setDraft({...value,defaultTarget:event.target.value?{...value.defaultTarget,containerId:event.target.value}:null})}/></label><label>Exact revision<Input maxLength={256} disabled={!value.defaultTarget} value={value.defaultTarget?.revision??''} onChange={event=>setDraft({...value,defaultTarget:value.defaultTarget?{...value.defaultTarget,revision:event.target.value||undefined}:null})}/></label><HyperLearningConfiguration value={value} onChange={setDraft} onRefresh={settings.reload}/><Button disabled={action.busy}>Save settings</Button></form>}</>}
 {['skills','proposals','runs'].includes(tab)&&<><HyperLearningBotPicker value={agentId} onChange={setAgentId} extra={Object.keys(settings.data?.agents??{})}/><HyperLearningHealth agentId={agentId}/></>}
 {tab==='proposals'&&<><HyperMemoryStatus {...proposals}/>{proposals.data&&!proposals.data.containerId&&<p>No Learning container assigned.</p>}{proposals.data&&<HyperLearningProposals initialProposalId={selection.proposalId} proposals={proposals.data.proposals} base="/api/admin/learning/proposals" query={query} reload={()=>{proposals.reload();skills.reload();}}/>}</>}
 {tab==='runs'&&<><Button disabled={action.busy||!runs.data?.containerId} onClick={()=>void action.run(()=>hyperOpenBotRequest(`/api/admin/learning/runs${query}`,'POST',{}))}>Learn now</Button><HyperMemoryStatus {...runs}/>{runs.data&&!runs.data.containerId&&<p>No Learning container assigned.</p>}{runs.data?.runs.length===0&&<p>No analysis runs yet.</p>}{runs.data?.runs.map(run=><article key={run.id}>{run.status} · {run.trigger} · {run.createdAt} · {run.proposals??'Unknown'} proposals<p>{run.failureCode}</p><p>{run.startedAt&&`Started ${new Date(run.startedAt).toLocaleString()}`} {run.completedAt&&`Finished ${new Date(run.completedAt).toLocaleString()}`}</p><p>{run.insights===null?'':`${run.insights} insights`}</p></article>)}</>}
 {tab==='skills'&&<><HyperMemoryStatus {...skills}/>{skills.data&&!skills.data.containerId&&<p>No Learning container assigned.</p>}{skills.data?.skills.length===0&&<p>No published skills yet.</p>}{skills.data?.skills.map(skill=><Button key={skill.name} variant="outline" onClick={()=>setDetail(`/api/admin/learning/skills/${encodeURIComponent(skill.name)}${query}`)}>{skill.name}: {skill.description}</Button>)}</>}
 {tab==='permissions'&&<HyperLearningPermissions/>}{tab==='people'&&<><HyperMemoryStatus {...settings}/>{settings.data&&<label>Who approves personal skills<select disabled={action.busy} value={settings.data.personalReview??'admins'} onChange={event=>void action.run(()=>hyperOpenBotRequest('/api/admin/learning/personal-review','PUT',{personalReview:event.target.value}))}><option value="admins">Administrators</option><option value="people">Each person, for their own Bots</option></select></label>}<HyperMemoryStatus {...people}/>{people.data?.people.length===0&&<p>No skills waiting for review.</p>}{settings.data?.personalReview!=='people'&&people.data?.people.map(person=><section key={person.userId}><h3>{person.name}</h3><HyperLearningProposals proposals={person.proposals?.filter(proposal=>proposal.status==='pending_review')??null} base={`/api/admin/learning/people/${encodeURIComponent(person.userId)}/proposals`} reload={people.reload}/></section>)}</>}
 {tab==='sharing requests'&&<HyperSharingRequests/>}{detail&&<HyperLearningDetail path={detail} kind="skill" onClose={()=>setDetail('')}/>}</section>;
}
