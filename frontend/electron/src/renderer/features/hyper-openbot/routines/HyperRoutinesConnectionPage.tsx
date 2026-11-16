// Adapted from OpenBot components/routines/routines-connection-page.tsx and routines-app-hint.tsx.
// Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import { Button } from '@/components/ui/button';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HyperRead } from './HyperRoutineControls';
export function HyperRoutinesAppHint({context}:{context:HyperOpenBotSectionContext}) {return <span className="flex gap-2 text-xs text-muted-foreground">e.g. every weekday at 9, send me…<Button variant="ghost" disabled={!context.navigate} onClick={()=>context.navigate?.('routines')}>Open Routines</Button></span>;}
export function HyperRoutinesConnectionPage({context}:{context:HyperOpenBotSectionContext}) {return <section className="space-y-3 p-6"><h1 className="text-xl font-semibold">Routines</h1><p>Routines are work your Bots do on a schedule. Every Bot can set one up for you.</p><HyperRead<{routines:{enabled:boolean}[]}> path="/api/routines">{data=><p>{data.routines.length} routines, {data.routines.filter(r=>r.enabled).length} on.</p>}</HyperRead><HyperRoutinesAppHint context={context}/></section>;}
