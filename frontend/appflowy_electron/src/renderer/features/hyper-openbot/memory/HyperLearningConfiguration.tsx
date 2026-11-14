// Adapted from OpenBot app/src/routes/_authed/admin/learning.tsx.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { LearningSettings, LearningOverview } from './HyperLearningTypes';
import { HyperMemoryStatus, useHyperMemoryData } from './HyperMemorySection';
export function HyperLearningConfiguration({value,onChange}:{value:LearningSettings;onChange(value:LearningSettings):void}) {
 const [bot,setBot]=useState('');
 const overview=useHyperMemoryData<LearningOverview>(`/api/admin/learning/overview${bot?`?agentId=${encodeURIComponent(bot)}`:''}`,'overview',10000);
 const override=value.agents[bot]; const mode=override===undefined?'inherit':override===null?'exclude':'container';
 return <fieldset className="grid gap-3 rounded-lg border p-4"><legend>Bot participation</legend><label>Bot ID<Input value={bot} onChange={event=>setBot(event.target.value.trim())}/></label>{bot&&<><label>Participation<select value={mode} onChange={event=>{const agents={...value.agents};if(event.target.value==='inherit')delete agents[bot];else agents[bot]=event.target.value==='exclude'?null:{containerId:''};onChange({...value,agents});}}><option value="inherit">Use deployment default</option><option value="exclude">Leave out of Learning</option><option value="container">Use a specific container</option></select></label>{mode==='container'&&<><label>Container ID<Input required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={override?.containerId??''} onChange={event=>onChange({...value,agents:{...value.agents,[bot]:{...override,containerId:event.target.value}}})}/></label><label>Revision<Input maxLength={256} value={override?.revision??''} onChange={event=>onChange({...value,agents:{...value.agents,[bot]:{containerId:override?.containerId??'',revision:event.target.value||undefined}}})}/></label></>}</>}<HyperMemoryStatus {...overview}/>{overview.data&&<><p>Configuration: {overview.data.configuration}</p><p>{overview.data.container?.name} {overview.data.container?.id}</p>{overview.data.modelProblem&&<p role="alert">{overview.data.modelProblem}</p>}<p>{overview.data.hasActiveRun?'Analysis running':overview.data.latestRunStatus??'No analysis yet'}</p></>}</fieldset>;
}
