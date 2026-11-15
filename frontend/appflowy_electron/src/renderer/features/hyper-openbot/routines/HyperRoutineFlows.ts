// Adapted from OpenBot new-routine-page.tsx and responsibilities/triggers.tsx.
// Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import { checkInSubject } from './HyperRoutinePlan';
import type { RoutineFormValues } from './HyperRoutineForm';
import type { TriggerKind, TriggerConfig, ProactiveSetting } from './HyperRoutineTypes';
export function hyperRoutineCreationIssue(values:RoutineFormValues,settings:{allowed:boolean;settings:ProactiveSetting[]}|undefined,personal:boolean):string|null {
 if(values.does==='tell') {
  if(!settings?.allowed)return 'An admin turned check-ins off. Choose Act on its own.';
  if(settings.settings.some(x=>x.agentId===values.agentId&&!x.sourceLink&&(x.subject||'').toLowerCase()===checkInSubject(values).toLowerCase()))return 'This Bot already checks in on this. Choose a different name.';
 }
 if(values.does==='act'&&personal&&values.starts==='event'&&values.eventSource==='slack')return 'Slack events are unavailable in the personal edition.';
 return null;
}
export type HyperRoutineChannel={id:string;summary?:string|null;opening?:string|null;title?:string|null;name?:string|null;active:boolean;task?:boolean;agentIds:string[]};
export function hyperRoutineEligibleChannels(channels:readonly HyperRoutineChannel[],agentId:string) {return channels.filter(c=>c.active&&!c.task&&c.agentIds.includes(agentId));}
const list=(value:string)=>value.split(',').map(s=>s.trim()).filter(Boolean);
export function hyperRoutineTriggerConfig(kind:TriggerKind,fields:Record<string,string>):TriggerConfig {
 if(kind==='slack')return {kind,teamId:(fields.teamId||'').trim(),mode:(fields.mode||'mention') as 'mention'|'phrase'|'reaction'|'message',phrases:list(fields.phrases||''),reactions:list(fields.reactions||'').map(x=>x.replace(/:/g,'')),channels:list(fields.channels||'')};
 const filter={eventTypes:list(fields.eventTypes||''),...(fields.fieldPath?.trim()&&fields.fieldEquals?.trim()?{field:{path:fields.fieldPath.trim(),equals:fields.fieldEquals.trim()}}:{})};
 if(kind==='github')return {kind,filter,...(fields.repository?.trim()?{repository:fields.repository.trim()}:{})};
 if(kind==='email')return {kind,filter,allowedSenders:list(fields.senders||'')};
 return {kind,filter};
}
/** Electron's renderer origin is not the deployment's public webhook origin. */
export function hyperRoutineTriggerEndpoint(origin:string,path:string):string {
 const url=new URL(origin);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Enter an HTTP or HTTPS public OpenBot URL without credentials.');
 if(!path.startsWith('/')||path.startsWith('//'))throw new Error('The server returned an invalid webhook path.');
 return new URL(path,url.origin).href;
}
