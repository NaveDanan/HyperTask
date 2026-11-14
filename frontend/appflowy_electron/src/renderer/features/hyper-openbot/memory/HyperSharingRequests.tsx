// Adapted from OpenBot components/admin/controls/people-learning.tsx.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest } from '../transport';
import { HyperLearningDetail } from './HyperLearningDetail';
import { HyperMemoryStatus, useHyperMemoryData, useHyperMemoryAction } from './HyperMemorySection';
import type { SharingRequest, LearnedSkillDetail } from './HyperLearningTypes';
export function HyperSharingRequests() {
 const requests=useHyperMemoryData<SharingRequest[]>('/api/admin/learning/sharing-requests','requests');
 const [open,setOpen]=useState<SharingRequest>();
 const skillPath=open?`/api/admin/learning/people/${encodeURIComponent(open.userId)}/skills/${encodeURIComponent(open.skillName)}`:null;
 const skill=useHyperMemoryData<LearnedSkillDetail>(skillPath,'skill');
 const action=useHyperMemoryAction(requests.reload);
 const stamp=requests.data?.find(row=>row.userId===open?.userId&&row.skillName===open?.skillName)?.requestedAt;
 return <section className="grid gap-3"><HyperMemoryStatus {...requests}/>{requests.error&&<Button onClick={requests.reload}>Retry</Button>}{requests.data?.length===0&&<p>No sharing requests.</p>}{requests.data?.map(row=><Button variant="outline" key={`${row.userId}/${row.skillName}`} onClick={()=>setOpen(row)}>{row.name} · {row.skillName}</Button>)}{open&&skillPath&&<HyperLearningDetail key={skillPath} path={skillPath} kind="skill" busy={action.busy} error={action.error} onClose={()=>setOpen(undefined)} footer={<div className="flex gap-2">{(['approve','decline'] as const).map(decision=><Button key={decision} disabled={action.busy||!skill.data||!!skill.error||requests.loading||!stamp} onClick={()=>void action.run(async()=>{try {await hyperOpenBotRequest(`/api/admin/learning/sharing-requests/${encodeURIComponent(open.userId)}/${encodeURIComponent(open.skillName)}/${decision}`,'POST',{requestedAt:stamp});setOpen(undefined);} finally {requests.reload();}})}>{decision==='approve'?'Approve sharing':'Decline'}</Button>)}</div>}/>}</section>;
}
