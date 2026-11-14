import { createContext, useContext, type ReactNode } from 'react';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
const HyperRoutineNavigation = createContext<HyperOpenBotSectionContext | undefined>(undefined);
/** Bot hosts can provide navigation once around both exported tabs. */
export function HyperRoutineNavigationProvider({context,children}:{context:HyperOpenBotSectionContext;children:ReactNode}) {return <HyperRoutineNavigation.Provider value={context}>{children}</HyperRoutineNavigation.Provider>;}
export function useHyperRoutineNavigation(context?:HyperOpenBotSectionContext) {const inherited=useContext(HyperRoutineNavigation);return context??inherited;}
