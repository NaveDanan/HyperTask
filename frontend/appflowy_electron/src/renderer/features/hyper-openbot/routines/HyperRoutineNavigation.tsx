import { createContext, useContext, type ReactNode } from 'react';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
const HyperRoutineNavigation = createContext<HyperOpenBotSectionContext | undefined>(undefined);
/** Bot hosts can provide navigation once around both exported tabs. */
export function HyperRoutineNavigationProvider({context,children}:{context:HyperOpenBotSectionContext;children:ReactNode}) {return <HyperRoutineNavigation.Provider value={context}>{children}</HyperRoutineNavigation.Provider>;}
export function useHyperRoutineNavigation(context?:HyperOpenBotSectionContext) {const inherited=useContext(HyperRoutineNavigation);return context??inherited;}
/** Original nested detail URLs plus the older direct routines/responsibilities paths. */
export function hyperRoutineSelectionFromPath(path?:string):{tab?:string;selected?:{family:string;id:string}} {
 const plain=path?.split(/[?#]/,1)[0];if(!plain)return {};
 const sections={schedules:{tab:'routines',family:'routines'},goals:{tab:'goals',family:'responsibilities'},'check-ins':{tab:'check-ins',family:'proactive/settings'}};
 const nested=/^\/routines\/(schedules|goals|check-ins)(?:\/([^/]+))?\/?$/.exec(plain);
 if(nested){const value=sections[nested[1] as keyof typeof sections];if(!nested[2])return {tab:value.tab};try{return {tab:value.tab,selected:{family:value.family,id:decodeURIComponent(nested[2])}};}catch{return {tab:value.tab};}}
 const direct=/^\/(routines|responsibilities)(?:\/([^/]+))?\/?$/.exec(plain);
 if(!direct)return {};
 const tab=direct[1]==='responsibilities'?'goals':'routines';
 if(!direct[2])return direct[1]==='responsibilities'?{tab}:{};
 try{const id=decodeURIComponent(direct[2]);return id==='new'?{tab:'new'}:{tab,selected:{family:direct[1],id}};}catch{return {tab};}
}
