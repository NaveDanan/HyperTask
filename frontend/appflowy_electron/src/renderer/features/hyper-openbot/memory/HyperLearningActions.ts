// Adapted from OpenBot lib/learning and components/admin/controls/people-learning.tsx.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest } from '../transport';
import type { LearningSettings, SharingRequest } from './HyperLearningTypes';
export function hyperSaveParticipation(settings: LearningSettings): Promise<{settings: LearningSettings}> {
 // Omit separately saved review choices to preserve concurrent approval updates.
 return hyperOpenBotRequest('/api/admin/learning/settings','PUT',{
  enabled:settings.enabled,defaultTarget:settings.defaultTarget,agents:settings.agents,
 });
}
export function hyperDecideSharing(open: SharingRequest, rows: SharingRequest[] | undefined, readSkill: {path:string;requestedAt:string} | undefined, decision: 'approve'|'decline') {
 const path=`/api/admin/learning/people/${encodeURIComponent(open.userId)}/skills/${encodeURIComponent(open.skillName)}`;
 const current=rows?.find(row=>row.userId===open.userId&&row.skillName===open.skillName);
 if (!current || readSkill?.path!==path || readSkill.requestedAt!==current.requestedAt) return Promise.reject(new Error('Read the requested skill before deciding.'));
 return hyperOpenBotRequest(`/api/admin/learning/sharing-requests/${encodeURIComponent(open.userId)}/${encodeURIComponent(open.skillName)}/${decision}`,'POST',{requestedAt:current.requestedAt});
}
export function hyperSafeMemoryLink(value: string | null | undefined): string | undefined {
 if (!value) return undefined;
 try { const url=new URL(value); return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:undefined; } catch { return undefined; }
}
export type HyperSourceField = {type?:string;title?:string;description?:string;enum?:unknown[]};
export function hyperSourceFields(schema: Record<string,unknown>): Record<string,HyperSourceField> {
 const properties=schema.properties;
 if (!properties || typeof properties!=='object' || Array.isArray(properties)) return {};
 return Object.fromEntries(Object.entries(properties).filter(([,value])=>value&&typeof value==='object'&&!Array.isArray(value)));
}
export function hyperSourceArguments(fields: Record<string,HyperSourceField>, args: Record<string,string>): Record<string,unknown> {
 const values:Record<string,unknown>={};
 for(const [name,field] of Object.entries(fields)) {
  const value=args[name]; if(!value)continue;
  if(field.type==='object')throw new Error('This source has settings HyperTask cannot show. Choose another.');
  if(field.type==='number'||field.type==='integer') {const number=Number(value);if(!Number.isFinite(number))throw new Error('Enter a finite number.');values[name]=number;}
  else if(field.type==='boolean')values[name]=value==='true';
  else if(field.type==='array')values[name]=value.split('\n').map(item=>item.trim()).filter(Boolean);
  else values[name]=value;
 }
 return values;
}
