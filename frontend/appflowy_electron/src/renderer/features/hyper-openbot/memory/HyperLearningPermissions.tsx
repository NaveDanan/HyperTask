// Adapted from OpenBot capability-changes and admin/controls/skill-sharing-section.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { hyperOpenBotRequest } from '../transport';
import { HyperMemoryStatus, useHyperMemoryAction, useHyperMemoryData } from './HyperMemorySection';
import type { HyperEnterpriseControls, CapabilityKey } from './HyperCapabilityTypes';
import { translateCapabilityChanges, type CapabilityChange, type CapabilityTranslation } from './HyperCapabilityTranslate';
import type { CapabilityPreview } from './HyperCapabilityQueries';

export function HyperLearningPermissions() {
 const controls = useHyperMemoryData<HyperEnterpriseControls>('/api/admin/enterprise');
 const action = useHyperMemoryAction(controls.reload);
 const [changes, setChanges] = useState<CapabilityChange[]>([]);
 const [preview, setPreview] = useState<CapabilityPreview>();
 const [text, setText] = useState('');
 const [translation, setTranslation] = useState<CapabilityTranslation>();
 const change = (next: CapabilityChange) => { setPreview(undefined); setTranslation(undefined); setChanges(old => [...old.filter(item => !(item.scopeKind === next.scopeKind && item.scopeId === next.scopeId && item.capability === next.capability)), next]); };
 const allowed = (capability: CapabilityKey, scopeKind: CapabilityChange['scopeKind'], scopeId: string, current: boolean | null | undefined) => {
  const value = changes.find(item => item.capability === capability && item.scopeKind === scopeKind && item.scopeId === scopeId);
  return <select aria-label={`${capability} ${scopeKind} ${scopeId}`} disabled={action.busy} value={String(value ? value.allowed : current ?? null)} onChange={event => change({capability,scopeKind,scopeId,allowed:event.target.value==='null'?null:event.target.value==='true'})}><option value="null">Inherit</option><option value="true">Allow</option>{scopeKind!=='group'&&<option value="false">Refuse</option>}</select>;
 };
 return <section className="grid gap-4"><h3>Sharing and permissions</h3><HyperMemoryStatus {...controls}/>{action.error&&<p role="alert">{action.error}</p>}{controls.data&&<>
 <label>Skill sharing<Switch checked={controls.data.settings.skillSharing} disabled={action.busy} onCheckedChange={value=>void action.run(()=>hyperOpenBotRequest('/api/admin/enterprise/settings/skillSharing','PUT',{value}))}/></label>
 <p>A shared skill puts its person's recorded and narrated text in front of everybody's Bots.</p>
 <label>Describe permission changes<Textarea value={text} disabled={action.busy} onChange={event=>{setText(event.target.value);setPreview(undefined);setTranslation(undefined);}}/></label>
 <Button disabled={action.busy||!text.trim()} onClick={()=>void action.run(async()=>{const result=await translateCapabilityChanges(text);setTranslation(result);setChanges(result.changes);setPreview(undefined);})}>Write changes</Button>
 {translation&&<><p>{translation.summary}</p><p>{translation.explanation}</p><p>{translation.warning}</p>{!translation.check.ok&&<p role="alert">{translation.check.error}</p>}</>}
 {controls.data.capabilities.map(capability=><fieldset className="grid gap-2 rounded-lg border p-3" key={capability.capability}><legend>{capability.title}</legend><p>{capability.description}</p><p>Default: {capability.default?'Allowed':'Refused'}</p><label>Organization {allowed(capability.capability,'organization','',capability.organization)}</label>{(['admin','user'] as const).map(role=><label key={role}>{role} {allowed(capability.capability,'role',role,capability.roles[role])}</label>)}{controls.data?.groups.map(group=><label key={group}>{group} {allowed(capability.capability,'group',group,capability.groups[group])}</label>)}</fieldset>)}
 <Button disabled={action.busy||!changes.length} onClick={()=>void action.run(async()=>setPreview(await hyperOpenBotRequest<CapabilityPreview>('/api/admin/enterprise/capabilities/preview','POST',{changes})))}>Preview affected people</Button>
 {preview&&<><p>{preview.warning}</p>{!preview.check.ok&&<p role="alert">{preview.check.error}{preview.check.problems.map(problem=><span key={`${problem.change}/${problem.field}`}> Change {problem.change}: {problem.message}</span>)}</p>}<p>{preview.counts.people} people, {preview.counts.losing} losing, {preview.counts.gaining} gaining, {preview.counts.keeping} keeping permissions</p>{preview.people.map(person=><article key={person.id}><h4>{person.name??person.email}</h4>{person.capabilities.map(capability=><div key={capability.capability}><p>{capability.title}: {String(capability.before.allowed)} → {String(capability.after.allowed)}. Decided by {capability.after.decidedBy} {capability.after.scopeId}</p>{capability.activity&&<><p>{capability.activity.count} {capability.activity.what}{capability.activity.more?' or more':''}</p><pre className="whitespace-pre-wrap">{JSON.stringify(capability.activity.recent,null,2)}</pre></>}</div>)}</article>)}{preview.activity.unmapped.map(item=><p key={item.capability}>No activity recorded for {item.title}.</p>)}<Button disabled={action.busy||!preview.check.ok} onClick={()=>void action.run(async()=>{await hyperOpenBotRequest('/api/admin/enterprise/capabilities/batch','POST',{changes,...(translation?{authoring:{source:'english',text}}:{})});setChanges([]);setPreview(undefined);setTranslation(undefined);})}>Save reviewed changes</Button></>}
 <Button variant="outline" disabled={action.busy} onClick={()=>{setChanges([]);setPreview(undefined);setTranslation(undefined);}}>Cancel changes</Button>
 </>}</section>;
}
