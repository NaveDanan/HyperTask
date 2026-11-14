import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hyperRoutineCreationIssue, hyperRoutineEligibleChannels, hyperRoutineTriggerConfig } from './HyperRoutineFlows';
import { ROUTINE_FORM_DEFAULTS } from './HyperRoutineForm';
import type { ProactiveSetting, ResponsibilityRecord, RoutineRecord, BotTask } from './HyperRoutineTypes';
import { HyperGoalActions } from './HyperRoutinesSection';
import { HyperBotRoutinesTab, HyperBotResponsibilitiesTab, HyperRoutineNavigationProvider } from './index';
import { mergeRoutines } from './HyperRoutineMerged';
import { orderTasks } from './HyperRoutineTasks';
const values={...ROUTINE_FORM_DEFAULTS,agentId:'bot',channelId:'new',instruction:' Watch releases ',does:'tell' as const};
it('blocks check-ins before permission is known, and duplicate normalized subjects',()=>{
 expect(hyperRoutineCreationIssue(values,undefined,false)).toContain('admin');
 const setting={agentId:'bot',subject:'WATCH RELEASES',sourceLink:null} as ProactiveSetting;
 expect(hyperRoutineCreationIssue(values,{allowed:true,settings:[setting]},false)).toContain('already');
 expect(hyperRoutineCreationIssue({...values,title:'Different'},{allowed:true,settings:[setting]},false)).toBeNull();
 expect(hyperRoutineCreationIssue(values,{allowed:true,settings:[{...setting,sourceLink:'https://example.com'}]},false)).toBeNull();
 expect(hyperRoutineCreationIssue({...values,does:'act',starts:'event',eventSource:'slack'},undefined,true)).toContain('personal');
});
it('only offers active non-task conversations with the selected bot',()=>{
 const base={id:'yes',active:true,agentIds:['bot']};
 expect(hyperRoutineEligibleChannels([base,{...base,id:'gone',active:false},{...base,id:'task',task:true},{...base,id:'other',agentIds:['other']}],'bot')).toEqual([base]);
});
it('builds every provider contract without putting a signing secret in config',()=>{
 for(const kind of ['webhook','linear','sentry','pagerduty'] as const)expect(hyperRoutineTriggerConfig(kind,{eventTypes:'opened, closed',fieldPath:' payload.state ',fieldEquals:' ready '})).toEqual({kind,filter:{eventTypes:['opened','closed'],field:{path:'payload.state',equals:'ready'}}});
 expect(hyperRoutineTriggerConfig('github',{repository:' owner/repo '})).toEqual({kind:'github',repository:'owner/repo',filter:{eventTypes:[]}});
 expect(hyperRoutineTriggerConfig('email',{senders:'one@example.com, two@example.com'})).toMatchObject({allowedSenders:['one@example.com','two@example.com']});
 expect(hyperRoutineTriggerConfig('slack',{teamId:' T1 ',mode:'reaction',reactions:':eyes:, :ok:',channels:'C1,C2',phrases:'hello'})).toEqual({kind:'slack',teamId:'T1',mode:'reaction',reactions:['eyes','ok'],channels:['C1','C2'],phrases:['hello']});
});
it('completed goals retain deletion and hide pause, run and complete actions',()=>{
 const goal={id:'goal',status:'completed'} as ResponsibilityRecord;
 const html=renderToStaticMarkup(<HyperGoalActions goal={goal} refresh={()=>{}}/>);
 expect(html).toContain('Delete goal');
 for(const label of ['Run now','>Pause<','>Complete<'])expect(html).not.toContain(label);
 const paused=renderToStaticMarkup(<HyperGoalActions goal={{...goal,status:'paused'}} refresh={()=>{}}/>);
 expect(paused).toContain('Resume');expect(paused).not.toContain('Run now');
});
it('exports both agent-scoped tabs with host navigation support',()=>{
 for(const Tab of [HyperBotRoutinesTab,HyperBotResponsibilitiesTab])expect(renderToStaticMarkup(<HyperRoutineNavigationProvider context={{openConversation:()=>{},startConversation:async()=>{}}}><Tab agentId="bot"/></HyperRoutineNavigationProvider>)).toContain('Routines');
});
it('merges goal schedules once and retains an orphan schedule after a missing goal read',()=>{
 const routines=[{id:'schedule',agentId:'bot',goalId:'goal',enabled:true}] as RoutineRecord[];
 const goals=[{id:'goal',agentId:'bot',status:'active'}] as ResponsibilityRecord[];
 expect(mergeRoutines({routines,goals,checkIns:[]})).toMatchObject([{kind:'goal',routines:[{id:'schedule'}]}]);
 expect(mergeRoutines({routines,goals:[],checkIns:[]})).toMatchObject([{kind:'routine',id:'schedule'}]);
 expect(mergeRoutines({routines,goals,checkIns:[],agentId:'other'})).toEqual([]);
});
it('prioritizes actionable tasks and expires resolved tasks after seven days',()=>{
 const tasks=[{id:'old',status:'resolved',updatedAt:'2020-01-01'},{id:'working',status:'working',updatedAt:'2026-11-15'},{id:'review',status:'ready_for_review',updatedAt:'2026-11-14'}] as BotTask[];
 expect(orderTasks(tasks,()=>false,Date.parse('2026-11-15')).map(row=>row.task.id)).toEqual(['review','working']);
});
