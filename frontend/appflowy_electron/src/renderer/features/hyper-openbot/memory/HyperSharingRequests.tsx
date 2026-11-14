// Adapted from OpenBot components/admin/controls/people-learning.tsx.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperDecideSharing } from './HyperLearningActions';
import { HyperLearningDetail } from './HyperLearningDetail';
import { HyperMemoryStatus, useHyperMemoryData, useHyperMemoryAction } from './HyperMemorySection';
import type { SharingRequest } from './HyperLearningTypes';
export function HyperSharingRequests() {
 const requests=useHyperMemoryData<SharingRequest[]>('/api/admin/learning/sharing-requests','requests');
 const [open,setOpen]=useState<SharingRequest>();
 const skillPath=open?`/api/admin/learning/people/${encodeURIComponent(open.userId)}/skills/${encodeURIComponent(open.skillName)}`:null;
 const [read,setRead]=useState<{path:string;requestedAt:string}>();
 const action=useHyperMemoryAction(requests.reload);
 const stamp=requests.data?.find(row=>row.userId===open?.userId&&row.skillName===open?.skillName)?.requestedAt;
 return <section className="grid gap-3"><HyperMemoryStatus {...requests}/>{requests.error&&<Button onClick={requests.reload}>Retry</Button>}{requests.data?.length===0&&<p>No sharing requests.</p>}{requests.data?.map(row=><Button variant="outline" key={`${row.userId}/${row.skillName}`} onClick={()=>setOpen(row)}>{row.name} · {row.skillName}</Button>)}{open&&skillPath&&<HyperLearningDetail key={`${skillPath}:${stamp}`} path={skillPath} onRead={()=>{if(stamp)setRead({path:skillPath,requestedAt:stamp});}} kind="skill" busy={action.busy} error={action.error} onClose={()=>setOpen(undefined)} footer={<div className="flex gap-2">{(['approve','decline'] as const).map(decision=><Button key={decision} disabled={action.busy||read?.path!==skillPath||read?.requestedAt!==stamp||requests.loading||!!requests.error||!stamp} onClick={()=>void action.run(async()=>{try {await hyperDecideSharing(open,requests.data,read,decision);setOpen(undefined);} finally {requests.reload();}})}>{decision==='approve'?'Approve sharing':'Decline'}</Button>)}</div>}/>}</section>;
}
