// Adapted from OpenBot admin routes. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { auditFiltersFromParams, type AuditFilters } from './HyperAuditFilters';
import { EMPTY_WHAT_IF_ACTION, type WhatIfAction } from './HyperWhatIfModel';
export const HYPER_ADMIN_PAGE_PATHS = {
  Admin: '/admin', People: '/admin/people', Permissions: '/admin/permissions',
  'Describe permissions': '/admin/permissions/describe', Approvals: '/admin/approvals',
  'Describe approval rules': '/admin/approvals/describe', 'Approval guidance': '/admin/approvals/guidance',
  Boundaries: '/admin/boundaries', Activity: '/admin/audit', 'Identity providers': '/admin/identity-providers',
  'What would happen': '/admin/what-if',
} as const;
export type HyperAdminPage = keyof typeof HYPER_ADMIN_PAGE_PATHS;
export type HyperAdminSelection = { page: HyperAdminPage; boundary?: 'new' | number; filters?: AuditFilters; action?: WhatIfAction } | {page:'missing'};
export function hyperAdminSelectionFromPath(path?: string): HyperAdminSelection {
  if (!path) return {page:'Admin'};
  try {
    const url = new URL(path,'https://native.invalid');
    if (url.origin !== 'https://native.invalid') return {page:'missing'};
    const pathname = url.pathname.replace(/\/$/,'') || '/';
    if (pathname === '/admin/enterprise' || pathname === '/admin-governance') return {page:'Admin'};
    const boundary = /^\/admin\/boundaries\/(new|0|[1-9][0-9]*)$/.exec(pathname);
    if (boundary) return {page:'Boundaries',boundary:boundary[1]==='new'?'new':Number(boundary[1])};
    const page = (Object.entries(HYPER_ADMIN_PAGE_PATHS) as [HyperAdminPage,string][]).find(([,value])=>value===pathname)?.[0];
    if (!page) return {page:'missing'};
    if (page === 'Activity') return {page,filters:auditFiltersFromParams(url.searchParams)};
    if (page === 'What would happen') {
      const raw=url.searchParams.get('action');
      if (!raw) return {page};
      const action: unknown=JSON.parse(raw);
      // What-if accepts a structured action, never an arbitrary object or a callback payload.
      if (!action || typeof action!=='object' || Array.isArray(action)) return {page:'missing'};
      const selected={...EMPTY_WHAT_IF_ACTION};
      for (const key of Object.keys(selected) as (keyof WhatIfAction)[]) if (typeof (action as Record<string,unknown>)[key]==='string') (selected as Record<string,string>)[key]=(action as Record<string,string>)[key];
      return {page,action:selected};
    }
    return {page};
  } catch {return {page:'missing'};}
}
export function hyperAdminSectionFromPath(pathname: string): string | undefined {
  if (!/^\/admin(?:\/|$)/.test(pathname)) return undefined;
  const platform = /^\/admin\/(providers|credentials|plugins|skills|proactive|playground|computers)(?:\/|$)/.exec(pathname);
  if (platform) return `admin-${platform[1]}`;
  if (/^\/admin\/components(?:\/|$)/.test(pathname)) return 'components-admin';
  if (/^\/admin\/learning(?:\/|$)/.test(pathname)) return 'learning';
  return 'admin-governance';
}

export function hyperAdminBackSelection(selection: HyperAdminSelection): HyperAdminSelection {
  if (selection.page==='Boundaries' && selection.boundary!==undefined) return {page:'Boundaries'};
  if (selection.page==='Describe permissions') return {page:'Permissions'};
  if (selection.page==='Describe approval rules' || selection.page==='Approval guidance') return {page:'Approvals'};
  return {page:'Admin'};
}

/** These upstream platform pages have no detail route, except Credentials → New. */
export function hyperAdminPlatformPath(path?: string): {valid:boolean;backPath?:string} {
  if (!path) return {valid:true};
  try {
    const url=new URL(path,'https://native.invalid');
    if(url.origin!=='https://native.invalid')return {valid:false,backPath:'/admin'};
    const match=/^\/admin\/(providers|credentials|proactive|playground|computers)(.*)$/.exec(url.pathname);
    if(!match)return {valid:true};
    const tail=match[2].replace(/\/$/,'');
    return {valid:tail==='' || match[1]==='credentials'&&tail==='/new',backPath:`/admin/${match[1]}`};
  } catch {return {valid:false,backPath:'/admin'};}
}
