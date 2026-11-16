// Adapted from OpenBot app/src/components/plugins/shared-app-notice.tsx.
// Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import { useState } from 'react';
import { HyperAction, HyperRead } from './HyperRoutineControls';
import { hyperOpenBotRequest as request } from '../transport';
export function HyperRoutineSharedApps({agentId}:{agentId:string}) {
 const [revision,setRevision]=useState(0);
 return <HyperRead<{user:{role:string}}> path="/api/me">{me=><HyperRead<{apps:{serverId:string;title:string;covered:boolean}[];pending:{serverId:string}[]}> key={revision} path={`/api/approvals/shared-use/bot/${encodeURIComponent(agentId)}`}>{shared=><div className="space-y-2 text-sm">{shared.apps.map(app=><div key={app.serverId}>{me.user.role==='admin'?<p>Saving also lets everyone who can use this Bot use the shared {app.title} account.</p>:shared.pending.some(p=>p.serverId===app.serverId)?<p>Waiting for an admin to approve the shared {app.title} account.</p>:!app.covered?<><p>This Bot cannot use the shared {app.title} account until an admin approves who can use the Bot.</p><HyperAction label={`Request approval for ${app.title}`} run={()=>request('/api/approvals/shared-use','POST',{botId:agentId,serverId:app.serverId,reason:'trigger'})} done={()=>setRevision(n=>n+1)}/></>:null}</div>)}</div>}</HyperRead>}</HyperRead>;
}
