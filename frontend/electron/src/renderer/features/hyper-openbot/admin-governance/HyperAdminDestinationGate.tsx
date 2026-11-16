import { Button } from '@/components/ui/button';
import { hyperAdminPlatformPath, hyperAdminSectionFromPath } from './HyperAdminNavigation';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
// HyperTask native admin destination gate. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import type { ReactNode } from 'react';
import { useHyperResource, HyperStatus } from './HyperGovernanceUi';
export function HyperAdminAccessView({role,loading,error,children}: {role?:string;loading:boolean;error:string;children:ReactNode}) {
  if (loading) return <p role="status">Checking administrator access…</p>;
  if (error) return <p role="alert">Administrator access could not be verified. Return to the page to retry.</p>;
  if (role!=='admin') return <p role="alert">Administrator access is required.</p>;
  return <>{children}</>;
}
export function HyperAdminDestinationGate({children,path,navigate}: {children:ReactNode;path?:string;navigate?:HyperOpenBotSectionContext['navigate']}) {
  const identity=useHyperResource<{user:{role:string}}>('/api/me');
  const destination=hyperAdminPlatformPath(path);
  if(!identity.loading&&!identity.error&&identity.data?.user.role==='admin'&&!destination.valid)return <section className="p-6"><p role="alert">This admin destination is unavailable.</p><Button variant="outline" onClick={()=>navigate?.(hyperAdminSectionFromPath(destination.backPath??'/admin')??'admin-governance',{path:destination.backPath??'/admin'})}>Back to admin page</Button></section>;
  return identity.error ? <HyperStatus resource={identity}>{null}</HyperStatus> : <HyperAdminAccessView role={identity.data?.user.role} loading={identity.loading} error={identity.error}>{children}</HyperAdminAccessView>;
}
